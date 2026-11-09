import {
  ACCURACY_CREDIT,
  ACT_IDS,
  DRILL_DIRECTIONS,
  MASTERY_QUALITY_GRADES,
  type ActId,
  type DrillDirection,
  type Ratio,
  type ReviewGrade,
} from '@/domain/shared/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';

import type {
  ActMastery,
  DirectionMastery,
  MasteryCriteria,
  MasteryEvaluator,
  MasteryInput,
  MasterySnapshot,
  QuestionMastery,
} from './types';

/**
 * Évaluateur pur de maîtrise par question, direction et acte (L5, L14).
 *
 * Deux notions de « réussite » coexistent, volontairement distinctes (voir
 * `@/domain/shared/types`) :
 *
 * - **précision par direction** : pondérée par `ACCURACY_CREDIT`, donc un
 *   `hard` compte pour `0.5` et un `again` pour `0`. C'est la base du critère
 *   `minDirectionAccuracy`.
 * - **barre de maîtrise** : seules les notes de `MASTERY_QUALITY_GRADES`
 *   (`good`, `easy`) comptent, via `MasteryCriteria.minReps`. Un rappel
 *   laborieux entretient la carte mais ne prouve pas la maîtrise.
 *
 * Le critère SRS d'une carte (`phase = "review"`, `intervalDays`,
 * `consecutiveSuccesses`) utilise le compteur de l'ordonnanceur, qui repose sur
 * `CORRECT_GRADES`. Seul `minReps` emploie les notes de qualité.
 *
 * Aucune I/O : tout provient de `MasteryInput` (états et journaux purs).
 */

/** Notes de qualité, en `Set` pour un test d'adhésion typé sans assertion. */
const QUALITY_GRADES = new Set<ReviewGrade>(MASTERY_QUALITY_GRADES);

/** Indexe les cartes par question ; la dernière occurrence gagne. */
function indexCards(cards: readonly CardState[]): ReadonlyMap<number, CardState> {
  const byId = new Map<number, CardState>();
  for (const card of cards) {
    byId.set(card.questionId, card);
  }
  return byId;
}

/** Indexe les journaux par question, dans l'ordre d'entrée. */
function indexLogs(logs: readonly ReviewLog[]): ReadonlyMap<number, readonly ReviewLog[]> {
  const byId = new Map<number, ReviewLog[]>();
  for (const log of logs) {
    const existing = byId.get(log.questionId);
    if (existing === undefined) {
      byId.set(log.questionId, [log]);
    } else {
      existing.push(log);
    }
  }
  return byId;
}

/** Nombre de journaux d'une question portant une note de qualité (good/easy). */
function countQualityReviews(logs: readonly ReviewLog[]): number {
  return logs.filter((log) => QUALITY_GRADES.has(log.grade)).length;
}

/** Agrège les journaux d'une direction en une `DirectionMastery`. */
function evaluateDirection(
  direction: DrillDirection,
  logs: readonly ReviewLog[],
  criteria: MasteryCriteria,
): DirectionMastery {
  const directionLogs = logs.filter((log) => log.direction === direction);
  const attempts = directionLogs.length;
  // `correct` est un crédit pondéré (ACCURACY_CREDIT), pas un compte entier.
  const correct = directionLogs.reduce<number>((sum, log) => sum + credit(log.grade), 0);
  const accuracy: Ratio = attempts === 0 ? 0 : correct / attempts;
  const meetsAccuracy =
    attempts >= criteria.minDirectionAttempts && accuracy >= criteria.minDirectionAccuracy;
  return { direction, attempts, correct, accuracy, meetsAccuracy };
}

/** Crédit de réussite d'une note, dans [0, 1]. */
function credit(grade: ReviewGrade): number {
  return ACCURACY_CREDIT[grade];
}

/** Évalue une question : critère SRS de la carte + couverture des directions. */
function evaluateQuestion(
  questionId: number,
  card: CardState | undefined,
  logs: readonly ReviewLog[],
  criteria: MasteryCriteria,
): QuestionMastery {
  const cardMastered =
    card !== undefined &&
    card.phase === 'review' &&
    card.intervalDays >= criteria.minIntervalDays &&
    card.consecutiveSuccesses >= criteria.minConsecutiveSuccesses &&
    countQualityReviews(logs) >= criteria.minReps;

  const directions = DRILL_DIRECTIONS.map((direction) =>
    evaluateDirection(direction, logs, criteria),
  );
  const distinctDirections = directions.filter((entry) => entry.meetsAccuracy).length;
  const mastered = cardMastered && distinctDirections >= criteria.minDistinctDirections;

  return { questionId, cardMastered, directions, distinctDirections, mastered };
}

/** Identifiants de questions attendus pour un acte, dans l'ordre. */
function questionIdsForAct(actId: ActId, questionsPerAct: number): readonly number[] {
  const first = (actId - 1) * questionsPerAct + 1;
  return Array.from({ length: questionsPerAct }, (_unused, index) => first + index);
}

/**
 * Calcule la photographie de maîtrise.
 *
 * Chaque acte contient exactement `questionsPerAct` questions (attendu : 12) :
 * une question sans carte est comptée comme non maîtrisée, ce qui rend le ratio
 * d'un acte comparable d'un appel à l'autre. Un acte n'est débloqué que si
 * l'acte précédent l'est et atteint `actUnlockRatio` ; l'acte I l'est toujours.
 */
function evaluateSnapshot(input: MasteryInput, criteria: MasteryCriteria): MasterySnapshot {
  const cardsById = indexCards(input.cards);
  const logsById = indexLogs(input.reviewLogs);

  let previousUnlocked = true;
  let previousRatio: Ratio = 0;
  const acts: ActMastery[] = [];

  for (const actId of ACT_IDS) {
    const questions = questionIdsForAct(actId, input.questionsPerAct).map((questionId) =>
      evaluateQuestion(
        questionId,
        cardsById.get(questionId),
        logsById.get(questionId) ?? [],
        criteria,
      ),
    );
    const masteredCount = questions.filter((question) => question.mastered).length;
    const ratio: Ratio = input.questionsPerAct === 0 ? 0 : masteredCount / input.questionsPerAct;
    const unlocked: boolean =
      actId === 1 ? true : previousUnlocked && previousRatio >= criteria.actUnlockRatio;

    acts.push({
      actId,
      questionCount: input.questionsPerAct,
      masteredCount,
      ratio,
      unlocked,
      questions,
    });

    previousUnlocked = unlocked;
    previousRatio = ratio;
  }

  const totalMastered = acts.reduce((sum, act) => sum + act.masteredCount, 0);
  const totalQuestions = acts.length * input.questionsPerAct;
  const overallRatio: Ratio = totalQuestions === 0 ? 0 : totalMastered / totalQuestions;
  const nextAct = acts.find((act) => !act.unlocked);

  return {
    acts,
    totalMastered,
    overallRatio,
    nextActToUnlock: nextAct?.actId ?? null,
    computedAt: input.now,
  };
}

/**
 * Évaluateur de maîtrise sans état.
 *
 * `evaluate` est pur : les critères sont fournis à chaque appel, ce qui permet
 * de tester des seuils alternatifs sans reconfigurer un singleton.
 */
export const masteryEvaluator: MasteryEvaluator = {
  evaluate(input: MasteryInput, criteria: MasteryCriteria): MasterySnapshot {
    return evaluateSnapshot(input, criteria);
  },
};

/** Fabrique un évaluateur de maîtrise (symétrie avec `createScheduler`). */
export function createMasteryEvaluator(): MasteryEvaluator {
  return masteryEvaluator;
}
