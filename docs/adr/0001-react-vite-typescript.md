# ADR 0001 — React 19 + Vite + TypeScript strict

- **Statut** : accepté
- **Date** : 2026-11-09
- **Phase** : 1

## Contexte

Aron 36 est une application statique, hors ligne-first, sans backend, dont
l'interface est fortement interactive : drills minutés, feedback immédiat,
indices progressifs, animations sobres, accessibilité clavier complète. Le
contenu tient dans un bundle unique et la progression vit dans le navigateur.
L'équipe est composée d'agents qui doivent pouvoir travailler en parallèle sur
des modules isolés, avec des contrats de types fiables.

## Décision

- **React 19** pour l'interface, avec `react-dom/client` et `StrictMode`.
- **Vite 7** pour le serveur de développement et le build de production.
- **TypeScript 5.9 en mode strict maximal** : `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`.
- Alias unique `@/` → `src/`, déclaré dans `tsconfig.json`, `vite.config.ts` et
  `vitest.config.ts`.
- Aucun routeur côté client en v1 : la navigation est un état (`AppScreen`).
  Le build utilise `base: './'` et fonctionne à la racine comme en sous-chemin.

## Conséquences

- Un seul écosystème (npm) pour le dev, le test, le lint et le build.
- Les types stricts servent de contrat inter-phases : une incompatibilité est
  détectée à la compilation, pas à l'exécution.
- React 19 impose `react-dom/client` et supprime les API legacy ; aucun code
  n'en dépend.
- `exactOptionalPropertyTypes` interdit de passer `undefined` à une propriété
  optionnelle : les appelants doivent omettre la clé. C'est volontaire et rend
  les contrats non ambigus.
- La navigation par état évite les problèmes de `base` et de réécriture nginx,
  au prix de l'absence de liens profonds par URL (acceptable pour une app
  mono-écran).
- Le bundle React représente l'essentiel du poids JS ; le budget de performance
  de la Phase 5 devra le prendre en compte (cible < 250 KB gzip).

## Alternatives rejetées

| Alternative                    | Raison du rejet                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Svelte / Solid**             | Bundle plus léger, mais écosystème de test et de composants moins standard pour des agents parallèles ; React 19 est déjà maîtrisé par l'outillage cible. |
| **Next.js / Remix**            | Inutile sans serveur ; ajoute du rendu serveur, du routage et des conventions incompatibles avec un hébergement statique simple.                          |
| **Vue 3**                      | Viabilité équivalente, mais aucun gain décisif et moins de familiarité dans l'équipe d'agents.                                                            |
| **Create React App / Webpack** | Outillage obsolète, builds lents, configuration opaque.                                                                                                   |
| **JavaScript + JSDoc**         | Les garanties de types sont nécessaires pour des contrats inter-phases ; JSDoc est plus verbeux et moins strict.                                          |
| **TypeScript `strict: false`** | Incompatible avec l'exigence de contrats non ambigus.                                                                                                     |
