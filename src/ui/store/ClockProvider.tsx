import type { ReactNode } from 'react';

import type { ClockPort } from '@/application/ports/ClockPort';

import { ClockContext } from './ClockContext';

export interface ClockProviderProps {
  readonly clock: ClockPort;
  readonly children: ReactNode;
}

/** Fournit l'horloge injectée à l'arbre React (aucune horloge implicite). */
export function ClockProvider({ clock, children }: ClockProviderProps) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}
