import { describe, expect, it } from 'vitest';

import { DAY_MS, DRILL_DIRECTIONS } from '@/domain/shared/types';
import type { DrillDirection } from '@/domain/shared/types';
import type { ReviewLog } from '@/domain/srs/types';
import type { BadgeCondition, BadgeTier, DirectionMetrics, PlayerMetrics } from './types';
import { BADGE_DEFINITIONS, badgeEvaluator, conditionProgress, metricValue } from './badges';
import { EMPTY_COLLECTION } from './collection';
import { metricsCalculator } from './metrics';

/**
 * Anti-objectifs servis (docs/ARCHITECTURE.md § 8.4) :
 * - « pas de rareté artificielle » : chaque badge du catalogue est atteignable,
 *   ce que prouve le test « aucun badge impossible » ;
 * - « pas de punition » : l’évaluation est idempotente, `unlockedAt` n’est jamais
 *   remis à `null` ;
 * - « pas de récompense sans production » : toutes les conditions dérivent de
 *   productions réelles ou de la maîtrise — un QCM seul n’ouvre aucun badge.
 */

const IDS_ATTENDUS = [
  'premier-pas',
  'diner',
  'boule-de-cristal',
  'incendie',
  'recitation-parfaite',
  'mot-cle-impeccable',
  'image-impeccable',
  'numero-impeccable',
  'sens-inverse',
  'ordre-sans-faute',
  'serie-7',
  'serie-30',
  'collection-36',
  'plume-personnelle',
  'oral-6-minutes',
  'calibration',
  'sans-filet',
  'retour',
  'couverture',
] as const;

/** Badges dont la condition prétend mesurer une production. */
const PRODUCTION_BADGES = [
  'premier-pas',
  'diner',
  'boule-de-cristal',
  'incendie',
  'recitation-parfaite',
  'mot-cle-impeccable',
  'image-impeccable',
  'numero-impeccable',
  'sens-inverse',
  'ordre-sans-faute',
  'sans-filet',
  'couverture',
] as const;

function fullDirection(): DirectionMetrics {
  return { attempts: 25, correct: 25, accuracy: 1, averageResponseTimeMs: 2000 };
}

function emptyDirection(): DirectionMetrics {
  return { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null };
}

function metrics(overrides: Partial<PlayerMetrics> = {}): PlayerMetrics {
  const base: PlayerMetrics = {
    totalAnswers: 500,
    productionAnswers: 400,
    correctProductionAnswers: 380,
    distinctQuestionsAnswered: 36,
    masteredQuestions: 36,
    masteredActs: 3,
    masteredActIds: [1, 2, 3],
    bestStreakDays: 40,
    perfectSessions: 5,
    bestPerfectSessionItemCount: 12,
    collectionSize: 36,
    personalHooks: 36,
    oralExamPasses: 1,
    eveningSessions: 10,
    morningSessions: 10,
    hintFreeAnswers: 40,
    hintFreeAccuracy: 0.95,
    longestGapDays: 10,
    answersByDirection: {
      'order-to-question': fullDirection(),
      'keyword-to-question': fullDirection(),
      'image-to-question': fullDirection(),
      'number-to-question': fullDirection(),
      'question-to-number': fullDirection(),
    },
    calibrationGap: 0.05,
    calibrationAnswers: 60,
    bestOralExam: { durationMs: 300_000, accuracy: 0.95 },
  };
  return { ...base, ...overrides };
}

const ZERO_METRICS = metrics({
  totalAnswers: 0,
  productionAnswers: 0,
  correctProductionAnswers: 0,
  distinctQuestionsAnswered: 0,
  masteredQuestions: 0,
  masteredActs: 0,
  masteredActIds: [],
  bestStreakDays: 0,
  perfectSessions: 0,
  bestPerfectSessionItemCount: 0,
  collectionSize: 0,
  personalHooks: 0,
  oralExamPasses: 0,
  eveningSessions: 0,
  morningSessions: 0,
  hintFreeAnswers: 0,
  hintFreeAccuracy: null,
  longestGapDays: 0,
  answersByDirection: {
    'order-to-question': emptyDirection(),
    'keyword-to-question': emptyDirection(),
    'image-to-question': emptyDirection(),
    'number-to-question': emptyDirection(),
    'question-to-number': emptyDirection(),
  },
  calibrationGap: null,
  calibrationAnswers: 0,
  bestOralExam: null,
});

describe('badges — catalogue', () => {
  it('livre exactement les 19 identifiants du contrat', () => {
    expect(BADGE_DEFINITIONS).toHaveLength(19);
    expect(BADGE_DEFINITIONS.map((badge) => badge.id)).toEqual([...IDS_ATTENDUS]);
    expect(new Set(BADGE_DEFINITIONS.map((badge) => badge.id)).size).toBe(19);
  });

  it('répartit les paliers bronze, silver, gold et diamond', () => {
    const countByTier = (tier: BadgeTier): number =>
      BADGE_DEFINITIONS.filter((badge) => badge.tier === tier).length;
    expect(countByTier('bronze')).toBe(4);
    expect(countByTier('silver')).toBe(6);
    expect(countByTier('gold')).toBe(7);
    expect(countByTier('diamond')).toBe(2);
  });

  it('respecte le budget d’XP et ne masque qu’un indice narratif', () => {
    for (const badge of BADGE_DEFINITIONS) {
      expect(badge.xpReward).toBeGreaterThanOrEqual(10);
      expect(badge.xpReward).toBeLessThanOrEqual(150);
      expect(badge.name.fr.length).toBeGreaterThan(0);
      expect(badge.description.fr.length).toBeGreaterThan(0);
    }
    expect(BADGE_DEFINITIONS.filter((badge) => badge.secret).map((badge) => badge.id)).toEqual([
      'retour',
    ]);
  });

  it('couvre toutes les formes de condition du contrat', () => {
    const kinds = new Set<BadgeCondition['kind']>(
      BADGE_DEFINITIONS.map((badge) => badge.condition.kind),
    );
    // 9 des 10 variantes sont utilisées par le catalogue ; `all-acts-mastered`
    // est supportée par l'évaluateur (testée ci-dessous) mais absente du tableau
    // de contrat § 8.4, dont les identifiants sont normatifs.
    expect(kinds.size).toBe(9);
  });

  it('expose une valeur pour chaque métrique entière', () => {
    expect(metricValue(metrics(), 'production-answers')).toBe(400);
    expect(metricValue(metrics(), 'correct-production-answers')).toBe(380);
    expect(metricValue(metrics(), 'distinct-questions')).toBe(36);
    expect(metricValue(metrics(), 'mastered-questions')).toBe(36);
    expect(metricValue(metrics(), 'mastered-acts')).toBe(3);
    expect(metricValue(metrics(), 'best-streak-days')).toBe(40);
    expect(metricValue(metrics(), 'perfect-sessions')).toBe(5);
    expect(metricValue(metrics(), 'collection-size')).toBe(36);
    expect(metricValue(metrics(), 'personal-hooks')).toBe(36);
    expect(metricValue(metrics(), 'oral-exam-passes')).toBe(1);
    expect(metricValue(metrics(), 'evening-sessions')).toBe(10);
    expect(metricValue(metrics(), 'morning-sessions')).toBe(10);
  });
});

describe('badges — aucun badge impossible', () => {
  it('débloque les 19 badges avec des métriques atteignables', () => {
    const states = badgeEvaluator.evaluate(BADGE_DEFINITIONS, metrics(), [], 1000);
    expect(states).toHaveLength(BADGE_DEFINITIONS.length);
    expect(states.filter((state) => state.unlockedAt === null)).toEqual([]);
  });

  it('ne débloque rien avec des métriques nulles', () => {
    const states = badgeEvaluator.evaluate(BADGE_DEFINITIONS, ZERO_METRICS, [], 1000);
    expect(states.every((state) => state.unlockedAt === null)).toBe(true);
  });

  it('borne toujours la progression à la cible', () => {
    for (const source of [metrics(), ZERO_METRICS]) {
      for (const state of badgeEvaluator.evaluate(BADGE_DEFINITIONS, source, [], 1000)) {
        expect(state.progress).toBeGreaterThanOrEqual(0);
        expect(state.progress).toBeLessThanOrEqual(state.target);
      }
    }
  });
});

describe('badges — un QCM seul n’ouvre aucun badge de production', () => {
  it('compose des métriques 100 % discrimination et n’en débloque aucun', () => {
    // 60 réponses parfaites, mais toutes en discrimination : aucune production.
    const qcm: ReviewLog[] = Array.from({ length: 60 }, (_unused, index) => ({
      id: `qcm-${index}`,
      sessionId: 'session-qcm',
      questionId: (index % 36) + 1,
      direction: DRILL_DIRECTIONS[index % DRILL_DIRECTIONS.length] as DrillDirection,
      exerciseKind: 'discrimination',
      grade: 'easy',
      reviewedAt: index * DAY_MS,
      previousDueAt: null,
      nextDueAt: (index + 1) * DAY_MS,
      intervalDays: 1,
      elapsedDays: 0,
      responseTimeMs: 1000,
      hintsUsed: 0,
      confidence: 5,
    }));

    const composed = metricsCalculator.compute({
      reviewLogs: qcm,
      sessionLogs: [],
      mastery: [],
      hooksCount: 0,
      collection: EMPTY_COLLECTION,
      streak: { current: 0, longest: 0, lastActiveDay: null, freezes: 0, frozenDays: [] },
      oralExamPasses: 0,
      bestOralExam: null,
    });

    // Preuve chiffrée : 0 production, 40 tentatives par direction impossibles.
    expect(composed.totalAnswers).toBe(60);
    expect(composed.productionAnswers).toBe(0);
    expect(composed.hintFreeAnswers).toBe(0);
    expect(composed.hintFreeAccuracy).toBeNull();

    const states = badgeEvaluator.evaluate(BADGE_DEFINITIONS, composed, [], 1000);
    const unlocked = states
      .filter((state) => state.unlockedAt !== null)
      .map((state) => state.badgeId);
    expect(unlocked).toEqual([]);

    // Contrôle ciblé : aucun badge de production n’a de progression.
    for (const badgeId of PRODUCTION_BADGES) {
      const state = states.find((candidate) => candidate.badgeId === badgeId);
      expect(state?.progress, `badge ${badgeId}`).toBe(0);
      expect(state?.unlockedAt, `badge ${badgeId}`).toBeNull();
    }
  });
});

describe('badges — évaluation idempotente', () => {
  it('n’écrase jamais une date d’obtention', () => {
    const first = badgeEvaluator.evaluate(BADGE_DEFINITIONS, metrics(), [], 1000);
    const second = badgeEvaluator.evaluate(BADGE_DEFINITIONS, metrics(), first, 5000);
    expect(second.map((state) => state.unlockedAt)).toEqual(first.map((state) => state.unlockedAt));
    expect(second.every((state) => state.unlockedAt === 1000)).toBe(true);
  });

  it('conserve une obtention même si la métrique régresse', () => {
    const unlocked = badgeEvaluator.evaluate(BADGE_DEFINITIONS, metrics(), [], 1000);
    const regressed = badgeEvaluator.evaluate(BADGE_DEFINITIONS, ZERO_METRICS, unlocked, 5000);
    expect(regressed.every((state) => state.unlockedAt === 1000)).toBe(true);
    expect(regressed.every((state) => state.progress === 0)).toBe(true);
  });

  it('ignore un état existant qui ne correspond à aucun badge', () => {
    const states = badgeEvaluator.evaluate(
      BADGE_DEFINITIONS,
      ZERO_METRICS,
      [{ badgeId: 'fantome', unlockedAt: 42, progress: 1, target: 1 }],
      1000,
    );
    expect(states.map((state) => state.badgeId)).toEqual([...IDS_ATTENDUS]);
  });

  it('donne une progression partielle sans débloquer', () => {
    const states = badgeEvaluator.evaluate(
      BADGE_DEFINITIONS,
      metrics({ bestStreakDays: 3, collectionSize: 5 }),
      [],
      1000,
    );
    const streak = states.find((state) => state.badgeId === 'serie-7');
    expect(streak).toEqual({ badgeId: 'serie-7', unlockedAt: null, progress: 3, target: 7 });
  });
});

describe('badges — progression par condition', () => {
  it('mesure une condition de métrique', () => {
    expect(
      conditionProgress({ kind: 'metric', metric: 'personal-hooks', target: 12 }, metrics()),
    ).toEqual({ progress: 12, target: 12 });
    expect(
      conditionProgress({ kind: 'metric', metric: 'personal-hooks', target: 12 }, ZERO_METRICS),
    ).toEqual({ progress: 0, target: 12 });
  });

  it('mesure une précision par direction', () => {
    const condition: BadgeCondition = {
      kind: 'direction-accuracy',
      direction: 'keyword-to-question',
      minAccuracy: 0.9,
      minAnswers: 20,
    };
    expect(conditionProgress(condition, metrics())).toEqual({ progress: 20, target: 20 });
    const weak = metrics({
      answersByDirection: {
        ...metrics().answersByDirection,
        'keyword-to-question': {
          attempts: 30,
          correct: 20,
          accuracy: 0.6,
          averageResponseTimeMs: 1,
        },
      },
    });
    expect(conditionProgress(condition, weak)).toEqual({ progress: 0, target: 20 });
  });

  it('mesure la maîtrise d’un acte par appartenance, jamais par compteur', () => {
    expect(conditionProgress({ kind: 'act-mastered', actId: 2 }, metrics())).toEqual({
      progress: 1,
      target: 1,
    });
    expect(
      conditionProgress(
        { kind: 'act-mastered', actId: 3 },
        metrics({ masteredActs: 1, masteredActIds: [1] }),
      ),
    ).toEqual({ progress: 0, target: 1 });

    // Défaut corrigé : actes I et III maîtrisés (2 actes) ne débloquent pas II.
    const actOneAndThree = metrics({ masteredActs: 2, masteredActIds: [1, 3] });
    expect(conditionProgress({ kind: 'act-mastered', actId: 2 }, actOneAndThree)).toEqual({
      progress: 0,
      target: 1,
    });
    expect(conditionProgress({ kind: 'act-mastered', actId: 1 }, actOneAndThree)).toEqual({
      progress: 1,
      target: 1,
    });

    expect(
      conditionProgress(
        { kind: 'all-acts-mastered' },
        metrics({ masteredActs: 2, masteredActIds: [1, 2] }),
      ),
    ).toEqual({ progress: 2, target: 3 });
    // 2 actes mais I + III : « tous les actes » n’est pas atteint.
    expect(conditionProgress({ kind: 'all-acts-mastered' }, actOneAndThree)).toEqual({
      progress: 2,
      target: 3,
    });
  });

  it('mesure la taille réelle d’une session parfaite', () => {
    expect(conditionProgress({ kind: 'perfect-session', minItems: 12 }, metrics())).toEqual({
      progress: 12,
      target: 12,
    });
    // Une session parfaite de 5 items ne satisfait pas `minItems = 12`.
    expect(
      conditionProgress(
        { kind: 'perfect-session', minItems: 12 },
        metrics({ perfectSessions: 1, bestPerfectSessionItemCount: 5 }),
      ),
    ).toEqual({ progress: 5, target: 12 });
    expect(
      conditionProgress(
        { kind: 'perfect-session', minItems: 12 },
        metrics({ perfectSessions: 0, bestPerfectSessionItemCount: 0 }),
      ),
    ).toEqual({ progress: 0, target: 12 });
  });

  it('mesure la durée et la précision du Grand Oral', () => {
    const condition: BadgeCondition = {
      kind: 'oral-exam',
      maxDurationMs: 360_000,
      minAccuracy: 0.9,
    };
    expect(conditionProgress(condition, metrics())).toEqual({ progress: 1, target: 1 });
    expect(
      conditionProgress(
        condition,
        metrics({ bestOralExam: { durationMs: 360_000, accuracy: 0.9 } }),
      ),
    ).toEqual({ progress: 1, target: 1 });
    // Trop long.
    expect(
      conditionProgress(condition, metrics({ bestOralExam: { durationMs: 360_001, accuracy: 1 } })),
    ).toEqual({ progress: 0, target: 1 });
    // Pas assez précis.
    expect(
      conditionProgress(
        condition,
        metrics({ bestOralExam: { durationMs: 200_000, accuracy: 0.89 } }),
      ),
    ).toEqual({ progress: 0, target: 1 });
    // Aucun Grand Oral mesuré : le compteur de réussites ne suffit pas.
    expect(
      conditionProgress(condition, metrics({ oralExamPasses: 0, bestOralExam: null })),
    ).toEqual({ progress: 0, target: 1 });
  });

  it('mesure la calibration sur un nombre réel de jugements de confiance', () => {
    expect(
      conditionProgress({ kind: 'calibration', maxGap: 0.1, minAnswers: 50 }, metrics()),
    ).toEqual({ progress: 50, target: 50 });
    // Écart bon mais trop peu de jugements : pas de badge (ancien proxy = 1/1).
    expect(
      conditionProgress(
        { kind: 'calibration', maxGap: 0.1, minAnswers: 50 },
        metrics({ calibrationAnswers: 10 }),
      ),
    ).toEqual({ progress: 10, target: 50 });
    expect(
      conditionProgress({ kind: 'calibration', maxGap: 0.1, minAnswers: 50 }, ZERO_METRICS),
    ).toEqual({ progress: 0, target: 50 });
    expect(
      conditionProgress(
        { kind: 'calibration', maxGap: 0.1, minAnswers: 50 },
        metrics({ calibrationGap: 0.5 }),
      ),
    ).toEqual({ progress: 0, target: 50 });
  });

  it('mesure le retour après absence', () => {
    expect(
      conditionProgress({ kind: 'comeback', daysAway: 7 }, metrics({ longestGapDays: 3 })),
    ).toEqual({ progress: 3, target: 7 });
    expect(conditionProgress({ kind: 'comeback', daysAway: 7 }, metrics())).toEqual({
      progress: 7,
      target: 7,
    });
  });

  it('mesure la couverture des directions', () => {
    const oneDirection = metrics({
      answersByDirection: {
        'order-to-question': { attempts: 1, correct: 1, accuracy: 1, averageResponseTimeMs: 1 },
        'keyword-to-question': emptyDirection(),
        'image-to-question': emptyDirection(),
        'number-to-question': emptyDirection(),
        'question-to-number': emptyDirection(),
      },
    });
    expect(
      conditionProgress({ kind: 'direction-coverage', minDirections: 5 }, oneDirection),
    ).toEqual({ progress: 1, target: 5 });
    expect(
      conditionProgress(
        { kind: 'direction-coverage', minDirections: DRILL_DIRECTIONS.length },
        metrics(),
      ),
    ).toEqual({ progress: 5, target: 5 });
  });

  it('mesure les réponses sans indice, y compris sans aucune donnée', () => {
    expect(
      conditionProgress({ kind: 'hint-free', minAnswers: 30, minAccuracy: 0.9 }, metrics()),
    ).toEqual({ progress: 30, target: 30 });
    expect(
      conditionProgress(
        { kind: 'hint-free', minAnswers: 30, minAccuracy: 0.9 },
        metrics({ hintFreeAccuracy: 0.5 }),
      ),
    ).toEqual({ progress: 0, target: 30 });
    expect(
      conditionProgress({ kind: 'hint-free', minAnswers: 30, minAccuracy: 0.9 }, ZERO_METRICS),
    ).toEqual({ progress: 0, target: 30 });
  });
});
