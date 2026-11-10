/**
 * Simulation du service worker généré — **sans navigateur**.
 *
 * `sw.test.mjs` prouve que la liste de précache est exhaustive et que le fichier
 * produit est du JavaScript valide. Ce fichier-ci va plus loin : il **exécute**
 * le `sw.js` réellement produit (celui de `dist/`) dans un contexte isolé, avec
 * une implémentation minimale de `CacheStorage`, `fetch`, `clients` et des
 * évènements de cycle de vie. On observe alors le comportement, pas le texte :
 *
 * - `install` précache **tous** les fichiers du build ;
 * - hors ligne, une navigation obtient l'app shell précaché ;
 * - hors ligne, un asset haché est servi **depuis le cache, sans réseau** ;
 * - en ligne, la navigation vient du réseau et **n'écrase pas** le précache (le
 *   précache est la cohérence HTML + assets d'un même build) ;
 * - tout ce qui n'est pas précaché (chemin inconnu, autre origine, POST) n'est
 *   pas intercepté ;
 * - `activate` purge les anciens caches, épargne les caches étrangers et prend le
 *   contrôle des onglets ;
 * - `SKIP_WAITING` déclenche `skipWaiting` : le worker n'active pas d'office.
 *
 * Limite assumée : ce n'est pas un navigateur. Rien n'est prouvé ici sur les
 * quotas, l'éviction, ni sur l'activation réelle du worker ; la vérification en
 * conditions réelles reste la procédure de `docs/DEPLOY.md` § 3.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { DEFAULT_DIST_DIR, buildServiceWorker } from './build-sw.mjs';

const BASE = 'http://localhost/';
const SW_URL = `${BASE}sw.js`;
const hasDist = existsSync(join(DEFAULT_DIST_DIR, 'index.html'));

/** Chemin sur disque d'une URL (`./assets/x.js` → `dist/assets/x.js`). */
function fileFor(url) {
  return join(DEFAULT_DIST_DIR, decodeURIComponent(url.replace(/^\.?\//u, '')));
}

/** Clé de cache d'une requête : URL relative au scope, ou `'./index.html'`. */
function cacheKey(request) {
  const url = typeof request === 'string' ? request : request.url;
  return url.startsWith(BASE) ? `./${url.slice(BASE.length)}` : url;
}

/** `Cache` minimale : `addAll` (atomique, échoue si un fichier manque), `match`, `put`. */
function createCache(report) {
  const entries = new Map();
  return {
    entries,
    async addAll(urls) {
      for (const url of urls) {
        const path = fileFor(url);
        if (!existsSync(path)) {
          throw new TypeError(`addAll : fichier absent (${url})`);
        }
        entries.set(url, readFileSync(path, 'utf8'));
      }
    },
    async match(request) {
      report.matches.push(cacheKey(request));
      const body = entries.get(cacheKey(request));
      return body === undefined ? undefined : new Response(body, { status: 200 });
    },
    async put(request, response) {
      entries.set(cacheKey(request), await response.text());
    },
  };
}

/**
 * Charge `dist/sw.js` dans un contexte isolé et renvoie de quoi déclencher ses
 * évènements. `online` pilote `fetch` : à `false`, toute requête échoue comme
 * dans un onglet hors ligne.
 */
function createWorker(online) {
  const report = { fetches: [], matches: [], deleted: [], claimed: 0, skipWaiting: 0 };
  const cacheStorage = new Map();
  const listeners = new Map();

  const caches = {
    async open(name) {
      if (!cacheStorage.has(name)) {
        cacheStorage.set(name, createCache(report));
      }
      return cacheStorage.get(name);
    },
    async keys() {
      return [...cacheStorage.keys()];
    },
    async delete(name) {
      report.deleted.push(name);
      return cacheStorage.delete(name);
    },
  };

  const self = {
    location: new URL(SW_URL),
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    skipWaiting() {
      report.skipWaiting += 1;
    },
    clients: {
      async claim() {
        report.claimed += 1;
      },
    },
  };

  const fetch = async (request) => {
    const url = typeof request === 'string' ? request : request.url;
    report.fetches.push(url);
    if (!online) {
      throw new TypeError('Failed to fetch (hors ligne)');
    }
    const path = fileFor(`./${url.slice(BASE.length)}`);
    if (!existsSync(path)) {
      return new Response('not found', { status: 404 });
    }
    return new Response(readFileSync(path, 'utf8'), { status: 200 });
  };

  runInNewContext(readFileSync(join(DEFAULT_DIST_DIR, 'sw.js'), 'utf8'), {
    self,
    caches,
    fetch,
    Response,
    URL,
    Set,
    console,
  });

  const emit = async (type, event) => {
    const registered = listeners.get(type) ?? [];
    expect(registered.length).toBeGreaterThan(0);
    for (const listener of registered) {
      listener(event);
    }
    await event.done;
    return event;
  };

  return { report, cacheStorage, emit };
}

/** Évènement `install`/`activate` : `waitUntil` porte la promesse du cycle de vie. */
function lifecycleEvent() {
  const event = { done: Promise.resolve() };
  event.waitUntil = (promise) => {
    event.done = promise;
  };
  return event;
}

/** Évènement `fetch` : `respondWith` capture la réponse effectivement servie. */
function fetchEvent(request) {
  const event = { request, intercepted: false, response: undefined };
  event.respondWith = (promise) => {
    event.intercepted = true;
    event.response = promise;
  };
  return event;
}

/** Worker installé puis activé, prêt à servir. */
async function installedWorker(online) {
  const worker = createWorker(online);
  await worker.emit('install', lifecycleEvent());
  await worker.emit('activate', lifecycleEvent());
  return worker;
}

describe.skipIf(!hasDist)('service worker exécuté — hors ligne', () => {
  it('précache exactement les fichiers du build, sous une version de cache datée du build', async () => {
    const { precache, cacheName } = buildServiceWorker(DEFAULT_DIST_DIR);
    const worker = createWorker(true);

    await worker.emit('install', lifecycleEvent());

    expect([...worker.cacheStorage.keys()]).toEqual([cacheName]);
    const cache = worker.cacheStorage.get(cacheName);
    expect([...cache.entries.keys()].sort()).toEqual([...precache].sort());
  });

  it('hors ligne : navigation sur l’app shell, assets servis sans réseau', async () => {
    const worker = await installedWorker(false);
    const { precache } = buildServiceWorker(DEFAULT_DIST_DIR);
    const script = precache.find((url) => url.endsWith('.js'));
    expect(script).toBeDefined();

    // 1. Navigation : le réseau échoue, le repli est `index.html`.
    const navigation = fetchEvent({ url: `${BASE}entrainement`, method: 'GET', mode: 'navigate' });
    await worker.emit('fetch', navigation);
    expect(navigation.intercepted).toBe(true);
    const html = await (await navigation.response).text();
    expect(html).toContain('Aron 36');
    expect(html).toContain('<div id="root">');
    expect(worker.report.fetches).toEqual([`${BASE}entrainement`]);

    // 2. Asset haché : servi par le cache, **aucune** requête réseau.
    const before = worker.report.fetches.length;
    const asset = fetchEvent({ url: new URL(script, BASE).href, method: 'GET', mode: 'cors' });
    await worker.emit('fetch', asset);
    const body = await (await asset.response).text();
    expect(body.length).toBeGreaterThan(1000);
    expect(worker.report.fetches).toHaveLength(before);

    // 3. Icônes, manifeste et feuille de style : même traitement.
    for (const url of precache.filter((entry) => !entry.endsWith('.js'))) {
      const request = fetchEvent({ url: new URL(url, BASE).href, method: 'GET', mode: 'cors' });
      await worker.emit('fetch', request);
      expect(request.intercepted).toBe(true);
      const response = await request.response;
      expect(response.status).toBe(200);
    }
    expect(worker.report.fetches).toHaveLength(before);
  });

  it('en ligne : la navigation vient du réseau et n’écrase pas le précache', async () => {
    const worker = await installedWorker(true);
    const request = fetchEvent({ url: `${BASE}frais`, method: 'GET', mode: 'navigate' });

    await worker.emit('fetch', request);

    expect(worker.report.fetches).toEqual([`${BASE}frais`]);
    await (await request.response).text();
    const cache = worker.cacheStorage.get([...worker.cacheStorage.keys()][0]);
    expect(cache.entries.get('./index.html')).toBe(
      readFileSync(join(DEFAULT_DIST_DIR, 'index.html'), 'utf8'),
    );
  });

  it('n’intercepte ni chemin inconnu, ni autre origine, ni POST', async () => {
    const worker = await installedWorker(true);

    const unknown = fetchEvent({ url: `${BASE}api/progress`, method: 'GET', mode: 'cors' });
    await worker.emit('fetch', unknown);
    expect(unknown.intercepted).toBe(false);

    const foreign = fetchEvent({
      url: 'https://exemple.test/collecte',
      method: 'GET',
      mode: 'cors',
    });
    await worker.emit('fetch', foreign);
    expect(foreign.intercepted).toBe(false);

    const post = fetchEvent({ url: `${BASE}assets/index.js`, method: 'POST', mode: 'cors' });
    await worker.emit('fetch', post);
    expect(post.intercepted).toBe(false);

    // Ces trois cas n'ont touché ni au réseau ni au cache.
    expect(worker.report.fetches).toEqual([]);
    expect(worker.report.matches).toEqual([]);
  });

  it('purge les caches des versions précédentes, épargne les autres et prend la main', async () => {
    const worker = createWorker(true);
    await worker.emit('install', lifecycleEvent());
    const [current] = [...worker.cacheStorage.keys()];

    // Caches d'un build précédent, et d'une autre application sur le même domaine.
    worker.cacheStorage.set('aron36-000000000000', createCache(worker.report));
    worker.cacheStorage.set('autre-app-1', createCache(worker.report));

    await worker.emit('activate', lifecycleEvent());

    expect(worker.report.deleted).toEqual(['aron36-000000000000']);
    expect([...worker.cacheStorage.keys()].sort()).toEqual([current, 'autre-app-1'].sort());
    expect(worker.report.claimed).toBe(1);
  });

  it('n’active pas d’office : seul un message SKIP_WAITING le fait', async () => {
    const worker = await installedWorker(true);
    expect(worker.report.skipWaiting).toBe(0);

    await worker.emit('message', { data: { type: 'SKIP_WAITING' }, done: Promise.resolve() });
    expect(worker.report.skipWaiting).toBe(1);

    await worker.emit('message', { data: { type: 'AUTRE' }, done: Promise.resolve() });
    expect(worker.report.skipWaiting).toBe(1);
  });
});
