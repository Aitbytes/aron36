# Déploiement — Aron 36

> Application **statique**, **sans backend**, **sans compte** et **sans réseau à
> l'exécution** : une fois les assets chargés, l'application n'émet aucune requête
> (pas d'API, pas de police distante, pas de télémétrie). La progression vit dans
> le `localStorage` du navigateur ; le seul flux sortant est le chargement des
> fichiers listés dans le service worker.
>
> Référence technique : [`ARCHITECTURE.md`](./ARCHITECTURE.md) § 13.

## 1. Prérequis

| Outil       | Version                    | Usage                                  |
| ----------- | -------------------------- | -------------------------------------- |
| Node        | ≥ 22.12 (CI et image : 24) | build local                            |
| npm         | ≥ 10                       | installation                           |
| Docker      | 20.10+                     | image de production                    |
| ImageMagick | facultatif                 | régénérer les icônes (`npm run icons`) |

## 2. Build local

```bash
npm ci
npm run build          # tsc --noEmit + vite build + dist/sw.js
npm run preview        # sert dist/ sur http://localhost:4173
```

`npm run build` produit :

```
dist/
├── index.html
├── sw.js                 # service worker généré (version de cache = empreinte du build)
├── manifest.webmanifest
├── icons/                # 192, 512, maskable 512, apple-touch-icon
└── assets/               # JS + CSS hachés (+ source maps, non précachées)
```

Le bundle doit rester sous **200 kB gzip** (mesure à chaque build dans la sortie de
`vite build`). Au-delà, c'est un signal : investiguer avant d'ajouter une
dépendance.

> `npm run preview` sert `dist/` en HTTP ; le service worker y est actif, donc
> idéal pour tester le hors-ligne. `npm run dev` ne l'enregistre jamais
> (`sw.js` n'existe pas dans ce mode).

## 3. Vérifier le hors-ligne (2 minutes)

1. `npm run build && npm run preview`, ouvrir <http://localhost:4173> ;
2. laisser la page se charger une fois (le worker précache l'app shell ; onglet
   _Application → Service Workers_ : état `activated`) ;
3. DevTools → _Network_ → cocher **Offline** ;
4. recharger : l'application se charge normalement, la progression est intacte ;
5. revenir en ligne, relancer un build (`npm run build`), recharger une fois : la
   bannière « Nouvelle version disponible — Recharger » apparaît (un nouveau worker
   attend). Cliquer recharge sur la nouvelle version.

En ligne de commande, on peut au moins vérifier ce que le worker promet de servir :

```bash
node scripts/build-sw.mjs     # affiche la version de cache et la liste précachée
```

## 4. Image Docker

```bash
docker build -t aron36 .
docker run --rm -p 8080:80 aron36
curl -I http://localhost:8080/          # 200, Cache-Control: no-cache
curl -I http://localhost:8080/sw.js     # 200, no-store
curl -I http://localhost:8080/assets/$(ls dist/assets | grep '\.js$' | head -1)
```

Attendu : `/assets/*` en `public, max-age=31536000, immutable`, `/index.html` et
`/sw.js` en `no-cache`, `Content-Encoding: gzip` sur le JS et le CSS,
`X-Content-Type-Options: nosniff`, `Referrer-Policy` et `X-Frame-Options` présents.

L'image finale ne contient que nginx et `dist/` : **aucun runtime Node**, aucun
`node_modules`.

## 5. Dokploy

Deux cibles possibles ; la première est la plus simple, la seconde la plus
prévisible.

### 5.1 Application statique (recommandé)

- Type : **Static** / Nginx ;
- dépôt : ce dépôt, branche `main` (release) — `develop` reste l'intégration ;
- commande de build : `npm ci && npm run build` ;
- répertoire publié : `dist` ;
- domaine : celui fourni par Dokploy (HTTPS terminé par le reverse proxy) ;
- aucune variable d'environnement.

> Si Dokploy sert les fichiers avec sa propre configuration nginx, vérifier que
> `/sw.js` n'est pas mis en cache : un service worker servi depuis le cache HTTP
> gèle les mises à jour.

### 5.2 Application Docker (recommandé si l'on veut la politique de cache exacte)

- Type : **Dockerfile** ;
- contexte de build : racine du dépôt ;
- Dockerfile : `Dockerfile` ;
- port exposé : `80` ;
- healthcheck : `GET /` (déjà déclaré dans l'image) ;
- domaine : celui fourni par Dokploy.

Les deux cibles servent exactement le même `dist/`. `nginx.conf` (racine) est la
seule différence : cache long sur les assets hachés, cache nul sur `index.html` et
`sw.js`, `gzip`, en-têtes de sécurité minimaux, repli SPA
(`try_files $uri $uri/ /index.html`).

### 5.3 Sous-répertoire

`vite.config.ts` utilise `base: './'`, le manifeste déclare `start_url` et `scope`
à `./`, et les URL de précache sont relatives : un déploiement sous
`https://exemple.test/aron36/` fonctionne sans reconfiguration.

## 6. Mise à jour d'un déploiement

1. merger sur `main` → rebuild ;
2. les assets changent de nom (empreinte), le `sw.js` change de version de cache ;
3. les visiteurs déjà installés voient la bannière de mise à jour au chargement
   suivant et choisissent le moment du rechargement ;
4. les anciens caches (`aron36-<ancienne empreinte>`) sont supprimés à
   l'activation du nouveau worker.

Aucun rechargement forcé n'est imposé : c'est délibéré (session de révision en
cours).

## 7. Dépannage

| Symptôme                           | Cause probable                       | Action                                                                                              |
| ---------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Bannière de mise à jour absente    | `/sw.js` servi avec un cache long    | vérifier `Cache-Control` sur `/sw.js` (doit être `no-store`)                                        |
| Application blanche hors ligne     | un asset manque au précache          | `npm run build` échoue normalement ; sinon `node scripts/build-sw.mjs` liste les fichiers précachés |
| Ancienne version affichée en ligne | `index.html` mis en cache            | vérifier `Cache-Control: no-cache` sur `/index.html`                                                |
| Worker jamais `activated`          | scope ou chemin incorrect            | le worker doit être servi à la racine du déploiement (`/sw.js`, pas `/assets/sw.js`)                |
| Icônes manquantes à l'installation | manifeste pointant un fichier absent | le build échoue (`scripts/build-sw.mjs`) ; vérifier `public/icons/`                                 |
