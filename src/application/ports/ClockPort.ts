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
  /**
   * Heure civile locale de `at`, de 0 à 23, dans le fuseau de l'implémentation.
   *
   * C'est la **seule** source d'heure locale de la couche application :
   * déduire l'heure d'un écart à `startOfLocalDay` est faux les jours de
   * changement d'heure (l'écart vaut 23 ou 25 h), ce qui décalait la fenêtre
   * L17 d'une heure (revue Phase 3). Les implémentations s'appuient sur `Intl`,
   * jamais sur une arithmétique de 24 h.
   */
  localHourOfDay(at: EpochMs): number;
  /** Début du jour local `dayKey`, en ms epoch. */
  startOfLocalDay(dayKey: DayKey): EpochMs;
  /** Fuseau IANA utilisé, ex. `Europe/Paris`. */
  readonly timeZone: string;
}
