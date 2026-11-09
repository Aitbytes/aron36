import type { DayKey, EpochMs } from '@/domain/shared/types';

/**
 * Port d'horloge.
 *
 * Le domaine ne lit jamais `Date.now()` : toute date lui est fournie en ms
 * epoch. Les tests injectent une horloge fixe ou avançable, ce qui rend les
 * échéances SRS, les séries et les quêtes strictement déterministes.
 */
export interface ClockPort {
  /** Instant courant en ms depuis l'époque Unix (UTC). */
  now(): EpochMs;
  /**
   * Jour civil local de `at`, au format `YYYY-MM-DD`.
   * Le fuseau est celui de l'implémentation (`timeZone`).
   */
  dayKey(at: EpochMs): DayKey;
  /** Début du jour local `dayKey`, en ms epoch. */
  startOfLocalDay(dayKey: DayKey): EpochMs;
  /** Fuseau IANA utilisé, ex. `Europe/Paris`. */
  readonly timeZone: string;
}
