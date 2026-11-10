import { describe, expect, it } from 'vitest';

import { DAY_MS } from '@/domain/shared/types';
import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import type { PlayerState, StreakState } from '@/domain/gamification/types';
import { createHarness, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Série quotidienne : validée **une seule fois par jour** (au premier item
 * réussi), gel consommé après un jour manqué, record jamais perdu.
 */

function runOneProduction(harness: TestHarness): void {
  const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
  const item = started.plan.items[0];
  if (item === undefined) {
    throw new Error('item manquant');
  }
  harness.useCases.submitAnswer.execute({
    sessionId: started.plan.id,
    itemId: item.id,
    grade: 'good',
    confidence: null,
    responseTimeMs: 1_000,
    hintsUsed: 0,
    channel: 'written',
  });
}

function streakOf(harness: TestHarness): StreakState {
  const raw = harness.storage.read(STORAGE_KEY);
  if (!raw.ok || raw.value === null) {
    throw new Error('progression absente du stockage');
  }
  const stored = JSON.parse(raw.value) as PersistedProgress;
  return stored.player.streak;
}

describe('série quotidienne — une validation par jour, gel, record', () => {
  it('n\u2019allonge la série qu\u2019une fois pour deux sessions du même jour', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    runOneProduction(harness);
    expect(streakOf(harness).current).toBe(1);

    // Deuxième session le même jour : la journée est déjà validée.
    runOneProduction(harness);
    const streak = streakOf(harness);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(1);
    expect(streak.lastActiveDay).toBe('2026-06-10');
  });

  it('consomme un gel après un jour manqué et préserve le record', () => {
    const harness = createHarness();
    const player: PlayerState = {
      ...seedFreshProgress(harness).player,
      totalXp: 0,
      streak: {
        current: 3,
        longest: 5,
        lastActiveDay: '2026-06-08',
        freezes: 1,
        frozenDays: [],
      },
    };
    const seeded = seedFreshProgress(harness);
    harness.storage.seedRaw(STORAGE_KEY, harness.codec.encode({ ...seeded, player }));

    // Deux jours après le 8 juin : le 9 est manqué → gel consommé.
    runOneProduction(harness);
    const afterCatchUp = streakOf(harness);
    expect(afterCatchUp.current).toBe(4);
    expect(afterCatchUp.freezes).toBe(0);
    expect(afterCatchUp.frozenDays).toEqual(['2026-06-09']);
    // Le record n'est jamais perdu (ni par la rupture, ni par la reprise).
    expect(afterCatchUp.longest).toBe(5);

    // Le lendemain, la série continue sans consommer quoi que ce soit.
    harness.clock.advance(DAY_MS);
    runOneProduction(harness);
    const nextDay = streakOf(harness);
    expect(nextDay.current).toBe(5);
    expect(nextDay.freezes).toBe(0);
    expect(nextDay.longest).toBe(5);
  });

  it('repart de 1 après une rupture non couverte, record intact', () => {
    const harness = createHarness();
    const seeded = seedFreshProgress(harness);
    harness.storage.seedRaw(
      STORAGE_KEY,
      harness.codec.encode({
        ...seeded,
        player: {
          ...seeded.player,
          streak: {
            current: 3,
            longest: 7,
            lastActiveDay: '2026-06-05',
            freezes: 0,
            frozenDays: [],
          },
        },
      }),
    );

    // Cinq jours plus tard, sans gel : la série repart de 1 (jamais de perte
    // de progression ni de punition, mais la continuité est rompue).
    harness.clock.advance(5 * DAY_MS);
    runOneProduction(harness);
    const streak = streakOf(harness);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(7);
    expect(streak.lastActiveDay).toBe('2026-06-15');
  });
});
