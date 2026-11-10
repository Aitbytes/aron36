import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '@/domain/session/types';

import {
  evaluateGrandOral,
  formatElapsed,
  GRAND_ORAL_ITEM_COUNT,
  GRAND_ORAL_MAX_DURATION_MS,
  GRAND_ORAL_PASS_ACCURACY,
  GRAND_ORAL_SILVER_ACCURACY,
} from './grandOralCriteria';

/** Résumé minimal mais valide, pour ne tester qu'une seule dimension à la fois. */
function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 'session-oral',
    mode: 'grand-oral',
    itemCount: GRAND_ORAL_ITEM_COUNT,
    answeredCount: GRAND_ORAL_ITEM_COUNT,
    correctCount: GRAND_ORAL_ITEM_COUNT,
    accuracy: 1,
    durationMs: 300_000,
    xpAwarded: 0,
    spokenCount: GRAND_ORAL_ITEM_COUNT,
    window: 'evening',
    byDirection: {
      'order-to-question': { attempts: 0, correct: 0 },
      'keyword-to-question': { attempts: 0, correct: 0 },
      'image-to-question': { attempts: 0, correct: 0 },
      'number-to-question': { attempts: 0, correct: 0 },
      'question-to-number': { attempts: 0, correct: 0 },
    },
    ...overrides,
  };
}

describe('evaluateGrandOral — réussite et paliers', () => {
  it('réussit à 5 min et 95 % avec le palier Diamant', () => {
    const outcome = evaluateGrandOral(
      summary({ durationMs: 5 * 60 * 1000, accuracy: 0.95, correctCount: 19 }),
    );

    expect(outcome.passed).toBe(true);
    expect(outcome.tier).toBe('diamond');
    expect(outcome.failureCauses).toEqual([]);
    expect(outcome.durationMs).toBe(300_000);
    expect(outcome.accuracy).toBe(0.95);
    expect(outcome.itemCount).toBe(GRAND_ORAL_ITEM_COUNT);
  });

  it('réussit exactement aux seuils (6 min, 90 %)', () => {
    const outcome = evaluateGrandOral(
      summary({ durationMs: GRAND_ORAL_MAX_DURATION_MS, accuracy: GRAND_ORAL_PASS_ACCURACY }),
    );

    expect(outcome.passed).toBe(true);
    expect(outcome.tier).toBe('diamond');
  });

  it('échoue d’un millième sur la durée (palier Or, cause durée)', () => {
    const outcome = evaluateGrandOral(
      summary({ durationMs: GRAND_ORAL_MAX_DURATION_MS + 1, accuracy: 0.95 }),
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.tier).toBe('gold');
    expect(outcome.failureCauses).toEqual(['duration']);
  });

  it('échoue à 7 min et 95 % : cause durée seule', () => {
    const outcome = evaluateGrandOral(summary({ durationMs: 420_000, accuracy: 0.95 }));

    expect(outcome.passed).toBe(false);
    expect(outcome.tier).toBe('gold');
    expect(outcome.failureCauses).toEqual(['duration']);
  });

  it('échoue à 5 min et 84 % : cause précision seule, palier Argent', () => {
    const outcome = evaluateGrandOral(summary({ durationMs: 300_000, accuracy: 0.84 }));

    expect(outcome.passed).toBe(false);
    expect(outcome.tier).toBe('silver');
    expect(outcome.failureCauses).toEqual(['accuracy']);
  });

  it('tombe au palier Bronze sous 80 %', () => {
    const outcome = evaluateGrandOral(
      summary({ durationMs: 300_000, accuracy: GRAND_ORAL_SILVER_ACCURACY - 0.01 }),
    );

    expect(outcome.tier).toBe('bronze');
    expect(outcome.failureCauses).toEqual(['accuracy']);
  });

  it('cumule les deux causes quand durée et précision manquent', () => {
    const outcome = evaluateGrandOral(summary({ durationMs: 480_000, accuracy: 0.5 }));

    expect(outcome.passed).toBe(false);
    expect(outcome.tier).toBe('bronze');
    expect(outcome.failureCauses).toEqual(['duration', 'accuracy']);
  });
});

describe('formatElapsed — mm:ss', () => {
  it('formate les bornes utiles', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(90_000)).toBe('01:30');
    expect(formatElapsed(300_000)).toBe('05:00');
    expect(formatElapsed(420_000)).toBe('07:00');
  });

  it('tronque les millisecondes et ne descend jamais sous zéro', () => {
    expect(formatElapsed(1_999)).toBe('00:01');
    expect(formatElapsed(-5_000)).toBe('00:00');
  });
});
