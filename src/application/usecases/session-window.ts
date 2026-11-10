import { HOUR_MS, SESSION_WINDOW_HOURS } from '@/domain/shared/types';
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
 * L'heure locale est mesurée comme l'écart entre l'instant et le début du jour
 * local (`ClockPort.startOfLocalDay(ClockPort.dayKey(at))`) — le port n'expose
 * pas d'heure locale directe, et la couche application n'a le droit d'utiliser
 * aucune horloge implicite. Limite documentée : les jours de transition
 * horaire (DST), l'écart peut différer de l'heure civile d'une heure, ce qui
 * ne déplace la fenêtre qu'au voisinage immédiat d'une borne. Un port exposant
 * un jour l'heure locale exacte remplacera cette arithmétique sans changer
 * d'appelant.
 */
export function resolveSessionWindow(clock: ClockPort, at: EpochMs): SessionWindow {
  const startOfLocalDay = clock.startOfLocalDay(clock.dayKey(at));
  const localHour = Math.floor((at - startOfLocalDay) / HOUR_MS);
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
