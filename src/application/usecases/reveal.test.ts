import { describe, expect, it } from 'vitest';

import { UseCaseRejection } from './errors';
import { createHarness, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Gestes de révélation (L9, majeur A8) : `revealHint` et `revealAnswer`
 * donnent accès au nouvel `SessionState` sans que l'UI ait à le produire.
 * Les refus du moteur (et l'absence d'indice) sont propagés explicitement.
 */

function start(harness: TestHarness, mode: 'learning' | 'review' | 'grand-oral') {
  return harness.useCases.startSession.execute({ mode, maxItems: 1 });
}

describe('revealHint — révélation incrémentale (L9)', () => {
  it('révèle un indice à la fois en politique on-demand', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = start(harness, 'learning');
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }
    expect(started.plan.config.hintPolicy).toBe('on-demand');
    expect(item.hints.length).toBeGreaterThan(1);

    const first = harness.useCases.revealHint.execute({ sessionId: started.plan.id });
    expect(first.state.revealedHints).toBe(1);
    const second = harness.useCases.revealHint.execute({ sessionId: started.plan.id });
    expect(second.state.revealedHints).toBe(2);
    // Chaque appel renvoie bien le nouvel état du moteur (pas une copie figée).
    expect(second.state).not.toBe(first.state);
  });

  it('refuse une fois tous les indices révélés', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = start(harness, 'learning');
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }
    for (let index = 0; index < item.hints.length; index += 1) {
      harness.useCases.revealHint.execute({ sessionId: started.plan.id });
    }
    expect(() => harness.useCases.revealHint.execute({ sessionId: started.plan.id })).toThrow(
      UseCaseRejection,
    );
    let caught: unknown;
    try {
      harness.useCases.revealHint.execute({ sessionId: started.plan.id });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UseCaseRejection);
    expect((caught as UseCaseRejection).reason).toBe('hint-unavailable');
  });

  it('refuse de révéler un indice en politique disabled (grand-oral)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = start(harness, 'grand-oral');

    expect(started.plan.config.hintPolicy).toBe('disabled');
    expect(started.plan.items[0]?.hints).toEqual([]);
    expect(() => harness.useCases.revealHint.execute({ sessionId: started.plan.id })).toThrow(
      UseCaseRejection,
    );
    let caught: unknown;
    try {
      harness.useCases.revealHint.execute({ sessionId: started.plan.id });
    } catch (error) {
      caught = error;
    }
    expect((caught as UseCaseRejection).reason).toBe('hint-unavailable');
    expect((caught as UseCaseRejection).detail).toEqual({
      kind: 'hint',
      sessionId: started.plan.id,
    });
  });

  it('refuse une session inconnue', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    expect(() => harness.useCases.revealHint.execute({ sessionId: 'session-fantome' })).toThrow(
      UseCaseRejection,
    );
  });
});

describe('revealAnswer — révélation séparée puis soumission', () => {
  it('passe en phase revealed et laisse la soumission aboutir sans wrong-phase', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = start(harness, 'learning');
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }

    const revealed = harness.useCases.revealAnswer.execute({ sessionId: started.plan.id });
    expect(revealed.state.phase).toBe('revealed');

    // Le cas d'usage submitAnswer ne rejoue pas la révélation : c'est le garde
    // de phase ajouté pour que les deux gestes coexistent.
    const output = harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId: item.id,
      grade: 'good',
      confidence: null,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });
    expect(output.answer.isCorrect).toBe(true);
    expect(output.session.phase).toBe('completed');
  });

  it('propage le refus confidence-required du moteur (mode review)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = start(harness, 'review');
    expect(started.plan.config.requiresConfidence).toBe(true);

    expect(() => harness.useCases.revealAnswer.execute({ sessionId: started.plan.id })).toThrow(
      UseCaseRejection,
    );
    let caught: unknown;
    try {
      harness.useCases.revealAnswer.execute({ sessionId: started.plan.id });
    } catch (error) {
      caught = error;
    }
    expect((caught as UseCaseRejection).reason).toBe('session-transition-refused');
    expect((caught as UseCaseRejection).detail).toEqual({
      kind: 'transition',
      failure: 'confidence-required',
    });
  });
});
