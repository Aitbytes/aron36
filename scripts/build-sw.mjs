#!/usr/bin/env node
/**
 * Génère `dist/sw.js` — le service worker qui rend l'application utilisable
 * hors ligne (voir `docs/ARCHITECTURE.md` § 13.5).
 *
 * Pourquoi générer le worker plutôt que le committer : la liste de précache doit
 * être **exhaustive et exacte** pour un build donné (noms d'assets hachés,
 * empreinte de version). L'écrire à la main garantit l'oubli ; la dériver du
 * contenu de `dist/` rend l'oubli impossible — et le contrôle de complétude
 * ci-dessous échoue bruyamment si `index.html` ou le manifeste pointent un
 * fichier absent.
 *
 * Aucune dépendance npm : Node seul (fs, crypto, path), ESM.
 *
 * Invariants :
 * - la **version de cache** dérive du contenu des fichiers (`aron36-<12 hex>`) :
 *   deux builds différents ne partagent jamais un cache, deux builds identiques
 *   le partagent ;
 * - `sw.js` lui-même et les *source maps* ne sont jamais précachés (`sw.js` se
 *   remplacerait à chaque écriture, les maps ne sont lues que par les DevTools) ;
 * - les URL de précache sont **relatives** (`./…`) : l'application fonctionne à
 *   la racine d'un domaine comme dans un sous-répertoire (même `base: './'` que
 *   `vite.config.ts`).
 *
 * Usage : `node scripts/build-sw.mjs` (branché sur `npm run build`, après Vite).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt (ce fichier vit dans `scripts/`). */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Dossier produit par `vite build`. */
export const DEFAULT_DIST_DIR = join(ROOT, 'dist');

/** Préfixe commun des caches : c'est lui qui permet de purger les anciens. */
export const CACHE_PREFIX = 'aron36-';

/** Jamais précachés : le worker lui-même et les source maps. */
const EXCLUDED = /(?:^|\/)sw\.js$|\.map$/;

/** Fichiers que `index.html` doit citer et qui doivent exister dans `dist/`. */
const REQUIRED_FILES = ['index.html', 'manifest.webmanifest'];

/** Sépare et normalise un chemin relatif pour les URL de cache. */
function toPosix(path) {
  return path.split(sep).join('/');
}

/**
 * Liste **tous** les fichiers de `dist/`, récursivement, en chemins POSIX
 * relatifs (ex. `assets/index-abc123.js`). Tri alphabétique : la liste produite
 * est stable d'un build à l'autre, donc la version de cache ne dépend que du
 * contenu.
 */
export function listDistFiles(distDir) {
  const found = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relativePath);
        continue;
      }
      if (entry.isFile()) {
        found.push(relativePath);
      }
    }
  };
  walk(distDir, '');
  return found.sort();
}

/** Chemin relatif `dist/` → URL de cache, relative à `sw.js` (donc au scope). */
export function toCacheUrl(relativePath) {
  return `./${toPosix(relativePath)}`;
}

/** URL citée par `index.html` ou le manifeste → chemin relatif `dist/`. */
function toDistPath(url) {
  return toPosix(url).replace(/^\.?\//u, '');
}

/**
 * Références locales de `index.html` (`src`/`href`), hors URL absolues,
 * `data:` et ancres.
 */
export function localReferences(html) {
  const references = [];
  const attribute = /\b(?:src|href)="([^"]+)"/gu;
  for (const match of html.matchAll(attribute)) {
    const url = match[1];
    if (/^(?:[a-z]+:|\/\/|#)/iu.test(url)) {
      continue;
    }
    references.push(toDistPath(url));
  }
  return references;
}

/**
 * Empreinte du build : empreinte SHA-256 de la liste `chemin → SHA-256(contenu)`,
 * tronquée à 12 caractères hexadécimaux. Elle change dès qu'un octet d'un asset
 * change, et seulement dans ce cas.
 */
export function computeCacheVersion(distDir, files) {
  const hash = createHash('sha256');
  for (const file of files) {
    const content = createHash('sha256')
      .update(readFileSync(join(distDir, file)))
      .digest('hex');
    hash.update(`${toPosix(file)}\0${content}\n`);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * Vérifie que le build est **cohérent** avant de figer une liste de précache :
 * fichiers obligatoires présents, chaque asset cité par `index.html` et chaque
 * icône déclarée par le manifeste réellement présent dans `dist/`.
 *
 * Sans ce contrôle, un `index.html` pointant un chunk absent produirait un
 * service worker « valide » et une application cassée hors ligne.
 */
export function assertBuildComplete(distDir, files) {
  const present = new Set(files);
  const problems = [];

  for (const required of REQUIRED_FILES) {
    if (!present.has(required)) {
      problems.push(`${required} est absent de dist/`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Build incohérent :\n- ${problems.join('\n- ')}`);
  }

  for (const reference of localReferences(readFileSync(join(distDir, 'index.html'), 'utf8'))) {
    if (!present.has(reference)) {
      problems.push(`index.html cite « ${reference} », absent de dist/`);
    }
  }

  const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.webmanifest'), 'utf8'));
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (icons.length < 3) {
    problems.push(`le manifeste ne déclare que ${icons.length} icône(s) (3 minimum)`);
  }
  for (const icon of icons) {
    const src = toDistPath(String(icon.src));
    if (!present.has(src)) {
      problems.push(`le manifeste déclare « ${icon.src} », absent de dist/`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Build incohérent :\n- ${problems.join('\n- ')}`);
  }
}

/**
 * Source du service worker.
 *
 * Versionné avec l'empreinte et la liste de précache ; le reste est statique.
 * Aucune interpolation `${}` dans le corps : les deux marqueurs `__…__` sont
 * remplacés explicitement, pour que le fichier produit soit relisible tel quel.
 */
const SERVICE_WORKER_TEMPLATE = `/**
 * Service worker d'Aron 36 — **fichier généré**, ne pas éditer à la main.
 * Source : scripts/build-sw.mjs (exécuté par 'npm run build').
 *
 * Stratégies (docs/ARCHITECTURE.md § 13.5) :
 * - installation : précache exhaustif de l'app shell du build courant ;
 * - navigation (HTML) : réseau d'abord, repli sur 'index.html' précaché ;
 * - assets précachés : cache d'abord, sans revalidation (noms hachés) ;
 * - toute autre requête : pas d'interception, donc aucun cache.
 */
'use strict';

var CACHE_PREFIX = '__CACHE_PREFIX__';
var CACHE_VERSION = '__CACHE_VERSION__';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
var OFFLINE_URL = './index.html';

/** Fichiers précachés à l'installation — généré depuis dist/ (exhaustif). */
var PRECACHE_URLS = __PRECACHE_URLS__;

var PRECACHE_SET = new Set(PRECACHE_URLS);

/** Répertoire du worker : la racine du scope (racine du site ou sous-dossier). */
var SCOPE_PATH = new URL('./', self.location.href).pathname;

/** Clé de cache d'une URL de même origine, ou null si elle sort du scope. */
function cacheKeyFor(url) {
  if (url.origin !== self.location.origin) {
    return null;
  }
  if (!url.pathname.startsWith(SCOPE_PATH)) {
    return null;
  }
  return './' + url.pathname.slice(SCOPE_PATH.length);
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll est atomique : un fichier manquant fait échouer l'installation
      // plutôt que d'installer un worker incomplet.
      return cache.addAll(PRECACHE_URLS);
    }),
  );
  // Pas de skipWaiting() ici : la mise à jour attend l'accord de l'utilisateur
  // (bannière « Nouvelle version disponible »), sinon un rechargement en pleine
  // session de révision changerait le code sous les pieds du joueur.
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (name) {
              return name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME;
            })
            .map(function (name) {
              return caches.delete(name);
            }),
        );
      })
      .then(function () {
        // Le worker prend la main sans attendre un rechargement : les onglets
        // déjà ouverts passent sous son contrôle.
        return self.clients.claim();
      }),
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/** Cache d'abord : réservé aux URL précachées (donc aux noms hachés). */
function fromCacheFirst(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }
      // Cas limite : une URL précachée mais absente du cache (purge manuelle du
      // navigateur). On retente le réseau une fois ; l'échec reste visible.
      return fetch(request).then(function (response) {
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      });
    });
  });
}

/**
 * Réseau d'abord pour les navigations : l'utilisateur obtient la dernière page
 * publiée quand il est en ligne, l'app shell précaché sinon.
 *
 * La réponse réseau n'est **pas** recopiée dans le cache : le précache est la
 * cohérence (HTML + assets d'un même build). Mélanger un HTML neuf avec des
 * assets d'un autre build casserait le hors-ligne.
 */
function navigationNetworkFirst(request) {
  return fetch(request).catch(function () {
    return caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.match(request).then(function (cached) {
          // La coque précachée est le repli garanti : c'est elle qui contient
          // les assets de ce build.
          return cached || cache.match(OFFLINE_URL);
        });
      })
      .then(function (response) {
        if (response) {
          return response;
        }
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Aron 36 — hors ligne</title>' +
            '<p>Cette page n’est pas encore disponible hors ligne. Reconnectez-vous une fois, ' +
            'puis rouvrez l\u2019application.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      });
    });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Aucune requête tierce n'est interceptée ni mise en cache.
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(request));
    return;
  }

  var key = cacheKeyFor(url);
  if (key !== null && PRECACHE_SET.has(key)) {
    event.respondWith(fromCacheFirst(request));
  }
  // Tout le reste : comportement réseau par défaut, jamais de cache.
});
`;

/** Source du worker, prête à écrire dans `dist/sw.js`. */
export function renderServiceWorker({ version, precache }) {
  // Guillemets simples : les URL de précache sont relatives et sans quote,
  // l'échappement JSON n'apporterait que du bruit dans le fichier produit.
  const list = precache.map((url) => `  '${url}',`).join('\n');
  return SERVICE_WORKER_TEMPLATE.replace('__CACHE_PREFIX__', CACHE_PREFIX)
    .replace('__CACHE_VERSION__', version)
    .replace('__PRECACHE_URLS__', `[\n${list}\n]`);
}

/**
 * Génère `dist/sw.js`. Retourne la version de cache et la liste précachée, que
 * les tests et la CI peuvent inspecter.
 */
export function buildServiceWorker(distDir = DEFAULT_DIST_DIR) {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(
      `dist/ introuvable ou incomplet (${distDir}) : lance \`npm run build\` avant de générer le service worker.`,
    );
  }

  const all = listDistFiles(distDir);
  assertBuildComplete(distDir, all);

  const precacheFiles = all.filter((file) => !EXCLUDED.test(file));
  const precache = precacheFiles.map(toCacheUrl);
  const version = computeCacheVersion(distDir, precacheFiles);
  const source = renderServiceWorker({ version, precache });

  writeFileSync(join(distDir, 'sw.js'), source, 'utf8');

  // Garde-fou : le fichier écrit doit citer chaque URL précachée.
  const written = readFileSync(join(distDir, 'sw.js'), 'utf8');
  const missing = precache.filter((url) => !written.includes(`'${url}'`));
  if (missing.length > 0) {
    throw new Error(`sw.js généré incomplet, URL absentes : ${missing.join(', ')}`);
  }

  return { version, precache, cacheName: `${CACHE_PREFIX}${version}`, bytes: source.length };
}

/** Exécution directe (`node scripts/build-sw.mjs`). */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { precache, cacheName, bytes } = buildServiceWorker();
  console.log(`dist/sw.js écrit — cache ${cacheName} (${bytes} octets)`);
  console.log(`Fichiers précachés (${precache.length}) :`);
  for (const url of precache) {
    console.log(`  ${url}`);
  }
}
