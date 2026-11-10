# Aron 36

Apprendre **par cœur** les 36 questions d'Arthur Aron — dans l'ordre, avec leur
formulation — grâce à un entraîneur de mémorisation fondé sur les preuves
(rappel actif, répétition espacée, entrelacement, imagerie), enveloppé dans une
progression ludique.

> Application web statique, hors ligne-first, sans compte et sans serveur.
> Les données de progression restent dans le navigateur.

## Statut

**v1.0.0** — application complète et installable.

| Domaine | État |
|---|---|
| Domaine métier (36 questions, SRS, maîtrise, gamification) | terminé |
| Interface (accueil, entraînement, collection, statistiques, réglages) | terminé |
| Persistance versionnée + import/export | terminé |
| PWA : installation, hors-ligne, mise à jour | terminé (Phase 5-A) |
| Grand Oral (examen chronométré) | livré par un autre lot de la Phase 5 |
| Traduction anglaise de l'interface | en attente de relecture native |

## Installation sur téléphone

1. ouvrir l'application dans le navigateur du téléphone (Chrome, Safari, Firefox) ;
2. menu du navigateur → **Installer l'application** / **Sur l'écran d'accueil** ;
3. l'icône « Aron 36 » apparaît comme une application native (`display: standalone`).

## Hors-ligne

Après un premier chargement, **l'application fonctionne sans réseau** : l'écran
d'entraînement, la progression, les statistiques et les réglages restent
disponibles, y compris en avion ou dans le métro. Rien n'est envoyé nulle part, et
aucune requête n'est faite au-delà du chargement des assets.

- le service worker précache l'app shell du build courant (HTML, JS, CSS, icônes,
  manifeste) et sert les assets hachés depuis le cache ;
- la page HTML est demandée au réseau d'abord (pour récupérer une éventuelle
  nouvelle version), puis prise dans le cache ;
- une nouvelle version **n'est jamais imposée** : une bannière discrète
  « Nouvelle version disponible — Recharger » apparaît, et c'est vous qui
  choisissez le moment — jamais au milieu d'une session de révision.

Détails techniques : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) § 13.5.

## Développement

```bash
npm ci
npm run dev          # serveur de développement (sans service worker)
npm run build        # tsc --noEmit + vite build + dist/sw.js
npm run preview      # sert dist/ : c'est là que le hors-ligne se teste
npm test             # Vitest (domaine, application, interface, PWA, build du SW)
npm run lint
npm run typecheck
npm run format:check
npm run traceability:check
```

Le service worker n'est généré qu'au build (`scripts/build-sw.mjs`) : en
développement, `npm run dev` n'en enregistre aucun.

Les icônes PNG sont des artefacts committés, régénérables depuis les SVG avec
`npm run icons` (nécessite ImageMagick).

## Déploiement

Image Docker multi-étapes (Node → nginx), ou cible statique Dokploy :

```bash
docker build -t aron36 .
docker run --rm -p 8080:80 aron36
```

Procédure complète, vérifications `curl` et dépannage : [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Documentation

| Fichier | Contenu |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Objectif, science de l'apprentissage mobilisée, phases, protocole d'orchestration |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture technique, modules, interfaces, contrats de données, PWA |
| [`docs/adr/`](docs/adr/) | Décisions d'architecture et alternatives rejetées |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Build, Docker/nginx, Dokploy, hors-ligne, dépannage |
| [`docs/TRACEABILITY.md`](docs/TRACEABILITY.md) | Chaque mécanisme d'apprentissage → code → test qui le prouve |

## Limites connues

- **Traduction française des questions** : le contenu est en français et relu,
  mais la traduction anglaise de l'interface **attend une relecture native** ; des
  formulations peuvent encore bouger.
- **Grand Oral** (récitation chronométrée des 36 questions) : écran d'attente,
  livré par un autre lot de la Phase 5.
- **Multi-onglets** : la progression a un seul propriétaire (`localStorage`) et
  aucun verrou ; deux onglets ouverts simultanément, le dernier écrivain gagne.
  Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) § 5.5 (hors périmètre v1).
- **CSP stricte** non activée : une politique non testée casserait l'application
  sur des navigateurs anciens. À traiter avec des tests de bout en bout.

Le prototype mono-fichier précédent est conservé dans `docs/legacy/` : il sert de
source de contenu (36 questions, mots-clés, images mentales, plan 7 jours) et de
référence de comportement.

## Licence

MIT — voir [`LICENSE`](LICENSE).
