import {
  DAY_MS,
  MINUTE_MS,
  NUMERIC_BOUNDS,
  type Days,
  type EpochMs,
  type QuestionId,
  type Ratio,
  type ReviewGrade,
} from '@/domain/shared/types';

import {
  DEFAULT_SCHEDULER_CONFIG,
  type CardPhase,
  type CardState,
  type ScheduledReview,
  type Scheduler,
  type SchedulerConfig,
} from './types';

/**
 * Ordonnanceur FSRS-lite déterministe (L2) — voir docs/ARCHITECTURE.md § 6.
 *
 * Garanties, pour `hard` / `good` / `easy` et pour **tout** état d'entrée, y
 * compris importé ou corrompu (intervalle hors bornes, carte `new` non due) :
 * - `next.dueAt > previous.dueAt` (strictement) ;
 * - `next.intervalDays <= maxIntervalDays` ;
 * - `next.intervalDays >= min(previous.intervalDays, maxIntervalDays)` : la
 *   monotonie est évaluée sur l'intervalle **ramené dans les bornes**, le
 *   plafond `maxIntervalDays` primant sur un état d'entrée hors invariants.
 * Seul `again` peut ramener l'échéance plus tôt (mise en réapprentissage).
 *
 * Le module est pur : aucune horloge, aucun aléa, aucun effet de bord. L'instant
 * de notation est toujours fourni via le paramètre `now`.
 */

/** Minutes dans une journée : base de conversion des paliers d'apprentissage. */
const MINUTES_PER_DAY = DAY_MS / MINUTE_MS;

/** Valeur centrale de l'échelle de difficulté (rappel vers la moyenne). */
const DIFFICULTY_MEAN =
  (NUMERIC_BOUNDS.difficulty.inclusiveMin + NUMERIC_BOUNDS.difficulty.inclusiveMax) / 2;

/** Borne basse de la difficulté, [1, 10]. */
const DIFFICULTY_MIN = NUMERIC_BOUNDS.difficulty.inclusiveMin;

/** Borne haute de la difficulté, [1, 10]. */
const DIFFICULTY_MAX = NUMERIC_BOUNDS.difficulty.inclusiveMax;

/**
 * Plancher de stabilité, en jours (≈ 86 ms).
 *
 * Il n'existe que pour rendre `elapsedDays / stabilityDays` toujours défini :
 * une stabilité nulle (carte jamais consolidée) ne doit pas produire `NaN` ni
 * `Infinity`, mais une rétention qui tend vers 0 dès que du temps s'écoule.
 */
const STABILITY_EPSILON_DAYS = 1e-6;

/**
 * Part de `relearningGraduatingIntervalDays` accordée à `easy` lors de la
 * graduation du réapprentissage : `easy` repart un peu plus loin que `good`,
 * sans jamais dépendre de l'ancienne stabilité.
 */
const RELEARNING_EASY_MULTIPLIER = 2;

/** État interne calculé par une transition, avant reconstruction de `CardState`. */
interface NextSchedule {
  readonly phase: CardPhase;
  readonly intervalDays: Days;
  readonly stabilityDays: Days;
  readonly learningStep: number;
  readonly dueAt: EpochMs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Index de palier valide pour une liste de paliers éventuellement vide. */
function clampStep(step: number, steps: readonly number[]): number {
  if (steps.length === 0) {
    return 0;
  }
  return clamp(Math.floor(step), 0, steps.length - 1);
}

/** Premier palier d'une liste, ou le report `hard` en repli si la liste est vide. */
function firstStep(steps: readonly number[], config: SchedulerConfig): number {
  return steps[0] ?? config.hardLearningDelayMinutes;
}

/**
 * Intervalle d'entrée ramené dans les bornes du contrat.
 *
 * Un état importé peut porter `intervalDays > maxIntervalDays` ; le plafond
 * anti-« jamais revu » prime, donc c'est cette valeur bornée qui sert de
 * référence à toutes les garanties de monotonie.
 */
function boundedInterval(card: CardState, config: SchedulerConfig): Days {
  return Math.min(card.intervalDays, config.maxIntervalDays);
}

/**
 * Report en minutes borné par le plafond du contrat.
 *
 * Utilisé par `again`, qui a le droit de faire **reculer** l'intervalle (c'est
 * le principe même d'une chute) mais jamais de dépasser `maxIntervalDays`.
 */
function clampDelayMinutes(delayMinutes: number, config: SchedulerConfig): number {
  return clamp(delayMinutes, 0, config.maxIntervalDays * MINUTES_PER_DAY);
}

/**
 * Report en minutes d'un palier pour `hard`/`good`/`easy` : borné par le
 * plafond du contrat et jamais inférieur à l'intervalle courant (lui-même
 * borné), pour que la monotonie reste structurelle.
 *
 * Sans cette borne, une carte en `relearning` dont l'intervalle d'entrée dépasse
 * `maxIntervalDays` produirait un report `hard` supérieur au plafond — et donc
 * supérieur au report `good` (régression d'ordonnancement).
 */
function progressDelayMinutes(
  delayMinutes: number,
  card: CardState,
  config: SchedulerConfig,
): number {
  const floorMinutes = boundedInterval(card, config) * MINUTES_PER_DAY;
  return clampDelayMinutes(Math.max(delayMinutes, floorMinutes), config);
}

/**
 * Rétention estimée avant révision, mesurée sur la **stabilité** mémorielle.
 *
 * `R = targetRetention ^ (elapsedDays / max(stabilityDays, ε))`, bornée [0, 1].
 *
 * Pourquoi `stabilityDays` et non `intervalDays` : `intervalDays` est une
 * **commande d'ordonnancement**, pas une mesure de mémoire. Pendant
 * `learning`/`relearning` il vaut un palier de quelques minutes (10 min ≈
 * 0,0069 j), si bien que le rapport `elapsedDays / intervalDays` explosait et
 * faisait s'effondrer `R` à ~0 — ce qui offrait ensuite un `overdueBonus`
 * maximal à une carte qui n'avait rien prouvé. `stabilityDays` est l'estimation
 * de la trace mnésique : c'est la seule grandeur sur laquelle une courbe
 * d'oubli a un sens, et `R = targetRetention` exactement à l'échéance
 * d'une carte consolidée (`elapsedDays = stabilityDays`).
 *
 * Convention : une carte jamais révisée n'a pas de trace, donc `R = 0`.
 */
function computeRetrievability(card: CardState, elapsedDays: Days, targetRetention: Ratio): Ratio {
  if (card.lastReviewedAt === null) {
    return 0;
  }
  const stability = Math.max(card.stabilityDays, STABILITY_EPSILON_DAYS);
  return clamp(targetRetention ** (elapsedDays / stability), 0, 1);
}

/** Jours écoulés depuis la dernière révision, jamais négatifs. */
function computeElapsedDays(lastReviewedAt: EpochMs | null, now: EpochMs): Days {
  if (lastReviewedAt === null) {
    return 0;
  }
  return Math.max(0, (now - lastReviewedAt) / DAY_MS);
}

/**
 * Difficulté mise à jour puis ramenée vers la moyenne :
 * `D' = clamp((1 − λ)(D + δ) + λ·5, 1, 10)`.
 */
function applyDifficulty(current: number, grade: ReviewGrade, config: SchedulerConfig): number {
  const delta = config.difficultyDelta[grade];
  const reverted =
    (1 - config.difficultyMeanReversion) * (current + delta) +
    config.difficultyMeanReversion * DIFFICULTY_MEAN;
  return clamp(reverted, DIFFICULTY_MIN, DIFFICULTY_MAX);
}

/**
 * Multiplicateur de croissance associé à la difficulté de la carte.
 *
 * Interpolation linéaire entre deux extrêmes symétriques autour de la
 * croissance nominale :
 * - carte facile (`D = 1`) ⇒ `2 − floor` (1,5 par défaut), croissance renforcée ;
 * - carte moyenne (`D = 5,5`) ⇒ `1`, croissance nominale (`goodGrowthFactor`) ;
 * - carte difficile (`D = 10`) ⇒ `floor` (0,5 par défaut), croissance atténuée.
 *
 * C'est ce qui rend `difficulty` réellement lue : deux cartes de même stabilité
 * mais de difficultés opposées n'obtiennent plus le même intervalle.
 */
function difficultyGrowthMultiplier(difficulty: number, config: SchedulerConfig): number {
  const floor = clamp(config.difficultyGrowthFloor, 0, 1);
  const ceiling = 2 - floor;
  const position = clamp(
    (clamp(difficulty, DIFFICULTY_MIN, DIFFICULTY_MAX) - DIFFICULTY_MIN) /
      (DIFFICULTY_MAX - DIFFICULTY_MIN),
    0,
    1,
  );
  return ceiling + (floor - ceiling) * position;
}

/**
 * Facteur de croissance de l'intervalle pour une note de consolidation.
 *
 * `hard` suit `hardGrowthFactor` ; `good` et `easy` ajoutent `overdueBonus`
 * pondéré par le retard `(1 − R)`. Chaque facteur est modulé par
 * `difficultyGrowthMultiplier` (atténué si la carte est difficile, renforcé si
 * elle est facile). `again` n'utilise jamais cette fonction.
 */
function reviewGrowth(
  grade: ReviewGrade,
  difficulty: number,
  retrievability: Ratio,
  config: SchedulerConfig,
): number {
  const difficultyFactor = difficultyGrowthMultiplier(difficulty, config);
  switch (grade) {
    case 'hard':
      return config.hardGrowthFactor * difficultyFactor;
    case 'good':
      return (
        (config.goodGrowthFactor + config.overdueBonus * (1 - retrievability)) * difficultyFactor
      );
    case 'easy':
      return (
        (config.easyGrowthFactor + config.overdueBonus * (1 - retrievability)) * difficultyFactor
      );
    case 'again':
      return 0;
  }
}

/**
 * Plafond d'intervalle atteignable par `hard` seul.
 *
 * `hard` ne peut pas, à lui seul, amener une carte vers `maxIntervalDays` : sa
 * croissance est bornée à `maxIntervalDays × hardIntervalCeilingRatio` (50 % par
 * défaut), ce qui interdit la dérive « 25 `hard` consécutifs ⇒ 180 jours ».
 */
function hardIntervalCeiling(config: SchedulerConfig): Days {
  return Math.max(1, Math.round(config.maxIntervalDays * config.hardIntervalCeilingRatio));
}

/** Passe à la phase `review` : l'intervalle devient la stabilité. */
function reviewState(now: EpochMs, intervalDays: Days, learningStep: number): NextSchedule {
  return {
    phase: 'review',
    intervalDays,
    stabilityDays: intervalDays,
    learningStep,
    dueAt: now + intervalDays * DAY_MS,
  };
}

/** Passe (ou reste) en `learning` : échéance à un palier de minutes. */
function learningState(
  now: EpochMs,
  delayMinutes: number,
  learningStep: number,
  stabilityDays: Days,
): NextSchedule {
  return {
    phase: 'learning',
    intervalDays: delayMinutes / MINUTES_PER_DAY,
    stabilityDays,
    learningStep,
    dueAt: now + delayMinutes * MINUTE_MS,
  };
}

/** Passe (ou reste) en `relearning` : échéance à un palier de réapprentissage. */
function relearningState(
  now: EpochMs,
  delayMinutes: number,
  learningStep: number,
  stabilityDays: Days,
): NextSchedule {
  return {
    phase: 'relearning',
    intervalDays: delayMinutes / MINUTES_PER_DAY,
    stabilityDays,
    learningStep,
    dueAt: now + delayMinutes * MINUTE_MS,
  };
}

/**
 * Intervalle d'une graduation vers `review` (`new`/`learning`).
 *
 * `I' = clamp(max(demande, minimumReviewIntervalDays, I), ·, maxIntervalDays)` :
 * la dernière borne n'est utile que pour un état importé hors invariants.
 */
function graduationInterval(requested: Days, card: CardState, config: SchedulerConfig): Days {
  const lower = Math.max(
    requested,
    config.minimumReviewIntervalDays,
    boundedInterval(card, config),
  );
  return Math.min(Math.max(lower, config.minimumReviewIntervalDays), config.maxIntervalDays);
}

/**
 * Intervalle de consolidation en phase `review`.
 *
 * `I' = min(target, upper)` avec `target = round(max(S, Smin) × growth)` :
 * - borne basse `I + gain` (`gain = 2` pour `easy`, `1` sinon), plafonnée à
 *   `maxIntervalDays` : la monotonie reste structurelle ;
 * - borne haute spécifique à `hard` (`hardIntervalCeiling`) : `hard` ne dérive
 *   pas vers le plafond global ;
 * - `good`/`easy` peuvent atteindre `maxIntervalDays`, mais seulement via une
 *   croissance réelle (difficulté, stabilité, retard).
 */
function computeReviewInterval(
  card: CardState,
  grade: ReviewGrade,
  retrievability: Ratio,
  config: SchedulerConfig,
): Days {
  const previous = boundedInterval(card, config);
  const stabilityBase = Math.max(card.stabilityDays, config.minimumStabilityDays);
  const growth = reviewGrowth(grade, card.difficulty, retrievability, config);
  const target = Math.round(stabilityBase * growth);
  const gain = grade === 'easy' ? 2 : 1;
  const upper =
    grade === 'hard'
      ? Math.min(config.maxIntervalDays, Math.max(hardIntervalCeiling(config), previous))
      : config.maxIntervalDays;
  const lower = Math.min(
    Math.max(previous + gain, config.minimumReviewIntervalDays),
    Math.max(upper, config.minimumReviewIntervalDays),
  );
  return Math.min(Math.max(target, lower), upper);
}

/**
 * Retour de réapprentissage vers `review`.
 *
 * Après une chute, la mémoire longue n'est plus prouvée : la graduation repart
 * d'un intervalle **court et fixé par la configuration**
 * (`relearningGraduatingIntervalDays`, 1 j par défaut, doublé pour `easy`), et
 * **pas** d'un multiple de l'ancienne stabilité. C'est ce qui rend la chute
 * coûteuse : il faut ensuite plusieurs réussites espacées pour reconstruire un
 * intervalle long. La borne `boundedInterval(card)` ne joue que sur un état
 * importé incohérent (intervalle de réapprentissage déjà > plafond).
 */
function consolidationState(
  card: CardState,
  grade: 'good' | 'easy',
  now: EpochMs,
  config: SchedulerConfig,
): NextSchedule {
  const requested =
    grade === 'good'
      ? Math.max(config.relearningGraduatingIntervalDays, config.minimumReviewIntervalDays)
      : Math.max(
          config.relearningGraduatingIntervalDays * RELEARNING_EASY_MULTIPLIER,
          config.minimumReviewIntervalDays + 1,
        );
  const interval = Math.min(
    config.maxIntervalDays,
    Math.max(requested, boundedInterval(card, config)),
  );
  return reviewState(now, interval, 0);
}

/** Transition depuis `phase = "new"`. */
function scheduleNew(
  card: CardState,
  grade: ReviewGrade,
  now: EpochMs,
  config: SchedulerConfig,
): NextSchedule {
  const steps = config.learningStepsMinutes;
  switch (grade) {
    case 'again':
      return learningState(
        now,
        clampDelayMinutes(firstStep(steps, config), config),
        0,
        card.stabilityDays,
      );
    case 'hard':
      return learningState(
        now,
        progressDelayMinutes(config.hardLearningDelayMinutes, card, config),
        0,
        card.stabilityDays,
      );
    case 'good': {
      const nextStep = 1;
      if (nextStep < steps.length) {
        const delay = steps[nextStep] ?? config.hardLearningDelayMinutes;
        return learningState(
          now,
          progressDelayMinutes(delay, card, config),
          nextStep,
          card.stabilityDays,
        );
      }
      return reviewState(now, graduationInterval(config.graduatingIntervalDays, card, config), 0);
    }
    case 'easy':
      return reviewState(now, graduationInterval(config.easyIntervalDays, card, config), 0);
  }
}

/** Transition depuis `phase = "learning"`. */
function scheduleLearning(
  card: CardState,
  grade: ReviewGrade,
  now: EpochMs,
  config: SchedulerConfig,
): NextSchedule {
  const steps = config.learningStepsMinutes;
  switch (grade) {
    case 'again':
      return learningState(
        now,
        clampDelayMinutes(firstStep(steps, config), config),
        0,
        card.stabilityDays,
      );
    case 'hard': {
      const step = clampStep(card.learningStep, steps);
      const stepDelay = steps[step] ?? config.hardLearningDelayMinutes;
      return learningState(
        now,
        progressDelayMinutes(Math.max(config.hardLearningDelayMinutes, stepDelay), card, config),
        step,
        card.stabilityDays,
      );
    }
    case 'good': {
      const nextStep = clampStep(card.learningStep, steps) + 1;
      if (nextStep < steps.length) {
        const delay = steps[nextStep] ?? config.hardLearningDelayMinutes;
        return learningState(
          now,
          progressDelayMinutes(delay, card, config),
          nextStep,
          card.stabilityDays,
        );
      }
      return reviewState(now, graduationInterval(config.graduatingIntervalDays, card, config), 0);
    }
    case 'easy':
      return reviewState(now, graduationInterval(config.easyIntervalDays, card, config), 0);
  }
}

/** Transition depuis `phase = "relearning"`. */
function scheduleRelearning(
  card: CardState,
  grade: ReviewGrade,
  now: EpochMs,
  config: SchedulerConfig,
): NextSchedule {
  const steps = config.relearningStepsMinutes;
  switch (grade) {
    case 'again':
      return relearningState(
        now,
        clampDelayMinutes(firstStep(steps, config), config),
        0,
        card.stabilityDays,
      );
    case 'hard': {
      const step = clampStep(card.learningStep, steps);
      const stepDelay = steps[step] ?? config.hardLearningDelayMinutes;
      return relearningState(
        now,
        progressDelayMinutes(Math.max(config.hardLearningDelayMinutes, stepDelay), card, config),
        step,
        card.stabilityDays,
      );
    }
    case 'good': {
      const nextStep = clampStep(card.learningStep, steps) + 1;
      if (nextStep < steps.length) {
        const delay = steps[nextStep] ?? config.hardLearningDelayMinutes;
        return relearningState(
          now,
          progressDelayMinutes(delay, card, config),
          nextStep,
          card.stabilityDays,
        );
      }
      return consolidationState(card, 'good', now, config);
    }
    case 'easy':
      return consolidationState(card, 'easy', now, config);
  }
}

/** Transition depuis `phase = "review"`. */
function scheduleReview(
  card: CardState,
  grade: ReviewGrade,
  now: EpochMs,
  retrievability: Ratio,
  config: SchedulerConfig,
): NextSchedule {
  if (grade === 'again') {
    const stability = Math.max(
      config.minimumStabilityDays,
      card.stabilityDays * config.lapseStabilityFactor,
    );
    return relearningState(
      now,
      clampDelayMinutes(firstStep(config.relearningStepsMinutes, config), config),
      0,
      stability,
    );
  }
  return reviewState(now, computeReviewInterval(card, grade, retrievability, config), 0);
}

/** Aiguillage de la transition selon la phase courante. */
function scheduleNext(
  card: CardState,
  grade: ReviewGrade,
  now: EpochMs,
  retrievability: Ratio,
  config: SchedulerConfig,
): NextSchedule {
  switch (card.phase) {
    case 'new':
      return scheduleNew(card, grade, now, config);
    case 'learning':
      return scheduleLearning(card, grade, now, config);
    case 'relearning':
      return scheduleRelearning(card, grade, now, config);
    case 'review':
      return scheduleReview(card, grade, now, retrievability, config);
  }
}

/**
 * Fabrique un ordonnanceur lié à une configuration.
 *
 * @param config réglages complets ; `DEFAULT_SCHEDULER_CONFIG` par défaut.
 */
export function createScheduler(config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): Scheduler {
  const runSchedule = (card: CardState, grade: ReviewGrade, now: EpochMs): ScheduledReview => {
    const elapsedDays = computeElapsedDays(card.lastReviewedAt, now);
    const retrievabilityBefore = computeRetrievability(card, elapsedDays, config.targetRetention);
    const isLapse = card.phase === 'review' && grade === 'again';
    const next = scheduleNext(card, grade, now, retrievabilityBefore, config);

    // Garde-fou d'échéance : `hard`/`good`/`easy` doivent toujours repousser
    // strictement l'échéance, même à saturation (`I' = maxIntervalDays`) et même
    // si la révision a lieu très en avance sur une carte importée.
    const dueAt = grade === 'again' ? next.dueAt : Math.max(next.dueAt, card.dueAt + 1);

    const nextCard: CardState = {
      questionId: card.questionId,
      phase: next.phase,
      dueAt,
      intervalDays: next.intervalDays,
      stabilityDays: next.stabilityDays,
      learningStep: next.learningStep,
      difficulty: applyDifficulty(card.difficulty, grade, config),
      reps: card.reps + 1,
      lapses: isLapse ? card.lapses + 1 : card.lapses,
      consecutiveSuccesses: grade === 'again' ? 0 : card.consecutiveSuccesses + 1,
      lastReviewedAt: now,
      lastGrade: grade,
    };

    return {
      previousCard: card,
      nextCard,
      elapsedDays,
      retrievabilityBefore,
      isLapse,
      intervalDeltaDays: nextCard.intervalDays - card.intervalDays,
    };
  };

  return {
    initialState(questionId: QuestionId, now: EpochMs): CardState {
      return {
        questionId,
        phase: 'new',
        dueAt: now,
        intervalDays: 0,
        stabilityDays: 0,
        learningStep: 0,
        difficulty: config.initialDifficulty,
        reps: 0,
        lapses: 0,
        consecutiveSuccesses: 0,
        lastReviewedAt: null,
        lastGrade: null,
      };
    },

    isDue(card: CardState, now: EpochMs): boolean {
      return card.dueAt <= now;
    },

    schedule(card: CardState, grade: ReviewGrade, now: EpochMs): ScheduledReview {
      return runSchedule(card, grade, now);
    },

    previewIntervals(card: CardState, now: EpochMs): Readonly<Record<ReviewGrade, Days>> {
      return {
        again: runSchedule(card, 'again', now).nextCard.intervalDays,
        hard: runSchedule(card, 'hard', now).nextCard.intervalDays,
        good: runSchedule(card, 'good', now).nextCard.intervalDays,
        easy: runSchedule(card, 'easy', now).nextCard.intervalDays,
      };
    },
  };
}

/**
 * Ordonnanceur par défaut, partagé par l'application.
 *
 * Sans état : plusieurs appels concurrents avec les mêmes arguments produisent
 * toujours le même résultat.
 */
export const scheduler: Scheduler = createScheduler();
