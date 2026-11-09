# ADR 0007 — Stratégie de test : Vitest, Testing Library, Playwright en Phase 5

- **Statut** : accepté
- **Date** : 2026-11-09
- **Phase** : 1

## Contexte

Le projet est développé par des agents en parallèle, sur la base de contrats de
types. Les règles pédagogiques (SRS, entrelacement, maîtrise, XP) sont
nombreuses, subtiles et sujettes aux régressions silencieuses. Les tests doivent
être rapides, déterministes et exécutables en CI sans navigateur. L'interface
devra être vérifiée sur les parcours critiques et l'accessibilité.

## Décision

- **Vitest 3** comme runner unique, configuré avec `jsdom` et les mêmes alias
  que Vite.
- **Testing Library** (`@testing-library/react`, `jest-dom`, `user-event`) pour
  les tests de composant : requêtes par rôle et nom accessible, pas par classe
  CSS.
- **Couverture V8** via `@vitest/coverage-v8`, avec exclusion des fichiers de
  types et des ports (aucun code exécutable).
- **Pyramide** : ~70 % unitaire domaine, ~15 % application/infrastructure,
  ~12 % composant, ~3 % E2E.
- **Déterminisme obligatoire** : `FakeClock`, `SeededRandom`, `MemoryStorage`,
  `FakeSpeechPort`. Aucun test ne dépend de l'heure, du hasard ou du réseau.
- **Tests de contrat** : les constantes gelées (36 questions, 5 directions,
  schéma 1, barèmes) sont vérifiées explicitement (`src/contracts.test.ts`).
- **E2E Playwright en Phase 5** : parcours découvrir → réviser → exporter →
  réimporter, navigation clavier, `prefers-reduced-motion`, viewport mobile.
- **Seuils de couverture cibles** : 95 % lignes/branches sur `domain/**` (hors
  `types.ts`), 90 % sur `application/**` et l'infrastructure, 80 % sur `ui/**`.
  Les seuils seront activés dans `vitest.config.ts` en Phase 5.

## Conséquences

- Un seul runner pour l'unitaire, le composant et l'intégration : configuration
  simple, exécution rapide, pas de duplication d'alias.
- Les tests de domaine sont de purs tests de fonctions : aucune simulation de
  navigateur, exécution en quelques millisecondes.
- Les tests de composant vérifient l'accessibilité par rôle, ce qui détecte les
  régressions a11y basiques.
- Playwright n'est pas installé en Phase 1 : la CI reste légère, l'E2E arrive
  quand les écrans existent.
- Coût : maintenir des fixtures de contenu et des faux ports ; c'est le prix du
  déterminisme.
- Les snapshots de rendu sont évités (fragiles, peu informatifs) au profit
  d'assertions sémantiques.

## Alternatives rejetées

| Alternative                                  | Raison du rejet                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| **Jest**                                     | Configuration ESM/TS plus lourde, redondance avec Vite, performances inférieures. |
| **Cypress seul**                             | Lent, orienté E2E, mauvais pour tester le domaine pur.                            |
| **Enzyme**                                   | Obsolète, incompatible React 19, API contraire aux tests par rôle.                |
| **Tests basés sur les snapshots**            | Fragiles, illisibles, ne prouvent pas le comportement.                            |
| **Mocks globaux de `Date` et `Math.random`** | Couplage implicite, tests fragiles ; les ports injectés sont plus clairs.         |
| **Pas de tests de composant**                | Les régressions d'accessibilité et de focus ne seraient détectées qu'en E2E.      |
| **E2E dès la Phase 1**                       | Aucun écran métier à tester ; coût inutile.                                       |
