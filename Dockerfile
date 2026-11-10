# Aron 36 — image de production.
#
# Deux étapes : Node compile, nginx sert. **Aucun runtime Node en production** :
# l'application est un site statique sans backend (voir docs/DEPLOY.md).
#
#   docker build -t aron36 .
#   docker run --rm -p 8080:80 aron36
#
# Contexte de build = racine du dépôt (`.dockerignore` limite ce qui est envoyé).

# ── Étape 1 : compilation ──────────────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

# Dépendances d'abord : la couche reste en cache tant que le lockfile ne change
# pas, alors que le code source change à chaque commit.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `npm run build` = `tsc --noEmit` + `vite build` + `node scripts/build-sw.mjs`
# (génération de `dist/sw.js` : version de cache dérivée du contenu du build).
# La compilation est stricte : une erreur de type fait échouer l'image.
RUN npm run build

# ── Étape 2 : service statique ────────────────────────────────────────────────
FROM nginx:alpine

# Configuration : cache long sur les assets hachés, cache nul sur `index.html`
# et `sw.js`, compression, en-têtes de sécurité minimaux, repli SPA.
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
