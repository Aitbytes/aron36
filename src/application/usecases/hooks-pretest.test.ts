import { describe, expect, it } from 'vitest';

import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { UseCaseRejection } from './errors';
import { createHarness, seedFreshProgress } from './test-doubles';

/**
 * Accroches personnelles (L10, L11) et prétest (L18) : l'accroche enregistrée
 * revient comme indice de drill ; la devinette du prétest ne journalise rien
 * et ne touche pas la carte SRS.
 */

describe('saveHook — génération et réinjection (L10, L11)', () => {
  it('enregistre l\u2019accroche puis la réinjecte dans un plan ultérieur', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    const saved = harness.useCases.saveHook.execute({
      questionId: 3,
      kind: 'keyword',
      text: '  le mot de passe   est mer  ',
    });
    // Le texte est normalisé (espaces) et horodaté par l'horloge injectée.
    expect(saved.hook.text).toBe('le mot de passe est mer');
    expect(saved.hook.createdAt).toBe(harness.clock.now());

    // Persistance immédiate.
    const raw = harness.storage.read(STORAGE_KEY);
    expect(raw.ok ? (raw.value ?? '') : '').toContain('le mot de passe est mer');

    // Réinjection comme indice `personal-hook` dans un plan ultérieur.
    const started = harness.useCases.startSession.execute({
      mode: 'learning',
      questionIds: [3],
      maxItems: 1,
    });
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }
    const hookHint = item.hints.find((hint) => hint.kind === 'personal-hook');
    expect(hookHint?.content.fr).toBe('le mot de passe est mer');
  });

  it('remplace une accroche existante (au plus une par question)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    harness.useCases.saveHook.execute({ questionId: 5, kind: 'story', text: 'première image' });
    const replaced = harness.useCases.saveHook.execute({
      questionId: 5,
      kind: 'keyword',
      text: 'image remplacée',
    });
    expect(replaced.hook.text).toBe('image remplacée');
    expect(replaced.updatedProgress.hooks.hooks).toHaveLength(1);
    // La création d'origine est conservée, la mise à jour est datée.
    expect(replaced.hook.createdAt).toBe(harness.clock.now());
    expect(replaced.hook.updatedAt).toBe(harness.clock.now());
  });

  it('refuse une accroche vide avec un rejet typé', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    expect(() =>
      harness.useCases.saveHook.execute({ questionId: 1, kind: 'keyword', text: '   ' }),
    ).toThrowError(UseCaseRejection);
    try {
      harness.useCases.saveHook.execute({ questionId: 1, kind: 'keyword', text: '' });
    } catch (error) {
      expect((error as UseCaseRejection).reason).toBe('hook-refused');
      expect((error as UseCaseRejection).detail).toEqual({
        kind: 'hook',
        error: expect.objectContaining({ code: 'empty-text' }),
      });
    }
  });
});

describe('prétest — deviner avant de voir (L18)', () => {
  it('ne journalise rien et ne touche pas la carte SRS', () => {
    const harness = createHarness();
    const seeded = seedFreshProgress(harness);
    // Cartes toutes neuves : le mode découverte met un prétest devant chaque
    // question jamais rencontrée.
    const started = harness.useCases.startSession.execute({ mode: 'discovery', maxItems: 2 });
    const first = started.plan.items[0];
    if (first === undefined || !first.isPretest) {
      throw new Error('le premier item devrait être un prétest');
    }
    const cardBefore = seeded.cards[String(first.questionId)];

    const output = harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId: first.id,
      grade: 'easy',
      confidence: null,
      responseTimeMs: 3_000,
      hintsUsed: 0,
      channel: 'written',
    });

    // Aucun ordonnancement, aucun gain : la devinette n'est pas une production.
    expect(output.scheduledReview).toBeNull();
    expect(output.xp.amount).toBe(0);
    expect(output.answer.isPretest).toBe(true);
    // Le contrat de sortie est non nullable ; l'UI filtrera l'affichage (L18).
    expect(output.feedback).not.toBeNull();

    const stored = JSON.parse(
      harness.storage.read(STORAGE_KEY).ok ? (harness.storage.read(STORAGE_KEY).value ?? '') : '',
    ) as PersistedProgress;
    // Aucun journal, carte intacte.
    expect(stored.reviewLogs).toHaveLength(0);
    expect(stored.cards[String(first.questionId)]).toEqual(cardBefore);
    expect(stored.player.totalXp).toBe(0);
    // Pas de tentative de quête ni de validation de journée.
    expect(stored.player.questBoard).toBeNull();
    expect(stored.player.streak.current).toBe(0);
  });

  it('clôture une session de prétests sans XP de production ni journal', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'discovery', maxItems: 2 });
    for (let index = 0; index < 2; index += 1) {
      harness.useCases.submitAnswer.execute({
        sessionId: started.plan.id,
        itemId: `${started.plan.id}:${String(index)}`,
        grade: 'easy',
        confidence: null,
        responseTimeMs: 3_000,
        hintsUsed: 0,
        channel: 'written',
      });
    }
    const finished = harness.useCases.finishSession.execute({
      sessionId: started.plan.id,
      now: harness.clock.now(),
      window: 'morning',
    });
    // Bonus de complétion seulement : aucun XP de production n'a été gagné.
    expect(finished.xp.amount).toBe(10);
    expect(finished.summary.xpAwarded).toBe(0);
    const stored = JSON.parse(
      harness.storage.read(STORAGE_KEY).ok ? (harness.storage.read(STORAGE_KEY).value ?? '') : '',
    ) as PersistedProgress;
    expect(stored.sessionLogs[0]?.productionCount).toBe(0);
    expect(stored.reviewLogs).toHaveLength(0);
  });
});
