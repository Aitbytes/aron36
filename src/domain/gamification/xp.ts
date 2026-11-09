import type { XpCalculator, XpAward, XpBreakdown, XpContext, XpRules } from './types';
import type { AnswerXpInput, SessionXpInput } from './types';

/**
 * Barème d'XP et anti-farm (L8, L15).
 *
 * Anti-objectifs servis par ce module :
 * - **pas de ludification substitutive** : l'XP ne récompense que la production
 *   réelle. `again` vaut toujours 0, la discrimination est plafonnée à la moitié
 *   d'une production équivalente, et les bonus (première exposition, sans
 *   indice, rapidité) sont réservés à la production ;
 * - **pas de punition** : un montant est toujours ≥ 0, jamais négatif.
 *
 * Formule, appliquée dans cet ordre :
 *
 * ```
 * base          = baseByDirection[direction]
 * gradeAdjusted = floor(base × gradeMultiplier[grade] × (discrimination ? 0.5 : 1))
 * bonus         = première exposition + sans indice + rapidité   (production seulement)
 * total         = floor((gradeAdjusted + bonus) × antiFarmFactor)
 * ```
 *
 * `antiFarmFactor` dépend du nombre de réponses déjà données à la même question
 * le même jour : 1re ×1, 2e ×0.5, 3e ×0.25, 4e et suivantes ×0.
 *
 * Note d'implémentation : `gradeAdjusted` est arrondi **avant** l'ajout des
 * bonus (qui sont entiers), ce qui rend `XpBreakdown` exactement auditable —
 * `total = floor((gradeAdjusted + bonus) × antiFarmFactor)` — sans changer le
 * résultat de la formule documentée (l'arrondi d'une somme d'entiers est le même).
 */

/** Nombre minimal d'items pour qu'une session « parfaite » mérite son bonus. */
export const PERFECT_SESSION_MIN_ITEMS = 5;

/**
 * Facteur anti-farm d'une réponse.
 *
 * `sameDayAnswersForQuestion` compte les réponses **déjà** données aujourd'hui
 * sur la même question : 0 → 1re réponse ×1, 1 → ×0.5, 2 → ×0.25, 3+ → ×0.
 */
export function antiFarmFactorFor(rules: XpRules, sameDayAnswersForQuestion: number): number {
  const index = Math.max(0, Math.floor(sameDayAnswersForQuestion));
  return rules.antiFarmFactors[index] ?? 0;
}

/** Composantes brutes d'une réponse, avant anti-farm. */
interface RawAnswerXp {
  readonly base: number;
  readonly gradeAdjusted: number;
  readonly firstExposureBonus: number;
  readonly noHintBonus: number;
  readonly speedBonus: number;
}

/**
 * Calcule les composantes d'une réponse.
 *
 * Les trois bonus sont **exclusivement** attachés à une production : une
 * discrimination n'est pas une production (`XpContext.isFirstExposure` parle de
 * question « produite avec succès »), et les bonus d'indice et de rapidité sont
 * documentés « si production ». C'est ce qui garantit structurellement la règle
 * dure : une discrimination ne peut jamais rapporter plus de la moitié d'une
 * production de même direction et de même note.
 */
function rawAnswerXp(input: AnswerXpInput, context: XpContext): RawAnswerXp {
  const { rules } = context;
  const base = rules.baseByDirection[input.direction];
  const isProduction = input.exerciseKind === 'production';
  const succeeded = input.grade !== 'again';
  const discriminationFactor = isProduction ? 1 : rules.discriminationFactor;
  const gradeAdjusted = Math.floor(
    base * rules.gradeMultiplier[input.grade] * discriminationFactor,
  );
  const firstExposureBonus =
    isProduction && succeeded && context.isFirstExposure ? rules.firstExposureBonus : 0;
  const noHintBonus = isProduction && succeeded && input.hintsUsed === 0 ? rules.noHintBonus : 0;
  const speedBonus =
    isProduction && succeeded && input.responseTimeMs <= rules.speedThresholdMs
      ? rules.speedBonus
      : 0;

  return { base, gradeAdjusted, firstExposureBonus, noHintBonus, speedBonus };
}

/** Somme brute d'un détail d'XP (avant anti-farm). */
function rawSubtotal(raw: RawAnswerXp): number {
  return raw.gradeAdjusted + raw.firstExposureBonus + raw.noHintBonus + raw.speedBonus;
}

/** XP d'une réponse notée, avant anti-farm : au moins 0, arrondi inférieur. */
function forAnswer(input: AnswerXpInput, context: XpContext): XpAward {
  const raw = rawAnswerXp(input, context);
  const antiFarmFactor = antiFarmFactorFor(context.rules, context.sameDayAnswersForQuestion);
  const total = Math.max(0, Math.floor(rawSubtotal(raw) * antiFarmFactor));
  const breakdown: XpBreakdown = {
    base: raw.base,
    gradeAdjusted: raw.gradeAdjusted,
    firstExposureBonus: raw.firstExposureBonus,
    noHintBonus: raw.noHintBonus,
    speedBonus: raw.speedBonus,
    antiFarmFactor,
    total,
  };

  return {
    amount: total,
    reason: input.exerciseKind === 'production' ? 'production-answer' : 'discrimination-answer',
    breakdown,
    questionId: input.questionId,
    at: context.now,
  };
}

/**
 * Bonus de fin de session : 10 XP pour une session terminée, + 15 XP si elle est
 * parfaite (100 %, au moins `PERFECT_SESSION_MIN_ITEMS` items et **aucun QCM**).
 *
 * `breakdown` vaut `null` : ces bonus ne portent pas sur une question précise
 * (contrat `XpAward`). Ils dérivent d'actes de production déjà récompensés, donc
 * ils ne contournent pas l'anti-farm par question.
 *
 * Le bonus « session parfaite » exige une session entièrement composée de
 * productions : un QCM parfait ne prouve aucune restitution (anti-objectif
 * « pas de reconnaissance déguisée en rappel »).
 */
function forSession(input: SessionXpInput, context: XpContext): XpAward {
  const completion = input.itemCount > 0 ? context.rules.sessionCompletionXp : 0;
  const perfect =
    input.itemCount >= PERFECT_SESSION_MIN_ITEMS &&
    input.productionCount === input.itemCount &&
    input.correctCount === input.itemCount
      ? context.rules.perfectSessionBonus
      : 0;
  const total = completion + perfect;

  return {
    amount: total,
    reason: perfect > 0 ? 'perfect-session' : 'session-complete',
    breakdown: null,
    questionId: null,
    at: context.now,
  };
}

/** Calcul de l'XP, pur : tout est reçu en paramètre, rien n'est lu ailleurs. */
export const xpCalculator: XpCalculator = { forAnswer, forSession };
