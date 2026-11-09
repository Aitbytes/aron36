import { describe, expect, it, vi } from 'vitest';

import { createStore } from './createStore';
import { makeState, NOW } from './test-fixtures';
import type { AppState, AppStore } from './types';

describe('createStore — notifications', () => {
  it('notifie exactement une fois par dispatch, avec le nouvel état', () => {
    const store: AppStore = createStore(makeState());
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispatch({ type: 'ui/navigate', screen: 'train' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(store.getState());
    expect(store.getState().ui.screen).toBe('train');
  });

  it("ne notifie personne quand l'action ne change pas l'état (référence identique)", () => {
    const store = createStore(makeState());
    const listener = vi.fn();
    store.subscribe(listener);

    // L'écran courant est déjà `home` : le réducteur renvoie l'état tel quel.
    store.dispatch({ type: 'ui/navigate', screen: 'home' });

    expect(listener).not.toHaveBeenCalled();
    // L'état n'a pas changé : même référence retournée par getState.
    expect(store.getState().ui.screen).toBe('home');
  });

  it('getState reflète toujours le dernier état', () => {
    const store = createStore(makeState());
    expect(store.getState().ui.busy).toBe(false);

    store.dispatch({ type: 'ui/busy-changed', busy: true });
    expect(store.getState().ui.busy).toBe(true);

    store.dispatch({ type: 'ui/busy-changed', busy: false });
    expect(store.getState().ui.busy).toBe(false);
  });
});

describe('createStore — abonnements', () => {
  it('deux abonnés sont notifiés chacun une fois par dispatch', () => {
    const store = createStore(makeState());
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe(first);
    store.subscribe(second);

    store.dispatch({ type: 'ui/act-selected', actId: 1 });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('désabonnement : plus aucune notification après le retour de unsubscribe', () => {
    const store = createStore(makeState());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.dispatch({ type: 'ui/navigate', screen: 'collection' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.dispatch({ type: 'ui/navigate', screen: 'stats' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().ui.screen).toBe('stats');
  });

  it('unsubscribe est idempotent et un double appel ne casse rien', () => {
    const store = createStore(makeState());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();

    store.dispatch({ type: 'ui/navigate', screen: 'settings' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('un abonnement pris pendant une notification ne saute pas la notification courante', () => {
    const store = createStore(makeState());
    const latecomer = vi.fn();

    const unsubscribeFirst = store.subscribe(() => {
      // Abonnement pendant la notification déclenchée par le dispatch ci-dessous.
      store.subscribe(latecomer);
      unsubscribeFirst();
    });

    store.dispatch({ type: 'ui/navigate', screen: 'train' });

    // Vague de rattrapage : le nouvel abonné voit bien l'état final du dispatch.
    expect(latecomer).toHaveBeenCalledTimes(1);
    expect(latecomer).toHaveBeenCalledWith(store.getState());
    // ... et il est de nouveau notifié au dispatch suivant.
    store.dispatch({ type: 'ui/navigate', screen: 'stats' });
    expect(latecomer).toHaveBeenCalledTimes(2);
  });

  it('un désabonnement pendant une notification est sûr et borne les appels', () => {
    const store = createStore(makeState());
    const first = vi.fn();
    const second = vi.fn();
    let unsubscribeSecond: () => void = () => {};

    const unsubscribeFirst = store.subscribe(() => {
      first();
      unsubscribeSecond();
      unsubscribeFirst();
    });
    unsubscribeSecond = store.subscribe(second);

    // Le second abonné, déjà capturé dans la copie du tour, reçoit une dernière
    // notification ; les deux listeners ont désactivé leur abonnement, les
    // dispatchs suivants n'en notifient plus aucun.
    expect(() => store.dispatch({ type: 'ui/navigate', screen: 'train' })).not.toThrow();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    store.dispatch({ type: 'ui/navigate', screen: 'stats' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('un dispatch réentrant depuis un listener ne provoque pas de récursion infinie', () => {
    const store = createStore(makeState());
    const listener = vi.fn();

    store.subscribe(() => {
      listener();
      // Retrigger une action pendant la notification : l'état est mis à jour
      // mais aucune vague imbriquée n'est déclenchée.
      if (store.getState().ui.activeActId === null) {
        store.dispatch({ type: 'ui/act-selected', actId: 2 });
      }
    });

    expect(() => store.dispatch({ type: 'ui/navigate', screen: 'train' })).not.toThrow();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().ui.screen).toBe('train');
    expect(store.getState().ui.activeActId).toBe(2);
  });
});

describe('createStore — contrat', () => {
  it('expose la surface AppStore sans dépendance à React', () => {
    const store = createStore(makeState());
    expect(Object.keys(store).sort()).toEqual(['dispatch', 'getState', 'subscribe']);
    const listener = vi.fn();
    expect(typeof store.subscribe(listener)).toBe('function');
    expect(typeof store.getState()).toBe('object');
  });

  it("garde l'état initial intact si aucune action n'est dispatchée", () => {
    const initial: AppState = makeState({
      player: { ...makeState().progress.player, totalXp: 123 },
    });
    const store = createStore(initial);
    expect(store.getState()).toBe(initial);
    expect(store.getState().progress.savedAt).toBe(NOW);
  });
});
