import { describe, expect, it } from 'vitest';

import { DRILL_DIRECTIONS } from '@/domain/shared/types';
import type { BadgeCondition, BadgeTier, DirectionMetrics, PlayerMetrics } from './types';
import { BADGE_DEFINITIONS, badgeEvaluator, conditionProgress, metricValue } from './badges';

/**
 * Anti-objectifs servis (docs/ARCHITECTURE.md § 8.4) :
 * - « pas de rareté artificielle » : chaque badge du catalogue est atteignable,
 *   ce que prouve le test « aucun badge impossible » ;
 * - « pas de punition » : l’évaluation est idempotente, `unlockedAt` n’est jamais
 *   remis à `null` ;
 * - « pas de récompense sans production » : toutes les conditions dérivent de
 *   productions réelles ou de la maîtrise.
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

function fullDirection(): DirectionMetrics {
  return { attempts: 25, correct: 25, accuracy: 1, averageResponseTimeMs: 2000 };
}

function metrics(overrides: Partial<PlayerMetrics> = {}): PlayerMetrics {
  const base: PlayerMetrics = {
    totalAnswers: 500,
    productionAnswers: 400,
    correctProductionAnswers: 380,
    distinctQuestionsAnswered: 36,
    masteredQuestions: 36,
    masteredActs: 3,
    bestStreakDays: 40,
    perfectSessions: 5,
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
  bestStreakDays: 0,
  perfectSessions: 0,
  collectionSize: 0,
  personalHooks: 0,
  oralExamPasses: 0,
  eveningSessions: 0,
  morningSessions: 0,
  hintFreeAnswers: 0,
  hintFreeAccuracy: 0,
  longestGapDays: 0,
  answersByDirection: {
    'order-to-question': { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null },
    'keyword-to-question': { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null },
    'image-to-question': { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null },
    'number-to-question': { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null },
    'question-to-number': { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null },
  },
  calibrationGap: null,
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

  it('mesure la maîtrise d’un acte et de tous les actes', () => {
    expect(conditionProgress({ kind: 'act-mastered', actId: 2 }, metrics())).toEqual({
      progress: 2,
      target: 2,
    });
    expect(
      conditionProgress({ kind: 'act-mastered', actId: 3 }, metrics({ masteredActs: 1 })),
    ).toEqual({ progress: 1, target: 3 });
    expect(conditionProgress({ kind: 'all-acts-mastered' }, metrics({ masteredActs: 2 }))).toEqual({
      progress: 2,
      target: 3,
    });
  });

  it('mesure les conditions sans détail disponible dans PlayerMetrics', () => {
    expect(conditionProgress({ kind: 'perfect-session', minItems: 12 }, metrics())).toEqual({
      progress: 1,
      target: 1,
    });
    expect(
      conditionProgress({ kind: 'perfect-session', minItems: 12 }, metrics({ perfectSessions: 0 })),
    ).toEqual({ progress: 0, target: 1 });
    expect(
      conditionProgress({ kind: 'oral-exam', maxDurationMs: 360_000, minAccuracy: 0.9 }, metrics()),
    ).toEqual({ progress: 1, target: 1 });
  });

  it('mesure la calibration, y compris sans donnée', () => {
    expect(
      conditionProgress({ kind: 'calibration', maxGap: 0.1, minAnswers: 50 }, metrics()),
    ).toEqual({ progress: 1, target: 1 });
    expect(
      conditionProgress({ kind: 'calibration', maxGap: 0.1, minAnswers: 50 }, ZERO_METRICS),
    ).toEqual({ progress: 0, target: 1 });
    expect(
      conditionProgress(
        { kind: 'calibration', maxGap: 0.1, minAnswers: 50 },
        metrics({ calibrationGap: 0.5 }),
      ),
    ).toEqual({ progress: 0, target: 1 });
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
        'keyword-to-question': {
          attempts: 0,
          correct: 0,
          accuracy: 0,
          averageResponseTimeMs: null,
        },
        'image-to-question': { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null },
        'number-to-question': { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null },
        'question-to-number': { attempts: 0, correct: 0, accuracy: 0, averageResponseTimeMs: null },
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

  it('mesure les réponses sans indice, y compris sous le seuil de précision', () => {
    expect(
      conditionProgress({ kind: 'hint-free', minAnswers: 30, minAccuracy: 0.9 }, metrics()),
    ).toEqual({ progress: 30, target: 30 });
    expect(
      conditionProgress(
        { kind: 'hint-free', minAnswers: 30, minAccuracy: 0.9 },
        metrics({ hintFreeAccuracy: 0.5 }),
      ),
    ).toEqual({ progress: 0, target: 30 });
  });
});
