import { describe, expect, it } from 'vitest';

import { buildSession } from './builder';
import type { SessionBuildContext, SessionBuildResult, SessionPlan, SessionRequest } from './types';
import { makeCardsFor, makeContext, makeHook, makeLog, makeRequest } from './test-fixtures';

const ALL_QUESTION_IDS = Array.from({ length: 36 }, (_unused, index) => index + 1);
const ALL_DIRECTIONS = [
  'order-to-question',
  'keyword-to-question',
  'image-to-question',
  'number-to-question',
  'question-to-number',
] as const;

function dueCardsContext(overrides: Partial<SessionBuildContext> = {}): SessionBuildContext {
  return makeContext({ cards: makeCardsFor(ALL_QUESTION_IDS), ...overrides });
}

function buildOk(request: SessionRequest, context: SessionBuildContext): SessionPlan {
  const result = buildSession(request, context);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`plan attendu, échec : ${result.failure}`);
  }
  return result.plan;
}

function expectFailure(
  request: SessionRequest,
  context: SessionBuildContext,
): Extract<SessionBuildResult, { ok: false }>['failure'] {
  const result = buildSession(request, context);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('échec attendu');
  }
  return result.failure;
}

describe('builder — filtres et échecs explicites', () => {
  it('échoue sur `empty-selection` quand aucun acte n’est débloqué', () => {
    expect(expectFailure(makeRequest(), makeContext({ unlockedActIds: [] }))).toBe(
      'empty-selection',
    );
  });

  it('échoue sur `act-locked` quand un acte demandé n’est pas débloqué', () => {
    expect(expectFailure(makeRequest({ actIds: [2] }), makeContext({ unlockedActIds: [1] }))).toBe(
      'act-locked',
    );
  });

  it('échoue sur `no-due-cards` quand aucune carte n’est due', () => {
    const context = makeContext({
      cards: makeCardsFor(ALL_QUESTION_IDS, { dueAt: 9_999_999_999 }),
    });
    expect(expectFailure(makeRequest({ mode: 'review' }), context)).toBe('no-due-cards');
  });

  it('échoue sur `invalid-config` pour des plafonds ou directions invalides', () => {
    expect(expectFailure(makeRequest({ maxItems: 0 }), dueCardsContext())).toBe('invalid-config');
    expect(expectFailure(makeRequest({ maxDurationMs: 0 }), dueCardsContext())).toBe(
      'invalid-config',
    );
    expect(expectFailure(makeRequest({ directions: [] }), dueCardsContext())).toBe(
      'invalid-config',
    );
    expect(expectFailure(makeRequest({ questionIds: [99] }), dueCardsContext())).toBe(
      'invalid-config',
    );
  });

  it('recitation impose la direction `order-to-question`', () => {
    const plan = buildOk(makeRequest({ mode: 'recitation', maxItems: 12 }), dueCardsContext());
    expect(plan.config.directions).toEqual(['order-to-question']);
    for (const item of plan.items) {
      expect(item.direction).toBe('order-to-question');
    }
  });

  it('recitation croise les directions demandées avec celles du mode', () => {
    const plan = buildOk(
      makeRequest({
        mode: 'recitation',
        maxItems: 4,
        directions: ['order-to-question', 'keyword-to-question'],
      }),
      dueCardsContext(),
    );
    expect(plan.config.directions).toEqual(['order-to-question']);
  });

  it('speed refusé avant maîtrise', () => {
    expect(
      expectFailure(
        makeRequest({ mode: 'speed', actIds: [2] }),
        dueCardsContext({ masteredActIds: [] }),
      ),
    ).toBe('mode-locked');

    const mastered = buildOk(
      makeRequest({ mode: 'speed', actIds: [2] }),
      dueCardsContext({ masteredActIds: [2] }),
    );
    expect(mastered.config.mode).toBe('speed');
    expect(mastered.config.speedTargetMs).toBe(4_000);
    for (const item of mastered.items) {
      expect(item.actId).toBe(2);
    }
  });

  it('restreint la sélection aux actes et questions demandés', () => {
    const plan = buildOk(
      makeRequest({ actIds: [2], questionIds: [13, 14, 15], maxItems: 10 }),
      dueCardsContext(),
    );
    expect(plan.items).toHaveLength(3);
    for (const item of plan.items) {
      expect(item.actId).toBe(2);
      expect([13, 14, 15]).toContain(item.questionId);
    }
  });

  it('ne retient que les cartes dues en mode `review`', () => {
    const cards = makeCardsFor(ALL_QUESTION_IDS, { dueAt: 9_999_999_999 });
    for (const id of [1, 5, 20]) {
      cards.set(id, makeCardsFor([id], { dueAt: 0, reps: 3 }).get(id)!);
    }
    const plan = buildOk(makeRequest({ mode: 'review', maxItems: 10 }), makeContext({ cards }));
    expect(plan.items.map((item) => item.questionId).sort((a, b) => a - b)).toEqual([1, 5, 20]);
    expect(plan.dueQuestionIds).toEqual(plan.items.map((item) => item.questionId));
  });

  it('ne retient que les questions neuves en mode `discovery`', () => {
    const cards = makeCardsFor([1, 2, 3]);
    const plan = buildOk(makeRequest({ mode: 'discovery', maxItems: 12 }), makeContext({ cards }));
    for (const item of plan.items) {
      expect([1, 2, 3]).not.toContain(item.questionId);
    }
    expect(plan.dueQuestionIds).toEqual([]);
  });
});

describe('builder — plafonds L3', () => {
  it('respecte `maxItems`', () => {
    const plan = buildOk(makeRequest({ maxItems: 5 }), dueCardsContext());
    expect(plan.items).toHaveLength(5);
    expect(plan.config.maxItems).toBe(5);
  });

  it('plafonne le nombre d’items par la durée estimée (30 s par production)', () => {
    const plan = buildOk(makeRequest({ maxItems: 30, maxDurationMs: 300_000 }), dueCardsContext());
    expect(plan.items).toHaveLength(10);
    expect(plan.config.maxDurationMs).toBe(300_000);
  });

  it('plafonne la discrimination à 20 % des items', () => {
    const plan = buildOk(makeRequest({ mode: 'review', maxItems: 20 }), dueCardsContext());
    expect(plan.items).toHaveLength(20);
    const limit = Math.floor(plan.items.length * 0.2);
    expect(plan.config.maxDiscriminationRatio).toBeLessThanOrEqual(0.2);
    expect(plan.interleaving.discriminationCount).toBeLessThanOrEqual(limit);
    expect(plan.interleaving.productionCount).toBeGreaterThanOrEqual(plan.items.length - limit);
    for (const item of plan.items) {
      if (item.exerciseKind === 'discrimination') {
        expect(item.options).toHaveLength(4);
        expect(item.options.map((option) => option.id)).toContain(item.correctOptionId);
        const correct = item.options.find((option) => option.id === item.correctOptionId);
        expect(correct?.questionId).toBe(item.questionId);
        for (const option of item.options) {
          expect(option.questionId).toBeGreaterThan((item.actId - 1) * 12);
          expect(option.questionId).toBeLessThanOrEqual(item.actId * 12);
        }
      }
    }
  });
});

describe('builder — déterminisme et reproductibilité', () => {
  it('produit deux plans strictement identiques pour une même graine', () => {
    const request = makeRequest({ seed: 'graine-fixe', maxItems: 8 });
    const first = buildOk(request, dueCardsContext());
    const second = buildOk(request, dueCardsContext());
    expect(first).toEqual(second);
  });

  it('produit des ordres différents pour des graines différentes', () => {
    const context = dueCardsContext();
    const first = buildOk(makeRequest({ seed: 'graine-a', maxItems: 8 }), context);
    const second = buildOk(makeRequest({ seed: 'graine-b', maxItems: 8 }), context);
    expect(first.items.map((item) => item.questionId)).not.toEqual(
      second.items.map((item) => item.questionId),
    );
  });

  it('recopie l’identité et l’instantané de la requête dans le plan', () => {
    const plan = buildOk(
      makeRequest({ sessionId: 'sess-42', seed: 'graine-x', now: 4_242, maxItems: 3 }),
      dueCardsContext(),
    );
    expect(plan.id).toBe('sess-42');
    expect(plan.seed).toBe('graine-x');
    expect(plan.createdAt).toBe(4_242);
    expect(plan.mode).toBe('review');
    expect(plan.items[0]?.id).toBe('sess-42:0');
  });
});

describe('builder — entrelacement L4', () => {
  const spanningAcrossActs = [1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 18, 25, 26, 27, 28, 29, 30];

  it('acts-and-directions : jamais deux actes identiques consécutifs', () => {
    const plan = buildOk(
      makeRequest({ mode: 'review', maxItems: 12, questionIds: spanningAcrossActs }),
      dueCardsContext(),
    );
    expect(plan.interleaving.policy).toBe('acts-and-directions');
    const sequence = [...plan.interleaving.actSequence];
    expect(new Set(sequence).size).toBeGreaterThan(1);
    for (let index = 1; index < sequence.length; index += 1) {
      expect(sequence[index]).not.toBe(sequence[index - 1]);
    }
  });

  it('blocked : groupe les items par acte', () => {
    const plan = buildOk(
      makeRequest({ mode: 'discovery', maxItems: 12, questionIds: spanningAcrossActs }),
      makeContext({ cards: new Map() }),
    );
    expect(plan.interleaving.policy).toBe('blocked');
    const sequence = [...plan.interleaving.actSequence];
    const sorted = [...sequence].sort((left, right) => left - right);
    expect(sequence).toEqual(sorted);
  });

  it('directions : alterne les directions à l’intérieur d’un acte', () => {
    const plan = buildOk(
      makeRequest({
        mode: 'learning',
        maxItems: 12,
        questionIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        directions: [...ALL_DIRECTIONS],
      }),
      dueCardsContext(),
    );
    expect(plan.interleaving.policy).toBe('directions');
    expect(new Set(plan.interleaving.actSequence)).toEqual(new Set([1]));
    expect(new Set(plan.interleaving.directionSequence).size).toBe(ALL_DIRECTIONS.length);
  });

  it('évite les deux dernières directions produites pour une question', () => {
    const context = dueCardsContext({
      recentLogs: [makeLog(7, 'keyword-to-question', 100)],
    });
    const plan = buildOk(
      makeRequest({
        mode: 'learning',
        maxItems: 1,
        questionIds: [7],
        directions: ['keyword-to-question', 'image-to-question', 'order-to-question'],
      }),
      context,
    );
    expect(plan.items[0]?.direction).not.toBe('keyword-to-question');
  });

  it('retombe sur la direction de base quand toutes les alternatives sont récentes', () => {
    const context = dueCardsContext({
      recentLogs: [makeLog(7, 'image-to-question', 200), makeLog(7, 'order-to-question', 300)],
    });
    const plan = buildOk(
      makeRequest({
        mode: 'learning',
        maxItems: 2,
        questionIds: [7],
        directions: ['image-to-question', 'order-to-question'],
      }),
      context,
    );
    expect(plan.items[0]?.direction).toBe('image-to-question');
  });

  it('restaure la couverture des directions après évitement des révisions', () => {
    const context = dueCardsContext({
      recentLogs: [1, 2, 3, 4, 5, 6].map((id) => makeLog(id, 'keyword-to-question', id * 10)),
    });
    const plan = buildOk(
      makeRequest({
        mode: 'learning',
        maxItems: 3,
        questionIds: [1, 2, 3, 4, 5, 6],
        directions: ['keyword-to-question', 'image-to-question', 'order-to-question'],
      }),
      context,
    );
    const directions = new Set(plan.items.map((item) => item.direction));
    expect(directions.size).toBe(3);
  });

  it('termine l’entrelacement malgré des actes très déséquilibrés', () => {
    const plan = buildOk(
      makeRequest({
        mode: 'review',
        maxItems: 12,
        questionIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 25],
      }),
      dueCardsContext(),
    );
    expect(plan.items).toHaveLength(12);
    expect(new Set(plan.items.map((item) => item.actId))).toEqual(new Set([1, 2, 3]));
  });

  it('renseigne un descripteur complet et cohérent', () => {
    const plan = buildOk(makeRequest({ maxItems: 10 }), dueCardsContext());
    const descriptor = plan.interleaving;
    expect(descriptor.actSequence).toHaveLength(plan.items.length);
    expect(descriptor.directionSequence).toHaveLength(plan.items.length);
    expect(descriptor.productionCount + descriptor.discriminationCount).toBe(plan.items.length);
    const totalDirections = Object.values(descriptor.directionCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(totalDirections).toBe(plan.items.length);
    for (const direction of ALL_DIRECTIONS) {
      expect(descriptor.directionCounts[direction]).toBe(
        descriptor.directionSequence.filter((entry) => entry === direction).length,
      );
    }
  });
});

describe('builder — indices L9 et accroches L11', () => {
  it('disabled : aucun indice', () => {
    const plan = buildOk(makeRequest({ mode: 'grand-oral' }), dueCardsContext());
    expect(plan.config.hintPolicy).toBe('disabled');
    for (const item of plan.items) {
      expect(item.hints).toEqual([]);
    }
  });

  it('on-demand : échelle d’indices sans la réponse complète', () => {
    const plan = buildOk(makeRequest({ mode: 'learning', maxItems: 5 }), dueCardsContext());
    const kinds = plan.items[0]?.hints.map((hint) => hint.kind) ?? [];
    expect(kinds).toEqual(['initials', 'first-words', 'keyword', 'mental-image']);
    expect(kinds).not.toContain('full-answer');
  });

  it('progressive : échelle complète, réponse complète incluse', () => {
    const plan = buildOk(
      makeRequest({ mode: 'discovery', maxItems: 3 }),
      makeContext({ cards: new Map() }),
    );
    const kinds = plan.items[0]?.hints.map((hint) => hint.kind) ?? [];
    expect(kinds).toContain('full-answer');
    expect(kinds.at(-1)).toBe('full-answer');
  });

  it('réinjecte l’accroche personnelle en indice (L11)', () => {
    const plan = buildOk(
      makeRequest({ mode: 'learning', maxItems: 5, questionIds: [7] }),
      dueCardsContext({ hooks: [makeHook(7, 'mon accroche personnelle')] }),
    );
    const item = plan.items[0];
    const hook = item?.hints.find((hint) => hint.kind === 'personal-hook');
    expect(hook?.content.fr).toBe('mon accroche personnelle');
  });

  it('full-answer restitue le numéro pour `question-to-number`', () => {
    const plan = buildOk(
      makeRequest({
        mode: 'discovery',
        maxItems: 36,
        maxDurationMs: 1_200_000,
        directions: ['question-to-number'],
      }),
      makeContext({ cards: new Map() }),
    );
    for (const item of plan.items) {
      expect(item.direction).toBe('question-to-number');
      const full = item.hints.find((hint) => hint.kind === 'full-answer');
      expect(full?.content.fr).toBe(String(item.questionId));
    }
  });
});

describe('builder — prétest L18', () => {
  it('marque `isPretest` en mode discovery et jamais en review', () => {
    const discovery = buildOk(
      makeRequest({ mode: 'discovery', maxItems: 3 }),
      makeContext({ cards: new Map() }),
    );
    expect(discovery.items.every((item) => item.isPretest)).toBe(true);

    const review = buildOk(makeRequest({ mode: 'review', maxItems: 3 }), dueCardsContext());
    expect(review.items.some((item) => item.isPretest)).toBe(false);
  });
});

describe('builder — jugement de confiance réglable (L12)', () => {
  it('un `requiresConfidence` explicite prime sur le défaut du mode', () => {
    const forcedOn = buildOk(
      makeRequest({ mode: 'learning', requiresConfidence: true }),
      dueCardsContext(),
    );
    expect(forcedOn.config.requiresConfidence).toBe(true);

    const forcedOff = buildOk(
      makeRequest({ mode: 'review', requiresConfidence: false }),
      dueCardsContext(),
    );
    expect(forcedOff.config.requiresConfidence).toBe(false);
  });

  it('sans demande explicite, le défaut du mode s’applique', () => {
    const review = buildOk(makeRequest({ mode: 'review' }), dueCardsContext());
    expect(review.config.requiresConfidence).toBe(true);

    const learning = buildOk(makeRequest({ mode: 'learning' }), dueCardsContext());
    expect(learning.config.requiresConfidence).toBe(false);
  });
});

describe('builder — modes examen : aucune discrimination (L1)', () => {
  const EXAM_MODES = ['recitation', 'grand-oral'] as const;

  it('aucun QCM en grand-oral', () => {
    const plan = buildOk(makeRequest({ mode: 'grand-oral' }), dueCardsContext());
    expect(plan.config.productionOnly).toBe(true);
    expect(plan.config.maxDiscriminationRatio).toBe(0);
    expect(plan.items).toHaveLength(36);
    expect(plan.interleaving.discriminationCount).toBe(0);
    expect(plan.items.every((item) => item.exerciseKind === 'production')).toBe(true);
  });

  it('aucun QCM en recitation', () => {
    const plan = buildOk(makeRequest({ mode: 'recitation' }), dueCardsContext());
    expect(plan.config.productionOnly).toBe(true);
    expect(plan.config.maxDiscriminationRatio).toBe(0);
    expect(plan.items).toHaveLength(36);
    expect(plan.interleaving.discriminationCount).toBe(0);
    for (const item of plan.items) {
      expect(item.exerciseKind).toBe('production');
      expect(item.direction).toBe('order-to-question');
    }
  });

  it('recitation couvre 36 items', () => {
    const plan = buildOk(makeRequest({ mode: 'recitation' }), dueCardsContext());
    expect(plan.items).toHaveLength(36);
    expect(new Set(plan.items.map((item) => item.questionId)).size).toBe(36);

    // Acte demandé : tout l'acte (12 scènes), jamais un repli à 20 items.
    const actPlan = buildOk(makeRequest({ mode: 'recitation', actIds: [2] }), dueCardsContext());
    expect(actPlan.items).toHaveLength(12);
    for (const item of actPlan.items) {
      expect(item.actId).toBe(2);
    }
  });

  it('aucun QCM dans un mode examen', () => {
    for (const mode of EXAM_MODES) {
      const plan = buildOk(makeRequest({ mode }), dueCardsContext());
      expect(plan.config.productionOnly).toBe(true);
      expect(plan.items.some((item) => item.exerciseKind === 'discrimination')).toBe(false);
      expect(plan.interleaving.discriminationCount).toBe(0);
    }
  });
});
