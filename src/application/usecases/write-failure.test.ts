import { describe, expect, it } from 'vitest';

import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { createHarness, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Échecs d'écriture non fatals (ARCHITECTURE § 5.4) : un support défaillant
 * (quota dépassé, mode privé) ne doit ni lever, ni perdre la session en cours.
 * Chaque sortie de cas d'usage qui écrit porte `writeFailure` ; l'état en
 * mémoire du dépôt reste la référence jusqu'à rétablissement du support.
 */

const QUOTA_FAILURE = {
  code: 'quota-exceeded' as const,
  message: 'quota localStorage dépassé (test)',
};

function readStored(harness: TestHarness): PersistedProgress {
  const raw = harness.storage.read(STORAGE_KEY);
  if (!raw.ok || raw.value === null) {
    throw new Error('progression absente du stockage');
  }
  return JSON.parse(raw.value) as PersistedProgress;
}

/** Démarre une session d'un item et y répond ; renvoie la sortie brute. */
function answerOne(harness: TestHarness) {
  const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
  const item = started.plan.items[0];
  if (item === undefined) {
    throw new Error('item manquant');
  }
  harness.clock.advance(1_000);
  return harness.useCases.submitAnswer.execute({
    sessionId: started.plan.id,
    itemId: item.id,
    grade: 'good',
    confidence: null,
    responseTimeMs: 1_000,
    hintsUsed: 0,
    channel: 'written',
  });
}

describe('writeFailure — échec d\u2019écriture sans perte silencieuse', () => {
  it('renvoie la réponse normalement et reporte writeFailure quand le stockage échoue', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    harness.storage.failWrites(QUOTA_FAILURE);

    const output = answerOne(harness);

    // Le résultat est complet et normal : rien n'a levé.
    expect(output.session.phase).toBe('completed');
    expect(output.xp.amount).toBeGreaterThan(0);
    expect(output.answer.isCorrect).toBe(true);
    // L'échec d'écriture est exposé, jamais avalé.
    expect(output.writeFailure).not.toBeNull();
    expect(output.writeFailure?.code).toBe('quota-exceeded');
    // Le stockage n'a pas été modifié : la donnée précédente est intacte.
    expect(readStored(harness).reviewLogs).toHaveLength(0);
  });

  it('conserve l\u2019état en mémoire : la réponse suivante retrouve tout après rétablissement', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    harness.storage.failWrites(QUOTA_FAILURE);

    const failed = answerOne(harness);
    expect(failed.writeFailure?.code).toBe('quota-exceeded');

    // Rétablissement du support, puis seconde réponse dans une NOUVELLE
    // session : l'état mémoire du dépôt (première réponse comprise) est
    // enfin persisté en entier.
    harness.storage.failWrites(null);
    const second = answerOne(harness);
    expect(second.writeFailure).toBeNull();

    const stored = readStored(harness);
    expect(stored.reviewLogs).toHaveLength(2);
    expect(stored.reviewLogs[0]?.id).toBe(failed.updatedProgress.reviewLogs[0]?.id);
    expect(stored.player.totalXp).toBe(
      (failed.updatedProgress.player.totalXp ?? 0) + second.xp.amount,
    );
  });

  it('reporte l\u2019échec sur finishSession sans lever', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
    harness.storage.failWrites(QUOTA_FAILURE);

    const finished = harness.useCases.finishSession.execute({
      sessionId: started.plan.id,
      now: harness.clock.now(),
      window: 'morning',
    });

    expect(finished.summary.itemCount).toBe(1);
    expect(finished.writeFailure?.code).toBe('quota-exceeded');
    expect(finished.updatedProgress.sessionLogs).toHaveLength(1);
  });

  it('reporte l\u2019échec sur saveHook sans lever', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    harness.storage.failWrites(QUOTA_FAILURE);

    const saved = harness.useCases.saveHook.execute({
      questionId: 5,
      kind: 'keyword',
      text: 'le mot de passe est mer',
    });

    expect(saved.hook.text).toBe('le mot de passe est mer');
    expect(saved.updatedProgress.hooks.hooks).toHaveLength(1);
    expect(saved.writeFailure?.code).toBe('quota-exceeded');
  });

  it('reporte l\u2019échec sur resetProgress sans lever : le profil neuf reste en mémoire', () => {
    const harness = createHarness();
    const seeded = seedFreshProgress(harness);
    harness.storage.seedRaw(
      STORAGE_KEY,
      harness.codec.encode({
        ...seeded,
        player: { ...seeded.player, totalXp: 120 },
      }),
    );
    harness.storage.failWrites(QUOTA_FAILURE);

    const reset = harness.useCases.resetProgress.execute();

    // Résultat normal, échec exposé : l'UI proposera l'export (§ 5.4).
    expect(reset.progress.player.totalXp).toBe(0);
    expect(reset.writeFailure?.code).toBe('quota-exceeded');
    // Le stockage garde l'ancienne donnée : aucun écrasement partiel.
    expect(readStored(harness).player.totalXp).toBe(120);
  });
});
