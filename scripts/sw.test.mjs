/**
 * Tests du générateur de service worker (`scripts/build-sw.mjs`).
 *
 * Ce qui est prouvé, et pourquoi :
 * 1. **exhaustivité** du précache — chaque fichier du build est listé, une seule
 *    fois, et se retrouve dans `sw.js` ; un fichier ajouté au build sans être
 *    précaché rendrait l'application partiellement cassée hors ligne ;
 * 2. **version de cache** dérivée du contenu — stable à build identique, différente
 *    dès qu'un octet change (sinon les mises à jour ne se voient jamais) ;
 * 3. **échec bruyant** quand le build est incohérent (`index.html` ou manifeste
 *    pointant un fichier absent) : on préfère pas de worker à un worker menteur ;
 * 4. **validité syntaxique** du `sw.js` produit (`node --check`) ;
 * 5. sur le `dist/` réel (si présent) : les assets, `index.html` et les icônes y
 *    figurent tous — c'est le test d'exhaustivité sur le vrai build.
 *
 * Aucun navigateur : on teste le fichier produit, pas l'exécution du worker.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  assertBuildComplete,
  buildServiceWorker,
  CACHE_PREFIX,
  computeCacheVersion,
  DEFAULT_DIST_DIR,
  listDistFiles,
  localReferences,
  renderServiceWorker,
  toCacheUrl,
} from './build-sw.mjs';

const tempRoots = [];

/** `index.html` minimal mais réaliste : il cite le JS, le CSS et le manifeste. */
const INDEX_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="icon" href="./icons/aron36.svg" type="image/svg+xml" />
    <script type="module" crossorigin src="./assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-def456.css" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

/** Manifeste minimal respectant le minimum de trois icônes. */
const MANIFEST = JSON.stringify({
  name: 'Aron 36',
  start_url: './',
  icons: [
    { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: './icons/maskable-512.png', sizes: '512x512', purpose: 'maskable' },
  ],
});

/** Build factice : la forme exacte d'un `dist/` produit par Vite. */
function makeDist(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aron36-sw-'));
  tempRoots.push(root);
  const files = {
    'index.html': INDEX_HTML,
    'manifest.webmanifest': MANIFEST,
    'assets/index-abc123.js': 'console.log("app");\n',
    'assets/index-abc123.js.map': '{"version":3}\n',
    'assets/index-def456.css': 'body{margin:0}\n',
    'icons/aron36.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
    'icons/icon-192.png': 'png-192',
    'icons/icon-512.png': 'png-512',
    'icons/maskable-512.png': 'png-maskable',
    ...overrides,
  };
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

afterAll(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('service worker — précache', () => {
  it('précache chaque fichier du build, sauf sw.js et les source maps', () => {
    const dist = makeDist({ 'sw.js': '// ancien worker\n' });
    // Un fichier rarissime mais possible (asset imbriqué, police, image).
    mkdirSync(join(dist, 'assets/fonts'), { recursive: true });
    writeFileSync(join(dist, 'assets/fonts/display.woff2'), 'woff2');

    const { precache } = buildServiceWorker(dist);

    const expected = [
      './assets/fonts/display.woff2',
      './assets/index-abc123.js',
      './assets/index-def456.css',
      './icons/aron36.svg',
      './icons/icon-192.png',
      './icons/icon-512.png',
      './icons/maskable-512.png',
      './index.html',
      './manifest.webmanifest',
    ];
    expect(precache).toEqual(expected);
    // Le worker n'est jamais dans son propre précache, ni les source maps.
    expect(precache).not.toContain('./sw.js');
    expect(precache.some((url) => url.endsWith('.map'))).toBe(false);
  });

  it('écrit un sw.js qui cite chaque URL précachée, et qui est du JavaScript valide', () => {
    const dist = makeDist();
    const { precache } = buildServiceWorker(dist);

    const source = readFileSync(join(dist, 'sw.js'), 'utf8');
    for (const url of precache) {
      expect(source).toContain(`'${url}'`);
    }
    expect(source).toContain("var CACHE_PREFIX = 'aron36-'");
    expect(source).toContain("if (event.data && event.data.type === 'SKIP_WAITING')");
    expect(source).toContain('self.clients.claim()');

    const check = spawnSync(process.execPath, ['--check', join(dist, 'sw.js')], {
      encoding: 'utf8',
    });
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
  });

  it('décrit les trois stratégies : précache, cache d’abord, réseau d’abord', () => {
    const source = renderServiceWorker({ version: 'deadbeefcafe', precache: ['./index.html'] });

    expect(source).toContain('var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION');
    // Navigation : réseau d'abord puis repli sur la coque précachée.
    expect(source).toContain('function navigationNetworkFirst(request)');
    expect(source).toContain('return cached || cache.match(OFFLINE_URL)');
    // Assets : cache d'abord.
    expect(source).toContain('function fromCacheFirst(request)');
    // Tout le reste : traversé vers le réseau, jamais intercepté ni mis en cache.
    expect(source).toContain('var PRECACHE_SET = new Set(PRECACHE_URLS)');
    expect(source).toContain('if (key !== null && PRECACHE_SET.has(key))');
  });
});

describe('service worker — version de cache', () => {
  it('reste identique pour deux builds identiques et change dès qu’un octet change', () => {
    const first = makeDist();
    const second = makeDist();
    const files = listDistFiles(first);

    const version = computeCacheVersion(first, files);
    expect(version).toBe(computeCacheVersion(second, files));
    expect(version).toMatch(/^[0-9a-f]{12}$/u);

    writeFileSync(join(second, 'assets/index-def456.css'), 'body{margin:1px}\n');
    expect(computeCacheVersion(second, files)).not.toBe(version);
  });

  it('nomme le cache avec le préfixe Aron 36 et la version du build', () => {
    const dist = makeDist();
    const { version, cacheName } = buildServiceWorker(dist);

    expect(cacheName).toBe(`${CACHE_PREFIX}${version}`);
  });
});

describe('service worker — build incohérent', () => {
  it('échoue si dist/ est absent', () => {
    expect(() => buildServiceWorker(join(tmpdir(), 'aron36-dist-inexistant'))).toThrow(
      /lance `npm run build`/u,
    );
  });

  it('échoue si index.html cite un asset absent du build', () => {
    const dist = makeDist();
    rmSync(join(dist, 'assets/index-def456.css'));

    expect(() => assertBuildComplete(dist, listDistFiles(dist))).toThrow(
      /index\.html cite « assets\/index-def456\.css »/u,
    );
  });

  it('échoue si une icône déclarée par le manifeste est absente', () => {
    const dist = makeDist();
    rmSync(join(dist, 'icons/maskable-512.png'));

    expect(() => assertBuildComplete(dist, listDistFiles(dist))).toThrow(/maskable-512\.png/u);
  });

  it('échoue si le manifeste déclare moins de trois icônes', () => {
    const dist = makeDist({
      'manifest.webmanifest': JSON.stringify({ name: 'Aron 36', icons: [] }),
    });

    expect(() => assertBuildComplete(dist, listDistFiles(dist))).toThrow(/3 minimum/u);
  });
});

describe('service worker — helpers', () => {
  it('ne retient que les références locales de index.html', () => {
    expect(
      localReferences(
        '<a href="#top"></a><img src="https://x.test/a.png"><img src="data:image/png;base64,AA">' +
          '<script src="./assets/app.js"></script><link href="/icons/i.svg" />',
      ),
    ).toEqual(['assets/app.js', 'icons/i.svg']);
  });

  it('préfixe les URL de cache par « ./ » (base relative)', () => {
    expect(toCacheUrl('assets/index-abc.js')).toBe('./assets/index-abc.js');
    expect(toCacheUrl('index.html')).toBe('./index.html');
  });
});

describe('service worker — dist réel', () => {
  const hasDist = existsSync(join(DEFAULT_DIST_DIR, 'index.html'));
  const assetsDir = join(DEFAULT_DIST_DIR, 'assets');

  it.skipIf(!hasDist)(
    'précache tous les assets, index.html et toutes les icônes du vrai build',
    () => {
      const { precache } = buildServiceWorker(DEFAULT_DIST_DIR);
      const listed = new Set(precache);

      expect(listed.has('./index.html')).toBe(true);
      expect(listed.has('./manifest.webmanifest')).toBe(true);

      const assets = listDistFiles(assetsDir).map((file) => `./assets/${file}`);
      expect(assets.length).toBeGreaterThan(0);
      for (const asset of assets.filter((file) => !file.endsWith('.map'))) {
        expect(listed.has(asset)).toBe(true);
      }

      const icons = listDistFiles(join(DEFAULT_DIST_DIR, 'icons')).map((file) => `./icons/${file}`);
      expect(icons.length).toBeGreaterThanOrEqual(3);
      for (const icon of icons) {
        expect(listed.has(icon)).toBe(true);
      }

      // Corollaire : le precache ne contient que des fichiers réellement présents.
      for (const url of precache) {
        expect(existsSync(resolve(DEFAULT_DIST_DIR, url))).toBe(true);
      }
    },
  );
});
