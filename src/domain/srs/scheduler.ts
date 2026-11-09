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
 * Garanties, pour tout état de carte valide et pour `hard` / `good` / `easy` :
 * - `next.intervalDays >= previous.intervalDays` ;
 * - `next.dueAt > previous.dueAt`.
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
 * Empêche un pas d'apprentissage de reculer sous l'intervalle courant.
 *
 * Garde-fou du test de monotonie : même avec une configuration exotique ou un
 * état de carte incohérent, `hard` / `good` / `easy` ne réduisent jamais
 * `intervalDays`.
 */
function nonDecreasingDelay(delayMinutes: number, card: CardState): number {
  return Math.max(delayMinutes, card.intervalDays * MINUTES_PER_DAY);
}

/**
 * Rétention estimée avant révision.
 *
 * `R = targetRetention ^ (elapsedDays / intervalDays)`, bornée à [0, 1].
 * Convention pour une carte neuve ou un intervalle nul : `R = 0`.
 */
function computeRetrievability(
  elapsedDays: Days,
  intervalDays: Days,
  targetRetention: Ratio,
): Ratio {
  if (intervalDays <= 0) {
    return 0;
  }
  const exponent = elapsedDays / intervalDays;
  return clamp(targetRetention ** exponent, 0, 1);
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
 * Facteur de croissance de l'intervalle pour une note de consolidation.
 *
 * `hard` suit `hardGrowthFactor` ; `good` et `easy` ajoutent `overdueBonus`
 * pondéré par le retard `(1 − R)`. `again` n'utilise jamais cette fonction.
 */
function reviewGrowth(grade: ReviewGrade, retrievability: Ratio, config: SchedulerConfig): number {
  switch (grade) {
    case 'hard':
      return config.hardGrowthFactor;
    case 'good':
      return config.goodGrowthFactor + config.overdueBonus * (1 - retrievability);
    case 'easy':
      return config.easyGrowthFactor + config.overdueBonus * (1 - retrievability);
    case 'again':
      return 0;
  }
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
 * Intervalle de consolidation en phase `review`.
 *
 * `I' = clamp(round(max(S, Smin) × growth), I + gain, maxIntervalDays)` avec
 * `gain = 2` pour `easy` et `1` sinon : la monotonie est structurelle.
 */
function computeReviewInterval(
  card: CardState,
  grade: ReviewGrade,
  retrievability: Ratio,
  config: SchedulerConfig,
): Days {
  const stabilityBase = Math.max(card.stabilityDays, config.minimumStabilityDays);
  const growth = reviewGrowth(grade, retrievability, config);
  const gain = grade === 'easy' ? 2 : 1;
  const lower = Math.max(card.intervalDays + gain, config.minimumReviewIntervalDays);
  return clamp(Math.round(stabilityBase * growth), lower, config.maxIntervalDays);
}

/**
 * Retour de réapprentissage vers `review`.
 *
 * L'intervalle est dérivé de la stabilité courante, avec un plancher explicite
 * (`1 j` pour `good`, `2 j` pour `easy`) et jamais inférieur à l'intervalle
 * courant.
 */
function consolidationState(
  card: CardState,
  grade: 'good' | 'easy',
  retrievability: Ratio,
  now: EpochMs,
  floorDays: Days,
  config: SchedulerConfig,
): NextSchedule {
  const stabilityBase = Math.max(card.stabilityDays, config.minimumStabilityDays);
  const growth = reviewGrowth(grade, retrievability, config);
  const lower = Math.max(floorDays, config.minimumReviewIntervalDays, card.intervalDays);
  const interval = clamp(Math.round(stabilityBase * growth), lower, config.maxIntervalDays);
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
      return learningState(now, firstStep(steps, config), 0, card.stabilityDays);
    case 'hard':
      return learningState(
        now,
        nonDecreasingDelay(config.hardLearningDelayMinutes, card),
        0,
        card.stabilityDays,
      );
    case 'good': {
      const nextStep = 1;
      if (nextStep < steps.length) {
        const delay = nonDecreasingDelay(steps[nextStep] ?? config.hardLearningDelayMinutes, card);
        return learningState(now, delay, nextStep, card.stabilityDays);
      }
      return reviewState(now, Math.max(config.graduatingIntervalDays, card.intervalDays), 0);
    }
    case 'easy':
      return reviewState(now, Math.max(config.easyIntervalDays, card.intervalDays), 0);
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
      return learningState(now, firstStep(steps, config), 0, card.stabilityDays);
    case 'hard': {
      const step = clampStep(card.learningStep, steps);
      const stepDelay = steps[step] ?? config.hardLearningDelayMinutes;
      const delay = nonDecreasingDelay(Math.max(config.hardLearningDelayMinutes, stepDelay), card);
      return learningState(now, delay, step, card.stabilityDays);
    }
    case 'good': {
      const nextStep = clampStep(card.learningStep, steps) + 1;
      if (nextStep < steps.length) {
        const delay = nonDecreasingDelay(steps[nextStep] ?? config.hardLearningDelayMinutes, card);
        return learningState(now, delay, nextStep, card.stabilityDays);
      }
      return reviewState(now, Math.max(config.graduatingIntervalDays, card.intervalDays), 0);
    }
    case 'easy':
      return reviewState(now, Math.max(config.easyIntervalDays, card.intervalDays), 0);
  }
}

/** Transition depuis `phase = "relearning"`. */
function scheduleRelearning(
  card: CardState,
  grade: ReviewGrade,
  now: EpochMs,
  retrievability: Ratio,
  config: SchedulerConfig,
): NextSchedule {
  const steps = config.relearningStepsMinutes;
  switch (grade) {
    case 'again':
      return relearningState(now, firstStep(steps, config), 0, card.stabilityDays);
    case 'hard': {
      const step = clampStep(card.learningStep, steps);
      const stepDelay = steps[step] ?? config.hardLearningDelayMinutes;
      const delay = nonDecreasingDelay(Math.max(config.hardLearningDelayMinutes, stepDelay), card);
      return relearningState(now, delay, step, card.stabilityDays);
    }
    case 'good': {
      const nextStep = clampStep(card.learningStep, steps) + 1;
      if (nextStep < steps.length) {
        const delay = nonDecreasingDelay(steps[nextStep] ?? config.hardLearningDelayMinutes, card);
        return relearningState(now, delay, nextStep, card.stabilityDays);
      }
      return consolidationState(
        card,
        'good',
        retrievability,
        now,
        config.minimumReviewIntervalDays,
        config,
      );
    }
    case 'easy':
      return consolidationState(card, 'easy', retrievability, now, 2, config);
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
    return relearningState(now, firstStep(config.relearningStepsMinutes, config), 0, stability);
  }
  return reviewState(now, computeReviewInterval(card, grade, retrievability, config), 0);
}

/**
 * Fabrique un ordonnanceur lié à une configuration.
 *
 * @param config réglages complets ; `DEFAULT_SCHEDULER_CONFIG` par défaut.
 */
export function createScheduler(config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): Scheduler {
  const runSchedule = (card: CardState, grade: ReviewGrade, now: EpochMs): ScheduledReview => {
    const elapsedDays = computeElapsedDays(card.lastReviewedAt, now);
    const retrievabilityBefore = computeRetrievability(
      elapsedDays,
      card.intervalDays,
      config.targetRetention,
    );
    const isLapse = card.phase === 'review' && grade === 'again';
    const next = scheduleNext(card, grade, now, retrievabilityBefore, config);

    const nextCard: CardState = {
      questionId: card.questionId,
      phase: next.phase,
      dueAt: next.dueAt,
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
      return scheduleRelearning(card, grade, now, retrievability, config);
    case 'review':
      return scheduleReview(card, grade, now, retrievability, config);
  }
}

/**
 * Ordonnanceur par défaut, partagé par l'application.
 *
 * Sans état : plusieurs appels concurrents avec les mêmes arguments produisent
 * toujours le même résultat.
 */
export const scheduler: Scheduler = createScheduler();
