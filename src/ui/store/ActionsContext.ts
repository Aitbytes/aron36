import { createContext, useContext } from 'react';

import type { AppActions } from './appActions';

/** Contexte de la surface d'action ; construit par `ActionsProvider`. */
export const ActionsContext = createContext<AppActions | null>(null);

/**
 * Surface d'action des écrans — **le seul** moyen d'agir.
 *
 * Un écran n'importe jamais `UseCases`, le dépôt ni `@/infrastructure/*` : il
 * appelle `actions.startSession(...)`, lit l'issue renvoyée, et c'est tout.
 */
export function useActions(): AppActions {
  const actions = useContext(ActionsContext);
  if (actions === null) {
    throw new Error('useActions doit être utilisé sous <ActionsProvider>.');
  }
  return actions;
}
