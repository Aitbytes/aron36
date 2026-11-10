import { describe, expect, it, vi } from 'vitest';

import { registerServiceWorker } from './registerServiceWorker';
import type { SwUpdateSignalControl } from './updateSignal';

/**
 * Enregistrement du service worker.
 *
 * Contrats vérifiés (aucun navigateur réel) :
 * - l'URL enregistrée est **relative à `index.html`** et la portée est `./`, donc
 *   l'application fonctionne aussi dans un sous-répertoire ;
 * - un échec d'enregistrement est **silencieux** : l'application démarre quand
 *   même, elle perd seulement le hors-ligne ;
 * - un worker en attente, ou qui vient de s'installer alors qu'un contrôleur est
 *   déjà actif, est signalé à l'interface (bannière de mise à jour) ; une
 *   première installation, elle, ne signale rien.
 */

/** Double d'un `ServiceWorker` : seuls `state`, `postMessage` et les évènements servent. */
interface WorkerDouble {
  readonly worker: ServiceWorker;
  readonly setState: (state: ServiceWorkerState) => void;
}

function createWorker(): WorkerDouble {
  const listeners = new Map<string, (() => void)[]>();
  const stub = {
    state: 'installing' as ServiceWorkerState,
    addEventListener: (type: string, listener: () => void): void => {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
  };
  return {
    // `as unknown as` : `registerServiceWorker` n'utilise qu'une partie de
    // l'interface DOM ; reproduire les 30 membres de `ServiceWorker` n'apporterait
    // aucune preuve supplémentaire.
    worker: stub as unknown as ServiceWorker,
    setState: (next) => {
      stub.state = next;
      for (const listener of listeners.get('statechange') ?? []) {
        listener();
      }
    },
  };
}

/** Double d'un `ServiceWorkerRegistration` : `waiting`, `installing`, `updatefound`. */
interface RegistrationDouble {
  readonly registration: ServiceWorkerRegistration;
  /** Déclenche l'évènement de mise à jour (`updatefound`). */
  readonly fireUpdateFound: () => void;
}

function createRegistration(installing: WorkerDouble | null): RegistrationDouble {
  const listeners = new Map<string, (() => void)[]>();
  const stub = {
    waiting: null as ServiceWorker | null,
    installing: installing === null ? null : installing.worker,
    addEventListener: (type: string, listener: () => void): void => {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
  };
  return {
    registration: stub as unknown as ServiceWorkerRegistration,
    fireUpdateFound: () => {
      for (const listener of listeners.get('updatefound') ?? []) {
        listener();
      }
    },
  };
}

/** Conteneur minimal : `register` et `controller`. */
function createContainer(
  registration: ServiceWorkerRegistration | Promise<ServiceWorkerRegistration>,
  controller: ServiceWorker | null,
): { container: ServiceWorkerContainer; register: ReturnType<typeof vi.fn> } {
  const register = vi.fn(() => Promise.resolve(registration));
  return {
    container: { register, controller } as unknown as ServiceWorkerContainer,
    register,
  };
}

/** Signal espion : on observe ce que l'enregistrement annonce à l'interface. */
function createSignalSpy(): SwUpdateSignalControl & { readonly reported: () => number } {
  let waiting: ServiceWorker | null = null;
  let calls = 0;
  return {
    subscribe: () => () => undefined,
    isUpdateReady: () => waiting !== null,
    applyUpdate: () => undefined,
    setWaiting: (worker) => {
      waiting = worker;
      calls += 1;
    },
    reported: () => calls,
  };
}

/** Laisse se résoudre la chaîne de promesses de `registerServiceWorker`. */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('registerServiceWorker', () => {
  it('enregistre sw.js relativement à index.html, avec la portée du déploiement', async () => {
    const { container, register } = createContainer(createRegistration(null).registration, null);
    const signal = createSignalSpy();

    registerServiceWorker({ container, signal });
    await flushPromises();

    expect(register).toHaveBeenCalledTimes(1);
    const [url, options] = register.mock.calls[0] as [URL, RegistrationOptions];
    expect(String(url)).toBe(new URL('sw.js', document.baseURI).href);
    expect(options).toEqual({ scope: './' });
  });

  it('reste silencieux quand le navigateur n’a pas de service worker', () => {
    expect(() => {
      registerServiceWorker({ container: null });
    }).not.toThrow();
  });

  it('avale un échec d’enregistrement au lieu de casser l’application', async () => {
    const register = vi.fn(() => Promise.reject(new Error('portée invalide')));
    const container = { register } as unknown as ServiceWorkerContainer;

    expect(() => {
      registerServiceWorker({ container, signal: createSignalSpy() });
    }).not.toThrow();
    // La promesse rejetée est consommée : aucune « unhandled rejection ».
    await flushPromises();
  });

  it('signale un worker déjà en attente quand un contrôleur est actif', async () => {
    const waiting = createWorker();
    const { registration } = createRegistration(null);
    Object.assign(registration, { waiting: waiting.worker });
    const { container } = createContainer(registration, waiting.worker);
    const signal = createSignalSpy();

    registerServiceWorker({ container, signal });
    await flushPromises();

    expect(signal.isUpdateReady()).toBe(true);
    expect(signal.reported()).toBe(1);
  });

  it('signale un worker qui vient de s’installer (mise à jour, pas première visite)', async () => {
    const installing = createWorker();
    const { registration, fireUpdateFound } = createRegistration(installing);
    const { container } = createContainer(registration, createWorker().worker);
    const signal = createSignalSpy();

    registerServiceWorker({ container, signal });
    await flushPromises();

    fireUpdateFound();
    installing.setState('installing');
    expect(signal.reported()).toBe(0);

    installing.setState('installed');
    expect(signal.isUpdateReady()).toBe(true);
    expect(signal.reported()).toBe(1);
  });

  it('n’annonce rien lors de la première installation (aucun contrôleur)', async () => {
    const installing = createWorker();
    const { registration, fireUpdateFound } = createRegistration(installing);
    const { container } = createContainer(registration, null);
    const signal = createSignalSpy();

    registerServiceWorker({ container, signal });
    await flushPromises();

    fireUpdateFound();
    installing.setState('installed');

    expect(signal.isUpdateReady()).toBe(false);
    expect(signal.reported()).toBe(0);
  });
});
