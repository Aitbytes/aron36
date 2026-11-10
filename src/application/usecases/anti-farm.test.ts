import { describe, expect, it } from 'vitest';

import { XP_RULES, badgeEvaluator, metricsCalculator } from '@/domain/gamification';
import { BADGE_DEFINITIONS } from '@/domain/gamification/badges';
import { masteryEvaluator } from '@/domain/mastery';
import { DEFAULT_MASTERY_CRITERIA } from '@/domain/mastery/types';
import { QUESTIONS_PER_ACT } from '@/domain/shared/types';
import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import type { CardState } from '@/domain/srs/types';
import { findSeedStartingWithDiscrimination } from './test-doubles';
import { createHarness, NOW, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Économie de jeu : anti-farm par question et par jour, et Neutralité des QCM
 * (aucun bonus de session parfaite, aucun badge de production, aucune série).
 */

/** Amorce un harnais dont les cartes de l'acte I ont déjà été rencontrées. */
function harnessWithEncounteredActOne(seed?: string): TestHarness {
  const harness = createHarness(seed === undefined ? {} : { seed });
  const seeded = seedFreshProgress(harness);
  const cards: Record<string, CardState> = { ...seeded.cards };
  for (let questionId = 1; questionId <= 12; questionId += 1) {
    const current = cards[String(questionId)];
    if (current !== undefined) {
      cards[String(questionId)] = { ...current, reps: 3, phase: 'review' };
    }
  }
  harness.storage.seedRaw(STORAGE_KEY, harness.codec.encode({ ...seeded, cards }));
  return harness;
}

describe('anti-farm — répéter la même question le même jour', () => {
  it('épuise le barème : la 4ᵉ réponse du jour sur la question rapporte zéro', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    const amounts: number[] = [];
    for (let round = 0; round < 4; round += 1) {
      const started = harness.useCases.startSession.execute({
        mode: 'learning',
        questionIds: [1],
        maxItems: 1,
      });
      const item = started.plan.items[0];
      if (item === undefined) {
        throw new Error('item manquant');
      }
      const output = harness.useCases.submitAnswer.execute({
        sessionId: started.plan.id,
        itemId: item.id,
        grade: 'good',
        confidence: null,
        responseTimeMs: 1_000,
        hintsUsed: 0,
        channel: 'written',
      });
      amounts.push(output.xp.amount);

      if (round === 0) {
        // 1ʳᵉ réussite du jour : base + première exposition + sans indice + vitesse.
        const base = XP_RULES.baseByDirection[item.direction];
        expect(output.xp.breakdown?.firstExposureBonus).toBe(XP_RULES.firstExposureBonus);
        expect(output.xp.breakdown?.antiFarmFactor).toBe(1);
        expect(output.xp.amount).toBe(
          base + XP_RULES.firstExposureBonus + XP_RULES.noHintBonus + XP_RULES.speedBonus,
        );
      } else {
        const base = XP_RULES.baseByDirection[item.direction];
        const withoutFirstExposure = base + XP_RULES.noHintBonus + XP_RULES.speedBonus;
        const factor = XP_RULES.antiFarmFactors[round] ?? 0;
        expect(output.xp.amount).toBe(Math.floor(withoutFirstExposure * factor));
        expect(output.xp.breakdown?.antiFarmFactor).toBe(factor);
      }
    }

    // Décroissance stricte jusqu'au zéro (4ᵉ et suivantes : ×0).
    expect(amounts).toHaveLength(4);
    expect(amounts[0]).toBeGreaterThan(amounts[1] ?? 0);
    expect(amounts[1]).toBeGreaterThan(amounts[2] ?? 0);
    expect(amounts[2]).toBeGreaterThan(0);
    expect(amounts[3]).toBe(0);
    // Et l'XP totale est exactement la somme créditée (aucun contournement).
    const stored = JSON.parse(
      (harness.storage.read(STORAGE_KEY).ok ? harness.storage.read(STORAGE_KEY).value : '') ?? '',
    ) as PersistedProgress;
    expect(stored.player.totalXp).toBe(amounts.reduce((sum, amount) => sum + amount, 0));
  });
});

describe('anti-reconnaissance — une session entièrement QCM', () => {
  it('n\u2019ouvre aucun bonus de session parfaite ni badge de production ni série', () => {
    const harness = harnessWithEncounteredActOne(findSeedStartingWithDiscrimination());

    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 5 });
    const first = started.plan.items[0];
    if (first === undefined || first.exerciseKind !== 'discrimination') {
      throw new Error("la graine n'a pas produit de QCM en tête");
    }
    // Le QCM ne déplace jamais la carte SRS.
    const cardsBefore = readStored(harness).cards;
    const output = harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId: first.id,
      grade: 'good',
      confidence: null,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });
    expect(output.answer.exerciseKind).toBe('discrimination');
    expect(output.scheduledReview).toBeNull();

    const finished = harness.useCases.finishSession.execute({
      sessionId: started.plan.id,
      now: harness.clock.now(),
      window: 'morning',
    });

    // Bonus de session : complétion seulement, jamais « session parfaite ».
    expect(finished.xp.reason).toBe('session-complete');
    expect(finished.xp.amount).toBe(XP_RULES.sessionCompletionXp);

    const stored = readStored(harness);
    const log = stored.sessionLogs[0];
    expect(log?.productionCount).toBe(0);
    expect(log?.discriminationCount).toBe(1);
    expect(log?.xpAwarded).toBe(0);

    // Aucun badge de production ne progresse : les métriques filtres les QCM.
    const mastery = masteryEvaluator.evaluate(
      {
        cards: Object.values(stored.cards),
        reviewLogs: stored.reviewLogs,
        questionsPerAct: QUESTIONS_PER_ACT,
        now: NOW,
      },
      DEFAULT_MASTERY_CRITERIA,
    );
    const metrics = metricsCalculator.compute({
      reviewLogs: stored.reviewLogs,
      sessionLogs: stored.sessionLogs,
      mastery: mastery.acts.flatMap((act) => act.questions),
      hooksCount: stored.hooks.hooks.length,
      collection: stored.player.collection,
      streak: stored.player.streak,
      oralExamPasses: 0,
      bestOralExam: null,
    });
    expect(metrics.productionAnswers).toBe(0);
    expect(metrics.perfectSessions).toBe(0);
    const badges = badgeEvaluator.evaluate(
      BADGE_DEFINITIONS,
      metrics,
      stored.player.badges,
      harness.clock.now(),
    );
    const premierPas = badges.find((badge) => badge.badgeId === 'premier-pas');
    expect(premierPas?.progress).toBe(0);
    expect(premierPas?.unlockedAt).toBeNull();

    // Une réponse de QCM ne valide pas la journée : la série reste à zéro.
    expect(stored.player.streak.current).toBe(0);
    // Et la carte QCM n'a pas bougé (aucun ordonnancement).
    expect(stored.cards[String(first.questionId)]).toEqual(cardsBefore[String(first.questionId)]);
  });
});

/** Lit l'état persisté du harnais. */
function readStored(harness: TestHarness): PersistedProgress {
  const raw = harness.storage.read(STORAGE_KEY);
  if (!raw.ok || raw.value === null) {
    throw new Error('progression absente du stockage');
  }
  return JSON.parse(raw.value) as PersistedProgress;
}
