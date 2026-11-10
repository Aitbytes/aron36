/**
 * Signal « une nouvelle version est prête » (Phase 5).
 *
 * Le service worker généré par `scripts/build-sw.mjs` **n'appelle jamais**
 * `skipWaiting()` de lui-même : un nouveau build ne doit pas remplacer le code
 * au milieu d'une session de révision. Il reste donc en attente
 * (`registration.waiting`) et l'interface propose un rechargement explicite.
 *
 * Ce module ne touche ni React ni le DOM : il ne fait que porter l'état
 * « worker en attente » et diffuser les changements. Il est branché sur React par
 * `UpdateBanner` (`useSyncExternalStore`) et sur le navigateur par
 * `registerServiceWorker`.
 *
 * Les opérations sont déclarées en **propriétés fléchées** (et non en méthodes) :
 * l'interface les extrait de l'objet (`useSyncExternalStore(signal.subscribe, …)`),
 * un `this` implicite n'aurait donc aucun sens.
 */

/** Message accepté par le service worker pour prendre la main immédiatement. */
export const SKIP_WAITING = 'SKIP_WAITING';

/** Surface consommée par l'interface. */
export interface SwUpdateSignal {
  /** Abonnement aux changements d'état ; renvoie la fonction de désabonnement. */
  readonly subscribe: (listener: () => void) => () => void;
  /** `true` dès qu'un worker installé attend de prendre la main. */
  readonly isUpdateReady: () => boolean;
  /** Demande au worker en attente de s'activer, puis recharge la page. */
  readonly applyUpdate: () => void;
}

/** Surface de pilotage, réservée à l'enregistrement du worker et aux tests. */
export interface SwUpdateSignalControl extends SwUpdateSignal {
  /** Déclare (ou efface avec `null`) le worker en attente. */
  readonly setWaiting: (worker: ServiceWorker | null) => void;
}

/** Conteneur de service workers, ou `null` (jsdom, navigateur, contexte non sûr). */
function getContainer(): ServiceWorkerContainer | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : null;
}

/**
 * Crée un signal. `reload` est injecté pour que les tests observent le
 * rechargement sans recharger réellement la page.
 */
export function createSwUpdateSignal(reload: () => void): SwUpdateSignalControl {
  let waiting: ServiceWorker | null = null;
  let applied = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    isUpdateReady: () => waiting !== null,

    setWaiting: (worker) => {
      if (worker === waiting) {
        return;
      }
      waiting = worker;
      // Un nouveau worker en attente réautorise une demande d'activation : le
      // précédent a pu échouer ou être remplacé par un build plus récent.
      applied = false;
      notify();
    },

    applyUpdate: () => {
      const container = getContainer();
      if (waiting === null || applied || container === null) {
        return;
      }
      applied = true;
      // On attend `controllerchange` plutôt que de recharger tout de suite : à
      // cet instant seulement, le nouveau worker sert les fichiers du nouveau
      // build (sinon la page rechargerait l'ancien code).
      container.addEventListener('controllerchange', reload, { once: true });
      waiting.postMessage({ type: SKIP_WAITING });
    },
  };
}

/** Signal de production : le rechargement recharge réellement la page. */
export const swUpdate: SwUpdateSignalControl = createSwUpdateSignal(() => {
  window.location.reload();
});
