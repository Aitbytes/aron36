# ADR 0005 — Internationalisation par catalogues typés

- **Statut** : accepté
- **Date** : 2026-11-09
- **Phase** : 1

## Contexte

Le produit est francophone par défaut, avec l'anglais comme seconde langue
envisagée. Le contenu des 36 questions est lui-même traduit : chaque question
porte un mot-clé, une formulation et une image mentale dans plusieurs langues.
Les textes d'interface (boutons, feedback, quêtes, badges) sont nombreux et
doivent rester cohérents, accessibles et faciles à corriger sans toucher aux
composants.

## Décision

- **Locale par défaut** : `fr` ; seconde locale : `en`.
- **Contenu** : `LocalizedText { fr: string; en?: string }` dans le dataset
  (`QuestionItem`, `MemoryFilm`). Le français est toujours présent ; l'anglais
  est optionnel avec repli français.
- **Interface** : catalogues TypeScript typés dans `src/i18n/locales/fr.ts` et
  `en.ts`, exposés par `MessageCatalog` et traduits par `Translator`.
- **Aucun texte visible dans un composant** : les composants reçoivent `t` et
  des clés (`session.reveal`, `feedback.partial`).
- **Repli déterministe** : locale demandée → `fr` → clé brute (visible en
  développement uniquement).
- **Formats** : `Intl.NumberFormat` / `Intl.DateTimeFormat` dans l'UI ; le
  domaine ne formate jamais de date ni de nombre.
- **Ajout d'une langue** : union `LocaleCode`, catalogue complet, libellé,
  champs de contenu, test de complétude, vérification de mise en page.

## Conséquences

- Les clés manquantes sont détectées à la compilation si le catalogue est typé
  par une union de clés, et à l'exécution par le test de complétude.
- Les agents peuvent travailler sur l'UI sans connaître les traductions : ils
  utilisent des clés stables.
- Les catalogues sont des modules TypeScript, donc tree-shakables et sans
  requête réseau : compatible hors ligne.
- Le contenu et l'interface sont séparés : corriger une traduction de question
  ne touche pas l'UI, et inversement.
- Coût : maintenir deux catalogues et un test de parité ; les traductions
  anglaises peuvent être incomplètes sans bloquer (repli `fr`).
- Les textes longs (questions) ne passent pas par les catalogues d'interface :
  ils restent dans le dataset, ce qui évite des clés artificielles.

## Alternatives rejetées

| Alternative                             | Raison du rejet                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Textes codés en dur en français**     | Impossible d'ajouter une langue sans refactor global ; contraire à la maintenabilité.                          |
| **i18next / react-i18next**             | Dépendance lourde, chargement dynamique, API runtime ; surdimensionné pour deux locales et un bundle statique. |
| **react-intl / FormatJS**               | Puissant mais volumineux ; les besoins de formatage sont couverts par `Intl` natif.                            |
| **Fichiers JSON chargés à l'exécution** | Requêtes réseau, gestion d'erreur, perte du typage à la compilation.                                           |
| **Une clé par phrase dans le dataset**  | Mélange contenu et interface, rend les questions illisibles.                                                   |
| **Traduction automatique à la volée**   | Qualité aléatoire, dépendance réseau, contraire au hors-ligne-first.                                           |
