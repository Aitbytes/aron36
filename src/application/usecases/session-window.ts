import { SESSION_WINDOW_HOURS } from '@/domain/shared/types';
import type { EpochMs, SessionWindow } from '@/domain/shared/types';
import type { ClockPort } from '@/application/ports/ClockPort';

/**
 * Fenêtre de journée (L17), déduite du fuseau de `ClockPort`.
 *
 * Le domaine ne connaît aucune horloge : c'est la couche application qui
 * classifie `SessionWindow` à partir des bornes gelées
 * (`SESSION_WINDOW_HOURS` : `morning` [5, 12), `day` [12, 19), `evening`
 * [19, 23), `night` [23, 5)) et de l'heure **locale** fournie par le port.
 *
 * L'heure locale est fournie directement par `ClockPort.localHourOfDay(at)`,
 * dont l'implémentation s'appuie sur `Intl` (base tz du moteur). L'ancien
 * calcul par écart à `startOfLocalDay` décalait la fenêtre d'une heure les
 * jours de changement d'heure : il a été supprimé (revue Phase 3, majeur A6).
 * La couche application n'utilise toujours aucune horloge implicite.
 */
export function resolveSessionWindow(clock: ClockPort, at: EpochMs): SessionWindow {
  // Heure civile locale exacte, fournie par le port : l'ancien calcul
  // `(at - startOfLocalDay(at)) / HOUR_MS` décalait la fenêtre d'une heure les
  // jours de changement d'heure (revue Phase 3, majeur A6).
  const localHour = clock.localHourOfDay(at);
  const bounds = SESSION_WINDOW_HOURS;
  if (localHour < bounds.morningStart || localHour >= bounds.nightStart) {
    return 'night';
  }
  if (localHour < bounds.dayStart) {
    return 'morning';
  }
  if (localHour < bounds.eveningStart) {
    return 'day';
  }
  return 'evening';
}
