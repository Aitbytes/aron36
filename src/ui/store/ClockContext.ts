import { createContext, useContext } from 'react';

import type { ClockPort } from '@/application/ports/ClockPort';
import type { EpochMs } from '@/domain/shared/types';

/**
 * Horloge applicative.
 *
 * L'UI **n'appelle jamais** `Date.now()` : les sélecteurs paramétrés (cartes
 * dues, jour courant) reçoivent l'instant du `ClockPort` injecté par la
 * composition racine. Un seul port, une seule vérité temporelle.
 */
export const ClockContext = createContext<ClockPort | null>(null);

/** Horloge courante ; lève si le `ClockProvider` est absent. */
export function useClock(): ClockPort {
  const clock = useContext(ClockContext);
  if (clock === null) {
    throw new Error('useClock doit être utilisé sous <ClockProvider>.');
  }
  return clock;
}

/** Instant courant (ms epoch). */
export function useNow(): EpochMs {
  return useClock().now();
}
