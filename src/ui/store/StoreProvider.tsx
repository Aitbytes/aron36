import type { ReactNode } from 'react';

import type { AppStore } from '@/application/store';

import { StoreContext } from './StoreContext';

export interface StoreProviderProps {
  readonly store: AppStore;
  readonly children: ReactNode;
}

/** Fournit le store applicatif à l'arbre React. */
export function StoreProvider({ store, children }: StoreProviderProps) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
