# ADR 0006 — CSS sans framework, design tokens et CSS Modules

- **Statut** : accepté
- **Date** : 2026-11-09
- **Phase** : 1

## Contexte

L'interface doit être lisible, sobre, accessible (WCAG 2.2 AA), avec une
identité visuelle chaleureuse et des couleurs par acte. Le prototype v0 tient
dans un fichier HTML avec du CSS global et des styles inline. Le projet exige
explicitement **aucun framework CSS** (ni Tailwind ni MUI). Les agents des
phases suivantes doivent pouvoir créer des composants sans se battre contre un
système de classes imposé.

## Décision

- **Design tokens** dans `src/styles/tokens.css` : couleurs, typographie,
  espacements, rayons, ombres, durées, z-index, cible tactile minimale.
- **CSS global minimal** dans `src/styles/global.css` : reset, styles de base,
  focus visible, `prefers-reduced-motion`.
- **CSS Modules** (`Component.module.css`) pour les composants de la Phase 4 :
  portée locale, aucune collision, aucun runtime.
- **Aucune bibliothèque CSS** : pas de Tailwind, MUI, Bootstrap, styled-
  components, emotion.
- **Thème sombre par défaut** via `color-scheme: dark` ; les tokens sont prévus
  pour un thème clair ultérieur sans réécrire les composants.
- **Mouvement** : toutes les durées passent par `--motion-*`, neutralisées par
  `prefers-reduced-motion`.

## Conséquences

- Le CSS est natif, inspectable, sans étape de génération ni dépendance.
- Les tokens garantissent la cohérence et rendent les audits de contraste
  possibles sur une source unique.
- Les CSS Modules évitent les fuites de style et permettent la parallélisation
  des écrans.
- Coût : pas d'utilitaires prêts à l'emploi ; les composants doivent écrire
  leur CSS. C'est acceptable pour une application de cette taille.
- Les tokens sont un contrat de design : les modifier change l'apparence
  globale, pas la structure.
- Aucun CSS-in-JS : pas de coût runtime, pas de hydratation, meilleur
  rendement hors ligne.
- L'accessibilité est intégrée dès les tokens (focus, cible, mouvement) plutôt
  qu'ajoutée après coup.

## Alternatives rejetées

| Alternative                     | Raison du rejet                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Tailwind CSS**                | Exclu par le cahier des charges ; classes utilitaires nombreuses dans le JSX, difficile à auditer pour l'accessibilité. |
| **MUI / Chakra / Radix Themes** | Exclus ; apport visuel générique, bundle lourd, personnalisation coûteuse.                                              |
| **styled-components / emotion** | Runtime, hydratation, bundle plus lourd, styles difficiles à inspecter.                                                 |
| **vanilla-extract**             | Excellent typage mais étape de build supplémentaire et courbe d'apprentissage pour des agents parallèles.               |
| **SASS/SCSS**                   | Dépendance de compilation, variables redondantes avec les custom properties natives.                                    |
| **CSS global seul**             | Risque de collisions et de régressions croisées entre écrans développés en parallèle.                                   |
