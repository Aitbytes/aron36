# ADR 0009 — Unités numériques non brandées + validation à l'exécution

- **Statut** : accepté
- **Date** : Phase 1
- **Décision liée** : contrats de `src/domain/shared/types.ts`

## Contexte

Les contrats du domaine manipulent plusieurs grandeurs numériques qui ne doivent
jamais être confondues : un instant (`EpochMs`), une durée (`DurationMs`), un
intervalle (`Days`), un ratio (`Ratio`, borné à [0, 1]), une difficulté
(`difficulty`, bornée à [1, 10]), une position dans un acte (1..12).

Une confusion d'unités est le risque d'erreur le plus coûteux d'un ordonnanceur
espacé : écrire `previewIntervals → 60000` au lieu de `1` (jour) compile
parfaitement et produit des échéances absurdes, sans aucun test unitaire en échec
tant que le test ne vérifie pas explicitement l'unité.

Le système de types de TypeScript ne distingue pas `number` d'un alias
`type Days = number`. Deux stratégies étaient possibles.

## Décision

**Ne pas introduire de types brandés** (`type Days = number & { __brand: 'days' }`)
à la Phase 1, et **imposer à la place** :

1. une **convention de nommage stricte** : tout champ porte son unité
   (`intervalDays`, `responseTimeMs`, `dueAt`, `elapsedDays`) — vérifiée en
   revue et par un lint de nommage si nécessaire ;
2. une **table de bornes exécutables**, `NUMERIC_BOUNDS`, qui décrit pour chaque
   champ borné son `inclusiveMin` et son `inclusiveMax` ;
3. l'obligation de valider contre cette table **toute valeur entrant dans le
   domaine** depuis une source non fiable : lecture localStorage, import JSON,
   saisie utilisateur, retour d'un port ;
4. un test de contrat (`contracts.test.ts`) qui fige les bornes structurantes
   (`questionId` 1..36, `actId` 1..3, `positionInAct` 1..12, `difficulty` 1..10,
   `ratio` 0..1) et empêche leur dérive silencieuse.

## Conséquences

**Positives**

- Aucune friction de conversion dans le domaine : `a + b` reste possible, les
  tests restent lisibles, et un agent qui implémente un module n'a pas à
  reconstruire des valeurs brandées à chaque appel.
- Les bornes sont **vérifiables à l'exécution**, ce que des types brandés ne
  feraient pas : un `difficulty: 42` venu d'un JSON corrompu reste rejeté.
- Le coût est concentré là où il compte : une seule frontière de validation
  (décodage de progression) plutôt que des casts dans tout le domaine.

**Négatives / risques assumés**

- `tsc` seul ne protège ni les unités ni les bornes à l'intérieur du domaine.
  Un bug d'unité reste possible entre deux fonctions du domaine pur.
- La protection repose sur la discipline de la revue et sur les tests de
  propriétés/monotonie du SRS, pas sur le compilateur.
- La validation est une obligation de contrat : si la Phase 3 l'oublie, la
  garantie tombe. Le test de contrat couvre la table, pas son usage.

## Alternatives rejetées

1. **Types brandés partout** (`Days`, `EpochMs`, `DurationMs`, `Minutes`).
   Sécurité maximale à la compilation, mais impose des casts et des constructeurs
   dans chaque module, rend l'arithmétique verbeuse (`addDays(a, b)`), et
   n'apporte **aucune** garantie sur les valeurs venant de l'extérieur — le
   risque réel. Coût de migration élevé pour un gain partiel.
2. **`zod` / schéma de validation tiers dès la Phase 1.** Ajoute une dépendance
   d'exécution au domaine, alors que le plan impose un domaine sans dépendance.
   La validation sera écrite à la main dans `application`/`infrastructure`, où
   elle est de toute façon nécessaire.
3. **Ne rien faire.** Écarté : les bornes ne seraient que des commentaires, ce
   que la critique de Phase 1 a précisément identifié comme le défaut principal
   des contrats numériques.

## Révision

Si un bug d'unités survient malgré les tests de monotonie, réévaluer l'option 1
en la limitant aux deux grandeurs les plus dangereuses (`Days` et `EpochMs`),
avec des constructeurs explicites (`days(1)`, `epochMs(n)`) plutôt que des casts
nus.
