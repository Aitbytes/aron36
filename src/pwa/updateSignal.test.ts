import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSwUpdateSignal, SKIP_WAITING } from './updateSignal';

/**
 * Signal de mise à jour (Phase 5).
 *
 * Ce que ces tests prouvent — et qui n'est pas visible dans l'interface :
 * - un nouveau build **n'entraîne aucun rechargement** : il faut `applyUpdate` ;
 * - l'activation (`skipWaiting`) n'est demandée qu'une fois, et le rechargement
 *   attend `controllerchange` (sinon la page rechargerait l'ancien build) ;
 * - sans service worker disponible, `applyUpdate` ne fait rien et ne lève pas.
 */

/** Faux `navigator.serviceWorker` : jsdom n'implémente pas cette API. */
interface FakeContainer {
  readonly trigger: (type: string) => void;
}

const containers: string[] = [];

function installContainer(): FakeContainer {
  const listeners = new Map<string, (() => void)[]>();
  const container = {
    addEventListener(type: string, listener: () => void) {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
  };
  // On présente au code de production le strict minimum qu'il utilise
  // (`addEventListener`), pas une implémentation DOM complète.
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  });
  containers.push('serviceWorker');
  return {
    trigger: (type) => {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
}

/** Faux worker : seul `postMessage` est utilisé par le signal. */
function installWorker(): { worker: ServiceWorker; messages: unknown[] } {
  const messages: unknown[] = [];
  const worker = {
    postMessage: (message: unknown) => {
      messages.push(message);
    },
  };
  return { worker: worker as unknown as ServiceWorker, messages };
}

afterEach(() => {
  for (const key of containers) {
    Reflect.deleteProperty(navigator, key);
  }
  containers.length = 0;
});

describe('signal de mise à jour du service worker', () => {
  it('n’annonce une mise à jour qu’une fois un worker en attente', () => {
    const { worker } = installWorker();
    const signal = createSwUpdateSignal(vi.fn());

    expect(signal.isUpdateReady()).toBe(false);

    signal.setWaiting(worker);
    expect(signal.isUpdateReady()).toBe(true);

    signal.setWaiting(null);
    expect(signal.isUpdateReady()).toBe(false);
  });

  it('notifie les abonnés à chaque changement, jamais deux fois pour le même worker', () => {
    const { worker } = installWorker();
    const signal = createSwUpdateSignal(vi.fn());
    const listener = vi.fn();

    const unsubscribe = signal.subscribe(listener);
    signal.setWaiting(worker);
    signal.setWaiting(worker);
    expect(listener).toHaveBeenCalledTimes(1);

    signal.setWaiting(null);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    signal.setWaiting(worker);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('demande skipWaiting puis recharge seulement au controllerchange', () => {
    const container = installContainer();
    const { worker, messages } = installWorker();
    const reload = vi.fn();
    const signal = createSwUpdateSignal(reload);

    signal.setWaiting(worker);
    signal.applyUpdate();

    expect(messages).toEqual([{ type: SKIP_WAITING }]);
    // Rien n'est rechargé tant que le nouveau worker ne contrôle pas la page.
    expect(reload).not.toHaveBeenCalled();

    container.trigger('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ne demande l’activation qu’une fois (double clic sur « Recharger »)', () => {
    installContainer();
    const { worker, messages } = installWorker();
    const signal = createSwUpdateSignal(vi.fn());

    signal.setWaiting(worker);
    signal.applyUpdate();
    signal.applyUpdate();

    expect(messages).toHaveLength(1);
  });

  it('réautorise l’activation si un nouveau worker arrive après un échec', () => {
    installContainer();
    const { worker, messages } = installWorker();
    const signal = createSwUpdateSignal(vi.fn());

    signal.setWaiting(worker);
    signal.applyUpdate();
    expect(messages).toHaveLength(1);

    // Un build plus récent remplace le worker en attente : l'utilisateur doit
    // pouvoir relancer l'opération.
    signal.setWaiting(null);
    signal.setWaiting(worker);
    signal.applyUpdate();
    expect(messages).toHaveLength(2);
  });

  it('ne fait rien et ne lève pas sans navigateur équipé de service workers', () => {
    const { worker, messages } = installWorker();
    const reload = vi.fn();
    const signal = createSwUpdateSignal(reload);

    signal.setWaiting(worker);
    expect(() => {
      signal.applyUpdate();
    }).not.toThrow();

    expect(messages).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });
});
