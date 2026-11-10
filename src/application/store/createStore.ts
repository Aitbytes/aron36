import { reduce } from './reducer';
import type { AppAction, AppStore, AppState, Unsubscribe } from './types';

/** Listener de store : appelé avec l'état post-dispatch. */
type StoreListener = (state: AppState) => void;

/**
 * Store minimal sans React (c'est la Phase 4 qui branchera
 * `useSyncExternalStore` via `subscribe`/`getState`).
 *
 * Sémantique de notification, alignée sur les exigences de robustesse du lot :
 * - **une seule vague par dispatch** : chaque abonné présent au début du
 *   dispatch reçoit exactement une notification, avec l'état final ;
 * - **état identique par référence ⇒ pas de notification** (le réducteur
 *   renvoie l'état tel quel pour les actions sans effet, ex. `ui/navigate`
 *   vers l'écran courant) ;
 * - **itération sur une copie** du set d'abonnés : un `unsubscribe` pendant la
 *   notification ne casse pas le tour en cours (le listener déjà capturé dans
 *   la copie est notifié une dernière fois, puis plus jamais) ;
 * - **abonnement pendant la notification** : le nouvel abonné ne saute pas la
 *   notification courante — il reçoit une unique vague de rattrapage, avec
 *   l'état final du dispatch. Les abonnements pris pendant *ce* rattrapage
 *   attendent le dispatch suivant : c'est la borne choisie contre les chaînes
 *   d'abonnements récursives ;
 * - **dispatch réentrant depuis un listener** : accepté (l'état est mis à
 *   jour), mais il ne déclenche pas de vague imbriquée — c'est l'autre borne
 *   anti-récursion. Un listener ne doit donc pas supposer voir *tous* les
 *   changements d'état (même contrat que Redux).
 */
export function createStore(initial: AppState): AppStore {
  let currentState: AppState = initial;
  let isNotifying = false;
  const listeners = new Set<StoreListener>();

  const getState = (): AppState => currentState;

  const notify = (): void => {
    // Copie du set : l'itération est isolée des (dés)abonnements concurrents.
    const notified = [...listeners];
    const seen = new Set<StoreListener>(notified);
    for (const listener of notified) {
      listener(currentState);
    }
    // Vague de rattrapage unique (copie figée elle aussi) pour les abonnés
    // pris pendant la notification : ni chaîne infinie, ni notification sautée.
    const latecomers = [...listeners].filter((listener) => !seen.has(listener));
    for (const listener of latecomers) {
      listener(currentState);
    }
  };

  const dispatch = (action: AppAction): void => {
    const next = reduce(currentState, action);
    if (next === currentState) {
      // Aucun changement par référence : rien à annoncer.
      return;
    }
    currentState = next;
    if (isNotifying) {
      // Dispatch réentrant depuis un listener : l'état est déjà à jour et la
      // vague en cours le lira ; pas de vague imbriquée (anti-récursion).
      return;
    }
    isNotifying = true;
    try {
      notify();
    } finally {
      isNotifying = false;
    }
  };

  const subscribe = (listener: StoreListener): Unsubscribe => {
    listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        // Désabonnement idempotent : appeler deux fois la fonction est sans effet.
        return;
      }
      subscribed = false;
      listeners.delete(listener);
    };
  };

  return { getState, dispatch, subscribe };
}
