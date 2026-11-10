import { swUpdate } from './updateSignal';
import type { SwUpdateSignalControl } from './updateSignal';

/**
 * Enregistrement du service worker (Phase 5).
 *
 * Trois exigences, dans cet ordre :
 * 1. **après le premier rendu** : l'enregistrement ne doit rien retarder ;
 * 2. **silencieux** : sans support (jsdom, navigateur ancien, `http://` non
 *    local), l'application fonctionne à l'identique en ligne — aucune erreur
 *    visible, aucune exception non gérée ;
 * 3. **sans rechargement forcé** : un nouveau worker reste en attente et l'UI
 *    affiche la bannière « Nouvelle version disponible » (`UpdateBanner`).
 *
 * L'URL est construite depuis `document.baseURI` : le worker vit à côté de
 * `index.html`, donc dans le sous-répertoire éventuel du déploiement
 * (`base: './'` dans `vite.config.ts`).
 */

/** Options injectables (tests) : conteneur et signal de mise à jour. */
export interface RegisterServiceWorkerOptions {
  readonly container?: ServiceWorkerContainer | null | undefined;
  readonly signal?: SwUpdateSignalControl | undefined;
}

/** Conteneur de service workers disponible, sinon `null`. */
function resolveContainer(
  provided: ServiceWorkerContainer | null | undefined,
): ServiceWorkerContainer | null {
  if (provided !== undefined) {
    return provided;
  }
  return 'serviceWorker' in navigator ? navigator.serviceWorker : null;
}

/**
 * Enregistre `sw.js` et branche l'état « mise à jour disponible ».
 *
 * Ne lève jamais : toute erreur (enregistrement refusé, portée invalide, worker
 * absent du build) est avalée. Une application installable sans réseau est un
 * bonus ; une application qui refuse de démarrer à cause de son worker ne l'est
 * pas.
 */
export function registerServiceWorker(options: RegisterServiceWorkerOptions = {}): void {
  const container = resolveContainer(options.container);
  const signal = options.signal ?? swUpdate;
  if (container === null) {
    return;
  }

  const watch = (registration: ServiceWorkerRegistration): void => {
    // Un worker déjà en attente au moment de l'enregistrement (page rechargée
    // alors qu'un nouveau build attendait) doit aussi être signalé.
    if (registration.waiting !== null && container.controller !== null) {
      signal.setWaiting(registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (installing === null) {
        return;
      }
      installing.addEventListener('statechange', () => {
        // `installed` + un contrôleur déjà actif = mise à jour, pas une première
        // installation (dans ce cas il n'y a rien à recharger).
        if (installing.state === 'installed' && container.controller !== null) {
          signal.setWaiting(registration.waiting ?? installing);
        }
      });
    });
  };

  try {
    void container
      .register(new URL('sw.js', document.baseURI), { scope: './' })
      .then(watch)
      .catch(() => {
        // Échec silencieux : voir le contrat ci-dessus.
      });
  } catch {
    // `register` peut lever synchronement (URL invalide, contexte détruit).
  }
}

/**
 * Planifie l'enregistrement **après** le premier rendu : au `load` de la page,
 * puis pendant un temps mort (`requestIdleCallback`, avec repli sur un minuteur
 * macrotâche). Aucun travail n'est fait sur le chemin critique du rendu.
 */
export function scheduleServiceWorkerRegistration(
  options: RegisterServiceWorkerOptions = {},
): void {
  const run = (): void => {
    registerServiceWorker(options);
  };

  const whenIdle = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 2000 });
      return;
    }
    window.setTimeout(run, 0);
  };

  if (document.readyState === 'complete') {
    whenIdle();
  } else {
    window.addEventListener('load', whenIdle, { once: true });
  }
}
