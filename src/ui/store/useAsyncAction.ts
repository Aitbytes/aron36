import { useCallback, useState } from 'react';

import { useDispatch } from './StoreContext';

/**
 * Résultat de `useAsyncAction` : état d'attente et lanceur.
 *
 * `run` est déclaré comme **propriété** (et non méthode) : le destructurer ne
 * détache aucun `this`.
 */
export interface AsyncAction<Args extends readonly unknown[], T> {
  readonly pending: boolean;
  readonly run: (...args: Args) => Promise<T>;
}

/**
 * Utilitaire d'action d'I/O (import de fichier, export, réinitialisation).
 *
 * - `pending` reflète l'opération en cours côté composant ;
 * - l'état global `ui.busy` est maintenu (`ui/busy-changed`) tant que
 *   l'opération tourne, ce qui permet au shell de désactiver les actions
 *   concurrentes ;
 * - l'erreur est **propagée** après remise à zéro de `pending` : l'appelant
 *   décide de l'afficher.
 *
 * `operation` doit être stable (l'envelopper dans `useCallback`) pour que `run`
 * le reste entre deux rendus.
 */
export function useAsyncAction<Args extends readonly unknown[], T>(
  operation: (...args: Args) => T | Promise<T>,
): AsyncAction<Args, T> {
  const dispatch = useDispatch();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (...args: Args): Promise<T> => {
      dispatch({ type: 'ui/busy-changed', busy: true });
      setPending(true);
      try {
        return await operation(...args);
      } finally {
        setPending(false);
        dispatch({ type: 'ui/busy-changed', busy: false });
      }
    },
    [dispatch, operation],
  );

  return { pending, run };
}
