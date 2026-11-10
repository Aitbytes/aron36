import { describe, expect, it } from 'vitest';

import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { UseCaseRejection } from './errors';
import { createHarness, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Cycle de vie des sessions (majeur A7) : une session terminée, abandonnée,
 * remplacée par une réinitialisation ou par un import ne doit **jamais**
 * accepter de réponse ultérieure. Preuve avant : après `resetProgress` (ou un
 * import, ou un abandon), une réponse de l'ancienne session était acceptée et
 * écrite dans le nouveau profil.
 */

function readStored(harness: TestHarness): PersistedProgress {
  const raw = harness.storage.read(STORAGE_KEY);
  if (!raw.ok || raw.value === null) {
    throw new Error('progression absente du stockage');
  }
  return JSON.parse(raw.value) as PersistedProgress;
}

function submit(
  harness: TestHarness,
  sessionId: string,
  index: number,
  grade: 'good' | 'again' = 'good',
) {
  return harness.useCases.submitAnswer.execute({
    sessionId,
    itemId: `${sessionId}:${String(index)}`,
    grade,
    confidence: null,
    responseTimeMs: 1_000,
    hintsUsed: 0,
    channel: 'written',
  });
}

describe('abandonSession — clôture propre et rejet des réponses ultérieures', () => {
  it('renvoie un résumé partiel sans journal quand aucune réponse n’a été donnée', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 3 });

    const abandoned = harness.useCases.abandonSession.execute({ sessionId: started.plan.id });

    expect(abandoned.summary.sessionId).toBe(started.plan.id);
    expect(abandoned.summary.answeredCount).toBe(0);
    expect(abandoned.writeFailure).toBeNull();
    // Aucune session vierge n'est journalisée, et rien n'a été écrit.
    expect(readStored(harness).sessionLogs).toHaveLength(0);
  });

  it('journalise un résumé partiel quand des réponses existent, puis rejette la suite', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 3 });
    submit(harness, started.plan.id, 0);
    submit(harness, started.plan.id, 1);

    const abandoned = harness.useCases.abandonSession.execute({ sessionId: started.plan.id });

    expect(abandoned.summary.answeredCount).toBe(2);
    expect(abandoned.summary.itemCount).toBe(3);
    const log = readStored(harness).sessionLogs.at(-1);
    expect(log?.itemCount).toBe(3);
    expect(log?.correctCount).toBe(2);

    // Toute réponse ultérieure est refusée : la session a bien été oubliée.
    expect(() => submit(harness, started.plan.id, 2)).toThrowError(UseCaseRejection);
    try {
      submit(harness, started.plan.id, 2);
    } catch (error) {
      expect((error as UseCaseRejection).reason).toBe('unknown-session');
    }
  });

  it('refuse d’abandonner une session inconnue ou déjà abandonnée', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    expect(() => harness.useCases.abandonSession.execute({ sessionId: 'session-fantome' })).toThrow(
      UseCaseRejection,
    );
  });
});

describe('sessions fantômes — resetProgress et importProgress purgent les sessions', () => {
  it('rejette la réponse d’une session antérieure après une réinitialisation', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 2 });
    submit(harness, started.plan.id, 0);

    harness.useCases.resetProgress.execute();

    // Le profil est neuf : l'ancienne session n'existe plus côté cas d'usage.
    expect(() => submit(harness, started.plan.id, 1)).toThrowError(UseCaseRejection);
    let caught: unknown;
    try {
      submit(harness, started.plan.id, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UseCaseRejection);
    expect((caught as UseCaseRejection).reason).toBe('unknown-session');
  });

  it('rejette la réponse d’une session antérieure après un import', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 2 });
    submit(harness, started.plan.id, 0);
    const exported = harness.useCases.exportProgress.execute();

    const imported = harness.useCases.importProgress.execute({ raw: exported.json });
    expect(imported.ok).toBe(true);

    // L'import a remplacé le profil : la session d'avant n'est plus connue.
    expect(() => submit(harness, started.plan.id, 1)).toThrowError(UseCaseRejection);
    let caught: unknown;
    try {
      submit(harness, started.plan.id, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UseCaseRejection);
    expect((caught as UseCaseRejection).reason).toBe('unknown-session');
  });
});
