import type { ClockPort } from '@/application/ports/ClockPort';
import type { DayKey, EpochMs } from '@/domain/shared/types';

/**
 * Horloge figée pour les tests de persistance (ADR 0008 : temps injecté).
 * Implémentation UTC minimale, suffisante pour `loadProgress`/`saveProgress`
 * qui ne consomment que `now()`.
 */
export function createFixedClock(fixed: EpochMs): ClockPort {
  return {
    timeZone: 'UTC',
    now: () => fixed,
    dayKey(at: EpochMs): DayKey {
      return new Date(at).toISOString().slice(0, 10);
    },
    startOfLocalDay(dayKey: DayKey): EpochMs {
      return Date.parse(`${dayKey}T00:00:00Z`);
    },
  };
}
