import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

import type { AppAction, AppState, AppStore } from '@/application/store';

/**
 * Liaison store ↔ React (Phase 4-A).
 *
 * Le store applicatif est un objet sans React (`subscribe`/`getState`/`dispatch`).
 * Ces hooks sont la **seule** porte d'entrée des composants : aucun écran
 * n'instancie son propre store ni ne lit `localStorage`.
 */

export const StoreContext = createContext<AppStore | null>(null);

/** Store courant ; lève si le `StoreProvider` est absent. */
export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error('useAppStore doit être utilisé sous <StoreProvider>.');
  }
  return store;
}

/**
 * État applicatif, abonné au store via `useSyncExternalStore`.
 *
 * Le store ne notifie pas si l'état est identique par référence : un dispatch
 * sans effet ne provoque donc aucun rendu.
 */
export function useAppState(): AppState {
  const store = useAppStore();
  // Enveloppes stables : passer `store.subscribe` telle quelle serait un
  // « unbound method » et recréerait des fonctions à chaque rendu (React se
  // réabonnerait à chaque fois).
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );
  const getSnapshot = useCallback(() => store.getState(), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Dispatch brut : réservé à la couche `store` (les écrans utilisent
 * `useActions`). L'enveloppe est stable tant que le store ne change pas.
 */
export function useDispatch(): AppStore['dispatch'] {
  const store = useAppStore();
  return useCallback(
    (action: AppAction) => {
      store.dispatch(action);
    },
    [store],
  );
}

/**
 * Sélecteur appliqué à l'état courant.
 *
 * Les sélecteurs qui dépendent d'un paramètre (ex. `selectDueCount(state, now)`)
 * se composent avec `useCallback` côté composant :
 * `useSelect(useCallback((state) => selectDueCount(state, now), [now]))`.
 */
export function useSelect<T>(selector: (state: AppState) => T): T {
  const state = useAppState();
  return selector(state);
}
