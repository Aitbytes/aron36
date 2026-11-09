# ADR 0002 — Domaine pur, ports et adaptateurs

- **Statut** : accepté
- **Date** : 2026-11-09
- **Phase** : 1

## Contexte

Le cœur du produit est un ensemble de règles pédagogiques : ordonnancement
espacé, sélection entrelacée, indices progressifs, maîtrise, économie de jeu.
Ces règles doivent être testables sans navigateur, sans horloge réelle et sans
aléa imprévisible. Les Phases 2 et 3 seront développées en parallèle : la
première livre le domaine, la seconde l'application et la persistance. Sans
frontière explicite, les deux se contamineraient (React dans les calculs,
`localStorage` dans les règles, etc.).

## Décision

Appliquer une architecture **ports et adaptateurs** (hexagonale) :

```
ui → application → domain
infrastructure → application (ports) → domain
```

- `src/domain/**` est **pur** : aucun import de React, du DOM, de
  `application`, `infrastructure`, `ui` ou `i18n` ; aucun `Date`, `Math.random`,
  `localStorage`, `window`, `fetch`, `crypto`.
- Toute I/O traverse un port déclaré dans `src/application/ports/` :
  `ClockPort`, `RandomPort`, `StoragePort`, `SpeechPort`.
- Les cas d'usage (`application/usecases`) sont le seul endroit qui combine
  domaine + ports.
- Les adaptateurs concrets vivent dans `src/infrastructure/` et ne sont jamais
  importés par l'UI.
- Les frontières sont **exécutables** : règles ESLint dédiées dans
  `eslint.config.js`, vérifiées par la CI.

Le sens des dépendances est documenté dans `docs/ARCHITECTURE.md` § 3.4.

## Conséquences

- Le domaine est testable en pur Node/jsdom avec des entrées explicites ;
  aucun mock de framework n'est nécessaire.
- Les tests sont déterministes : horloge et aléa injectés.
- La Phase 2 peut être développée sans connaître React ni le stockage ; la
  Phase 3 peut être développée sans connaître l'UI.
- Coût : quelques indirections supplémentaires (ports, résultats explicites)
  et l'obligation de passer `now` et `RandomPort` en paramètres.
- Une règle métier qui aurait besoin d'une I/O doit être repensée : soit elle
  reçoit la donnée en entrée, soit elle appartient à l'application. C'est une
  contrainte saine.
- Les erreurs d'import sont détectées par le lint, pas seulement par revue.

## Alternatives rejetées

| Alternative                                            | Raison du rejet                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Domaine dans les composants React**                  | Tests lents, logique dupliquée, impossible de paralléliser les phases.                  |
| **Architecture en couches classique sans ports**       | Le domaine importerait `localStorage` ou `Date`, rendant les tests non déterministes.   |
| **Redux Toolkit comme cœur métier**                    | Couple l'état métier à une bibliothèque et à un framework ; le store applicatif suffit. |
| **Programmation fonctionnelle totale (Effect, fp-ts)** | Complexité et courbe d'apprentissage disproportionnées pour un jeu de 36 cartes.        |
| **Monorepo multi-paquets**                             | Un seul produit, un seul build ; les dossiers et les règles de lint suffisent.          |
