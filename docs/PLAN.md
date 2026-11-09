# Aron 36 — Plan d'orchestration

> Document de pilotage. Il décrit **quoi** on construit, **pourquoi** (science de
> l'apprentissage), **comment** le travail est découpé, et **quelles règles** les
> agents impliqués doivent respecter. Il est la source de vérité du projet tant
> que `docs/ARCHITECTURE.md` n'est pas écrit (Phase 1).

## 1. Objectif

Une application web (statique, hors ligne-first) **ludique et pédagogique** dont
le but unique et mesurable est :

> **Restituer par cœur les 36 questions d'Arthur Aron, dans l'ordre, avec leur
> formulation, à partir de n'importe quel indice (numéro, mot-clé, image, film
> mental).**

Ce n'est pas un jeu « sur » les 36 questions : c'est un **entraîneur de
mémorisation** enveloppé dans une progression ludique. La ludification sert la
rétention, jamais l'inverse.

### Métrique de succès (critère d'acceptation produit)

| Palier | Définition | Mesure dans l'app |
|---|---|---|
| Bronze | Réciter les 3 actes dans l'ordre, sans aide, à l'écrit | Test « Récitation libre » 36/36 |
| Argent | Passer de n'importe quel mot-clé ou image → à la question | Drill inversé ≥ 90 % |
| Or | Passer d'un numéro n'importe où (1-36) → à la question | Drill numéroté ≥ 90 % |
| Diamant | Réciter à l'oral, en ≤ 6 min, après 7 jours sans révision | « Grand Oral » chronométré |

## 2. État de l'art de la science de l'apprentissage

Chaque mécanisme ci-dessous **doit** être implémentable et testable. La Phase 1
doit produire, pour chacun, une décision d'architecture (module, interface,
test) et la Phase 5 doit vérifier qu'aucun n'a été « décoratif ».

| # | Mécanisme | Référence | Traduction produit |
|---|---|---|---|
| L1 | **Rappel actif / testing effect** | Roediger & Karpicke 2006 | L'écran principal est une question à produire, pas une fiche à relire. Pas de « relire la liste ». |
| L2 | **Répétition espacée** | Ebbinghaus ; Cepeda 2006 ; Dunlosky 2013 | Ordonnanceur par item (stabilité + difficulté, type FSRS/SM-2). File « à réviser aujourd'hui ». |
| L3 | **Intervalle de séance** | Cepeda 2006 | Sessions courtes plafonnées, objectif quotidien, pas de marathon. |
| L4 | **Entrelacement** | Rohrer & Taylor 2007 | Les révisions mélangent actes et types de drill (pas de blocage par acte). |
| L5 | **Chunking hiérarchique** | Miller 1956 | 3 actes × 12. Progression par acte avant assemblage. |
| L6 | **Double codage / imagerie** | Paivio ; Maguire 2003 | Chaque question a une image mentale ; les 3 « films mentaux » sont des chaînes d'images. |
| L7 | **Méthode des liens (histoire)** | Bower 1970 ; Yates | Les images d'un acte sont chaînées ; un film se déroule comme une scène. |
| L8 | **Effet de production** | MacLeod 2010 | Récitation à voix haute encouragée, vérifiable (mode oral / auto-déclaration honnête). |
| L9 | **Difficultés désirables** | Bjork & Bjork 2011 | Indices cachés par défaut, retrait progressif des aides, jamais de reconnaissance facile. |
| L10 | **Effet de génération** | Slamecka & Graf 1978 | L'apprenant écrit ses propres accroches (mots-clés personnels, lien autobiographique). |
| L11 | **Effet d'auto-référence** | Rogers, Kuiper & Kirker 1977 | Les accroches personnelles sont stockées et réinjectées dans les drills. |
| L12 | **Métacognition / calibration** | Dunlosky & Metcalfe | Jugement de confiance avant révélation → écart confiance/réussite affiché. |
| L13 | **Feedback correctif immédiat** | Hattie & Timperley 2007 | Après chaque réponse : bonne réponse + image + « pourquoi ça rate ». |
| L14 | **Apprentissage de maîtrise** | Bloom 1968 | Pas de déblocage d'un acte sans seuil de maîtrise de l'acte précédent. |
| L15 | **Sur-apprentissage / automaticité** | Soderstrom & Bjork 2015 | Drill de vitesse (fluency) une fois la maîtrise atteinte. |
| L16 | **Variation contextuelle** | — | 5 directions de drill : 1→question, mot→question, image→question, numéro→question, question→numéro. |
| L17 | **Consolidation par le sommeil** | Rasch & Born 2013 | Rappel du soir en fin de journée + rappel différé au réveil. |
| L18 | **Prétest / génération erronée** | Richland, Kornell & Kao 2009 | Un « devine avant de voir » précède la première exposition. |

### Anti-objectifs (interdits de design)

- **Pas de punition** : pas de perte de progression, pas de vies qui bloquent une session.
- **Pas de dark patterns** : pas de notification culpabilisante, pas de rareté artificielle, pas de paiement.
- **Pas de reconnaissance déguisée en rappel** : un QCM à 4 options n'est pas un test de rappel ; il est un *drill de discrimination*, minoritaire et étiqueté comme tel.
- **Pas de ludification substitutive** : les points ne doivent jamais être gagnables sans production réelle (pas d'XP pour un simple clic « suivant »).
- **Sobriété cognitive** : une action principale par écran, pas de surcharge visuelle.

## 3. Découpage en phases

Règle générale : **Implémentation → Critique → Correction → merge**, puis phase
suivante. **Exception : la Phase 1 est l'architecture** (elle suit le même cycle,
avec pour livrable des documents + des interfaces gelées, pas des fonctionnalités).

| Phase | Objet | Livrable | Parallélisable |
|---|---|---|---|
| **1** | Architecture & outillage | `docs/ARCHITECTURE.md`, ADRs, interfaces gelées (`src/domain/**/types.ts`), build/test/lint, CI | Non (séquentiel) |
| **2** | Cœur métier pur (zéro DOM) | dataset 36 questions, ordonnanceur SRS, moteur de session, économie de jeu | Oui — 4 worktrees |
| **3** | Application & persistance | ports, adaptateur localStorage versionné, store, cas d'usage | Oui — 3 worktrees |
| **4** | Interface & design ludique | design system, écrans de jeu, carte de progression, tableau de bord | Oui — 4 worktrees |
| **5** | Durcissement & livraison | E2E, a11y AA, PWA/offline, perf, README, déploiement | Oui — 3 worktrees |

Chaque incrément arrive par **PR vers `develop`**. `main` ne reçoit que les
versions livrées (merge `develop` → `main` + tag).

## 4. Protocole d'orchestration

1. **Implémentation** — un sous-agent par lot indépendant, dans un *worktree*
   isolé, sur une branche `feat/<lot>`, PR vers `develop`.
2. **Critique** — un sous-agent **d'un modèle différent** de l'implémenteur,
   en lecture seule, qui produit une liste de constats classés
   (`bloquant` / `majeur` / `mineur`) avec fichier + ligne + preuve.
   Il ne corrige pas.
3. **Correction** — l'orchestrateur corrige lui-même les constats mineurs ;
   les constats bloquants ou majeurs repartent en sous-agent dédié.
4. **Merge** vers `develop` après CI verte et constats bloquants traités.

### Ce que tout sous-agent doit savoir avant de commencer

- Lire `docs/PLAN.md` (ce fichier) et `docs/ARCHITECTURE.md`.
- Ne jamais modifier un fichier hors de son périmètre de lot.
- Le domaine (`src/domain/**`) est **pur** : aucun DOM, aucun `localStorage`,
  aucun `Date.now()` ni `Math.random()` direct — tout passe par des ports.
- Tout code livré est typé strictement, testé (Vitest), et formaté.
- Une PR = un lot = un objectif. Pas de refactor hors périmètre.
- Écrire en **français** pour les commentaires et l'UI, en anglais pour les
  identifiants de code.

## 5. Périmètre de la v1

**Dans le périmètre** : les 36 questions (FR + EN), les 3 films mentaux,
5 directions de drill, ordonnanceur espacé, progression gamifiée (XP, niveaux,
séries, badges, collection), carte de progression, tableau de bord, plan
7 jours, stockage local versionné, hors ligne.

**Hors périmètre v1** : comptes serveur, synchronisation multi-appareils,
classements en ligne, paiement, contenu audio narré, IA générative.

## 6. Assets hérités (v0)

`docs/legacy/` contient le prototype mono-fichier précédent :
`aron36-v0.html` (application complète), `questions-fr.json` (36 questions
extraites avec mot-clé + image mentale), `plan-7-jours.json` (plan 7 jours).

> **Ces données sont une base de travail, pas une source de vérité.**
> La traduction française **doit être vérifiée** contre le texte original
> anglais de Aron et al. (1997) avant d'être figée en production. Les
> métadonnées (mot-clé, image) sont réutilisables mais à réviser.
