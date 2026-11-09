import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  DRILL_DIRECTIONS,
  type DrillDirection,
  type ReviewGrade,
} from '@/domain/shared/types';
import { masteryEvaluator } from '@/domain/mastery/evaluator';
import {
  DEFAULT_MASTERY_CRITERIA,
  type ActMastery,
  type MasteryCriteria,
  type MasteryInput,
  type MasterySnapshot,
  type QuestionMastery,
} from '@/domain/mastery/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';

const T0 = 1_700_000_000_000;
const TOTAL_QUESTIONS = 36;
const QUESTIONS_PER_ACT = 12;

let logCounter = 0;

/** Carte de test complètement spécifiée, surchargeable champ par champ. */
function makeCard(questionId: number, overrides: Partial<CardState> = {}): CardState {
  return {
    questionId,
    phase: 'review',
    dueAt: T0,
    intervalDays: 30,
    stabilityDays: 30,
    learningStep: 0,
    difficulty: 5,
    reps: 5,
    lapses: 0,
    consecutiveSuccesses: 3,
    lastReviewedAt: T0 - 30 * DAY_MS,
    lastGrade: 'good',
    ...overrides,
  };
}

/** Journal de révision minimal, identifiant unique par appel. */
function makeLog(
  questionId: number,
  direction: DrillDirection,
  grade: ReviewGrade,
  overrides: Partial<ReviewLog> = {},
): ReviewLog {
  logCounter += 1;
  return {
    id: `log-${logCounter}`,
    sessionId: 'session-1',
    questionId,
    direction,
    exerciseKind: 'production',
    grade,
    reviewedAt: T0,
    previousDueAt: null,
    nextDueAt: T0 + DAY_MS,
    intervalDays: 30,
    elapsedDays: 0,
    responseTimeMs: 3000,
    hintsUsed: 0,
    confidence: null,
    ...overrides,
  };
}

/** Deux notes `good` dans chacune des `directions`, soit la couverture minimale. */
function qualityLogs(questionId: number, directions: readonly DrillDirection[]): ReviewLog[] {
  const logs: ReviewLog[] = [];
  for (const direction of directions) {
    logs.push(makeLog(questionId, direction, 'good'));
    logs.push(makeLog(questionId, direction, 'good'));
  }
  return logs;
}

/** Entrée complète : les questions listées sont maîtrisées, les autres non. */
function buildInput(masteredIds: readonly number[]): MasteryInput {
  const cards: CardState[] = [];
  const reviewLogs: ReviewLog[] = [];
  const firstThree = DRILL_DIRECTIONS.slice(0, 3);
  for (let questionId = 1; questionId <= TOTAL_QUESTIONS; questionId += 1) {
    if (masteredIds.includes(questionId)) {
      cards.push(makeCard(questionId));
      reviewLogs.push(...qualityLogs(questionId, firstThree));
    } else {
      cards.push(
        makeCard(questionId, {
          phase: 'learning',
          intervalDays: 0.5,
          consecutiveSuccesses: 0,
          reps: 3,
        }),
      );
    }
  }
  return { cards, reviewLogs, questionsPerAct: QUESTIONS_PER_ACT, now: T0 };
}

function questionOf(snapshot: MasterySnapshot, questionId: number): QuestionMastery {
  for (const act of snapshot.acts) {
    for (const question of act.questions) {
      if (question.questionId === questionId) {
        return question;
      }
    }
  }
  throw new Error(`question ${String(questionId)} absente`);
}

function actOf(snapshot: MasterySnapshot, actId: number): ActMastery {
  const act = snapshot.acts.find((candidate) => candidate.actId === actId);
  if (act === undefined) {
    throw new Error(`acte ${String(actId)} absent`);
  }
  return act;
}

function directionOf(
  question: QuestionMastery,
  direction: DrillDirection,
): QuestionMastery['directions'][number] {
  const entry = question.directions.find((candidate) => candidate.direction === direction);
  if (entry === undefined) {
    throw new Error(`direction ${direction} absente`);
  }
  return entry;
}

describe('MasteryEvaluator — seuils SRS de la carte', () => {
  it('maîtrise une question aux seuils exacts par défaut', () => {
    const firstThree = DRILL_DIRECTIONS.slice(0, 3);
    const input: MasteryInput = {
      cards: [makeCard(1)],
      reviewLogs: qualityLogs(1, firstThree),
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const snapshot = masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA);
    const question = questionOf(snapshot, 1);
    expect(question.cardMastered).toBe(true);
    expect(question.distinctDirections).toBe(3);
    expect(question.mastered).toBe(true);
  });

  it('refuse une carte sous minIntervalDays', () => {
    const input: MasteryInput = {
      cards: [makeCard(1, { intervalDays: DEFAULT_MASTERY_CRITERIA.minIntervalDays - 1 })],
      reviewLogs: qualityLogs(1, DRILL_DIRECTIONS.slice(0, 3)),
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const snapshot = masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA);
    expect(questionOf(snapshot, 1).cardMastered).toBe(false);
  });

  it('ignore le compteur de l’ordonnanceur : c’est la série de qualité qui compte', () => {
    // Le compteur `consecutiveSuccesses` compte `CORRECT_GRADES` (hard inclus)
    // et peut donc être élevé sans qu'aucune réussite de qualité n'ait eu lieu.
    const input: MasteryInput = {
      cards: [makeCard(1, { consecutiveSuccesses: 8 })],
      reviewLogs: [
        makeLog(1, DRILL_DIRECTIONS[0], 'hard'),
        makeLog(1, DRILL_DIRECTIONS[0], 'hard'),
      ],
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const snapshot = masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA);
    expect(questionOf(snapshot, 1).cardMastered).toBe(false);
  });

  it('refuse une carte dont la série de qualité est trop courte', () => {
    const direction = DRILL_DIRECTIONS[0];
    const logs = [
      makeLog(1, direction, 'good', { reviewedAt: T0 - 3 * DAY_MS }),
      makeLog(1, direction, 'good', { reviewedAt: T0 - 2 * DAY_MS }),
      makeLog(1, direction, 'hard', { reviewedAt: T0 - DAY_MS }),
    ];
    const input: MasteryInput = {
      cards: [makeCard(1, { consecutiveSuccesses: 3 })],
      reviewLogs: logs,
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const snapshot = masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA);
    expect(questionOf(snapshot, 1).cardMastered).toBe(false);
  });

  it('un hard seul ne suffit jamais à la maîtrise', () => {
    const direction = DRILL_DIRECTIONS[0];
    const input: MasteryInput = {
      cards: [makeCard(1, { consecutiveSuccesses: 5 })],
      reviewLogs: [makeLog(1, direction, 'hard'), makeLog(1, direction, 'hard')],
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const question = questionOf(masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA), 1);
    expect(question.cardMastered).toBe(false);
    expect(question.mastered).toBe(false);
  });

  it('8 good puis 2 hard : la maîtrise retombe', () => {
    const direction = DRILL_DIRECTIONS[0];
    const logs: ReviewLog[] = [];
    for (let index = 0; index < 8; index += 1) {
      logs.push(makeLog(1, direction, 'good', { reviewedAt: T0 - (10 - index) * DAY_MS }));
    }
    const beforeLapse: MasteryInput = {
      cards: [makeCard(1)],
      reviewLogs: logs,
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    expect(
      questionOf(masteryEvaluator.evaluate(beforeLapse, DEFAULT_MASTERY_CRITERIA), 1).cardMastered,
    ).toBe(true);

    // Deux `hard` plus récents interrompent la série de qualité.
    const afterHards: MasteryInput = {
      cards: [makeCard(1, { consecutiveSuccesses: 10 })],
      reviewLogs: [
        ...logs,
        makeLog(1, direction, 'hard', { reviewedAt: T0 - DAY_MS }),
        makeLog(1, direction, 'hard', { reviewedAt: T0 }),
      ],
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    expect(
      questionOf(masteryEvaluator.evaluate(afterHards, DEFAULT_MASTERY_CRITERIA), 1).cardMastered,
    ).toBe(false);
  });

  it('lit les journaux dans l’ordre chronologique, pas dans l’ordre d’entrée', () => {
    const direction = DRILL_DIRECTIONS[0];
    const input: MasteryInput = {
      cards: [makeCard(1)],
      // `hard` en premier dans le tableau mais `good` plus récents : la série vaut 2.
      reviewLogs: [
        makeLog(1, direction, 'hard', { reviewedAt: T0 }),
        makeLog(1, direction, 'good', { reviewedAt: T0 - 2 * DAY_MS }),
        makeLog(1, direction, 'good', { reviewedAt: T0 - DAY_MS }),
      ],
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    // Ici le `hard` est le plus récent : la série est nulle.
    expect(
      questionOf(masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA), 1).cardMastered,
    ).toBe(false);

    const chronological: MasteryInput = {
      ...input,
      reviewLogs: [
        makeLog(1, direction, 'hard', { reviewedAt: T0 - 4 * DAY_MS }),
        makeLog(1, direction, 'good', { reviewedAt: T0 - 3 * DAY_MS }),
        makeLog(1, direction, 'good', { reviewedAt: T0 - 2 * DAY_MS }),
        makeLog(1, direction, 'good', { reviewedAt: T0 - DAY_MS }),
      ],
    };
    expect(
      questionOf(masteryEvaluator.evaluate(chronological, DEFAULT_MASTERY_CRITERIA), 1)
        .cardMastered,
    ).toBe(true);
  });

  it('exige minReps révisions de qualité (good/easy)', () => {
    const direction = DRILL_DIRECTIONS[0];
    const twoGoods = [makeLog(1, direction, 'good'), makeLog(1, direction, 'good')];
    const below: MasteryInput = {
      cards: [makeCard(1)],
      reviewLogs: twoGoods,
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    expect(
      questionOf(masteryEvaluator.evaluate(below, DEFAULT_MASTERY_CRITERIA), 1).cardMastered,
    ).toBe(false);

    const threeGoods = [...twoGoods, makeLog(1, direction, 'good')];
    const at: MasteryInput = {
      cards: [makeCard(1)],
      reviewLogs: threeGoods,
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const question = questionOf(masteryEvaluator.evaluate(at, DEFAULT_MASTERY_CRITERIA), 1);
    expect(question.cardMastered).toBe(true);
    // Couverture insuffisante : une seule direction.
    expect(question.mastered).toBe(false);
  });

  it('ne maîtrise pas une carte absente', () => {
    const input: MasteryInput = {
      cards: [],
      reviewLogs: [],
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const snapshot = masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA);
    expect(questionOf(snapshot, 1).cardMastered).toBe(false);
  });
});

describe('MasteryEvaluator — couverture des directions', () => {
  it('compte un hard dans la précision (0,5) mais pas dans la maîtrise', () => {
    const direction = DRILL_DIRECTIONS[0];
    const input: MasteryInput = {
      cards: [makeCard(1)],
      reviewLogs: [makeLog(1, direction, 'hard'), makeLog(1, direction, 'hard')],
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const snapshot = masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA);
    const question = questionOf(snapshot, 1);
    const entry = directionOf(question, direction);
    expect(entry.attempts).toBe(2);
    expect(entry.correct).toBeCloseTo(1, 12);
    expect(entry.accuracy).toBeCloseTo(0.5, 12);
    expect(entry.meetsAccuracy).toBe(false);
    // Sans note de qualité, la carte n'est pas maîtrisée non plus.
    expect(question.cardMastered).toBe(false);
    expect(question.mastered).toBe(false);
  });

  it('exige minDirectionAttempts par direction', () => {
    const firstThree = DRILL_DIRECTIONS.slice(0, 3);
    const logs = firstThree.map((direction) => makeLog(1, direction, 'good'));
    const input: MasteryInput = {
      cards: [makeCard(1)],
      reviewLogs: logs,
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const snapshot = masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA);
    const question = questionOf(snapshot, 1);
    expect(question.cardMastered).toBe(true);
    expect(question.distinctDirections).toBe(0);
    expect(question.mastered).toBe(false);
  });

  it('refuse la maîtrise sous minDistinctDirections', () => {
    const [first, second, third] = DRILL_DIRECTIONS;
    const logs = [
      // `hard` anciens : ils ne doivent pas interrompre la série de qualité
      // récente (ce test porte sur la couverture des directions).
      makeLog(1, third, 'hard', { reviewedAt: T0 - 3 * DAY_MS }),
      makeLog(1, third, 'hard', { reviewedAt: T0 - 2 * DAY_MS }),
      ...qualityLogs(1, [first]),
      ...qualityLogs(1, [second]),
    ];
    const input: MasteryInput = {
      cards: [makeCard(1)],
      reviewLogs: logs,
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const snapshot = masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA);
    const question = questionOf(snapshot, 1);
    expect(question.cardMastered).toBe(true);
    expect(question.distinctDirections).toBe(2);
    expect(question.mastered).toBe(false);
  });

  it('expose les cinq directions, y compris celles sans tentative', () => {
    const input: MasteryInput = {
      cards: [makeCard(1)],
      reviewLogs: qualityLogs(1, DRILL_DIRECTIONS.slice(0, 3)),
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const question = questionOf(masteryEvaluator.evaluate(input, DEFAULT_MASTERY_CRITERIA), 1);
    expect(question.directions).toHaveLength(DRILL_DIRECTIONS.length);
    const untouched = question.directions.filter((entry) => entry.attempts === 0);
    expect(untouched).toHaveLength(2);
    for (const entry of untouched) {
      expect(entry.accuracy).toBe(0);
      expect(entry.meetsAccuracy).toBe(false);
    }
  });
});

describe('MasteryEvaluator — actes et déblocage (L14)', () => {
  it('compte les questions maîtrisées par acte', () => {
    const mastered = Array.from({ length: QUESTIONS_PER_ACT }, (_unused, index) => index + 1);
    const snapshot = masteryEvaluator.evaluate(buildInput(mastered), DEFAULT_MASTERY_CRITERIA);
    const act = actOf(snapshot, 1);
    expect(act.questionCount).toBe(QUESTIONS_PER_ACT);
    expect(act.masteredCount).toBe(QUESTIONS_PER_ACT);
    expect(act.ratio).toBe(1);
    expect(snapshot.totalMastered).toBe(QUESTIONS_PER_ACT);
    expect(snapshot.overallRatio).toBeCloseTo(QUESTIONS_PER_ACT / TOTAL_QUESTIONS, 12);
    expect(snapshot.computedAt).toBe(T0);
  });

  it('verrouille l’acte suivant sous 90 %', () => {
    const mastered = Array.from({ length: 10 }, (_unused, index) => index + 1);
    const snapshot = masteryEvaluator.evaluate(buildInput(mastered), DEFAULT_MASTERY_CRITERIA);
    expect(actOf(snapshot, 1).ratio).toBeCloseTo(10 / 12, 12);
    expect(actOf(snapshot, 1).unlocked).toBe(true);
    expect(actOf(snapshot, 2).unlocked).toBe(false);
    expect(actOf(snapshot, 3).unlocked).toBe(false);
    expect(snapshot.nextActToUnlock).toBe(2);
  });

  it('débloque l’acte suivant à 90 %', () => {
    const mastered = Array.from({ length: 11 }, (_unused, index) => index + 1);
    const snapshot = masteryEvaluator.evaluate(buildInput(mastered), DEFAULT_MASTERY_CRITERIA);
    expect(actOf(snapshot, 1).ratio).toBeCloseTo(11 / 12, 12);
    expect(actOf(snapshot, 2).unlocked).toBe(true);
    // L'acte III reste verrouillé : l'acte II est vide.
    expect(actOf(snapshot, 3).unlocked).toBe(false);
    expect(snapshot.nextActToUnlock).toBe(3);
  });

  it('l’acte I est toujours débloqué, même sans aucune carte', () => {
    const snapshot = masteryEvaluator.evaluate(buildInput([]), DEFAULT_MASTERY_CRITERIA);
    expect(actOf(snapshot, 1).unlocked).toBe(true);
    expect(actOf(snapshot, 1).masteredCount).toBe(0);
    expect(snapshot.totalMastered).toBe(0);
    expect(snapshot.overallRatio).toBe(0);
    expect(snapshot.nextActToUnlock).toBe(2);
  });

  it('tout débloquer renvoie nextActToUnlock = null', () => {
    const mastered = Array.from({ length: TOTAL_QUESTIONS }, (_unused, index) => index + 1);
    const snapshot = masteryEvaluator.evaluate(buildInput(mastered), DEFAULT_MASTERY_CRITERIA);
    expect(snapshot.acts.every((act) => act.unlocked)).toBe(true);
    expect(snapshot.nextActToUnlock).toBeNull();
    expect(snapshot.overallRatio).toBe(1);
  });

  it('n’ouvre jamais un acte si l’acte précédent reste sous le seuil', () => {
    const mastered = Array.from({ length: 11 }, (_unused, index) => index + 13);
    const snapshot = masteryEvaluator.evaluate(buildInput(mastered), DEFAULT_MASTERY_CRITERIA);
    expect(actOf(snapshot, 1).ratio).toBe(0);
    expect(actOf(snapshot, 2).ratio).toBeCloseTo(11 / 12, 12);
    // L'acte II a le bon ratio mais l'acte I est vide : la chaîne reste fermée.
    expect(actOf(snapshot, 2).unlocked).toBe(false);
    expect(actOf(snapshot, 3).unlocked).toBe(false);
    expect(snapshot.nextActToUnlock).toBe(2);
  });
});

describe('MasteryEvaluator — critères personnalisés', () => {
  it('respecte des seuils alternatifs', () => {
    const relaxed: MasteryCriteria = {
      ...DEFAULT_MASTERY_CRITERIA,
      minIntervalDays: 1,
      minReps: 1,
      minConsecutiveSuccesses: 1,
      minDistinctDirections: 1,
      minDirectionAttempts: 1,
      actUnlockRatio: 0.5,
    };
    const input: MasteryInput = {
      cards: [makeCard(1, { intervalDays: 1, consecutiveSuccesses: 2 })],
      reviewLogs: [makeLog(1, DRILL_DIRECTIONS[0], 'good')],
      questionsPerAct: QUESTIONS_PER_ACT,
      now: T0,
    };
    const question = questionOf(masteryEvaluator.evaluate(input, relaxed), 1);
    expect(question.mastered).toBe(true);
  });
});
