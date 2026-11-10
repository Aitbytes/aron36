import { describe, expect, it } from 'vitest';

import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { createInitialAppState, reduce } from '@/application/store';
import { createHarness, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Sonde « store vs persisté » (bloquant A1).
 *
 * Avant la décision d'architecture, le store affichait
 * `{streak: 0, badges: [], questBoard: null}` pendant que la progression
 * persistée portait `{streak: 1, badges: ['premier-pas'], questBoard:
 * [3 quêtes]}` : les quatre champs divergeaient. La progression ayant un seul
 * propriétaire (les cas d'usage), l'action `session/answered` transporte
 * l'état complet et le store l'installe — la sonde doit désormais montrer
 * **l'égalité stricte** entre l'état du store et le stockage.
 */

function readStored(harness: TestHarness): PersistedProgress {
  const raw = harness.storage.read(STORAGE_KEY);
  if (!raw.ok || raw.value === null) {
    throw new Error('progression absente du stockage');
  }
  return JSON.parse(raw.value) as PersistedProgress;
}

describe('sonde store vs persisté — quatre champs jadis divergents', () => {
  it('installe exactement la progression persistée (streak, badges, questBoard, collection, XP)', () => {
    const harness = createHarness();
    const seeded = seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }
    const output = harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId: item.id,
      grade: 'good',
      confidence: 4,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });

    // L'UI dispatche l'état produit par le cas d'usage (ou `progress/replaced`).
    const store = reduce(createInitialAppState(seeded), {
      type: 'session/answered',
      session: output.session,
      answer: output.answer,
      feedback: output.feedback,
      xp: output.xp,
      progress: output.updatedProgress,
    });

    const persisted = readStored(harness);
    // Le store et le stockage sont le même objet : la divergence est impossible.
    expect(store.progress).toBe(output.updatedProgress);
    expect(store.progress.player.streak).toEqual(persisted.player.streak);
    expect(store.progress.player.badges).toEqual(persisted.player.badges);
    expect(store.progress.player.questBoard).toEqual(persisted.player.questBoard);
    expect(store.progress.player.collection).toEqual(persisted.player.collection);
    expect(store.progress.player.totalXp).toBe(persisted.player.totalXp);
    expect(store.progress.cards).toEqual(persisted.cards);
    expect(store.progress.reviewLogs).toEqual(persisted.reviewLogs);

    // La sonde doit être non triviale : les champs ont réellement bougé.
    expect(persisted.player.streak.current).toBe(1);
    expect(persisted.player.questBoard?.quests).toHaveLength(3);
    expect(persisted.reviewLogs).toHaveLength(1);
  });

  it('reste idempotent : réinstaller la même progression ne change rien', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
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
    const action = {
      type: 'session/answered' as const,
      session: output.session,
      answer: output.answer,
      feedback: output.feedback,
      xp: output.xp,
      progress: output.updatedProgress,
    };

    const once = reduce(createInitialAppState(seedFreshProgress(harness)), action);
    const twice = reduce(once, action);

    // Le remplacement est absolu : rejouer l'action ne recompte rien.
    expect(twice.progress).toBe(once.progress);
    expect(twice.progress.player.totalXp).toBe(output.updatedProgress.player.totalXp);
  });
});
