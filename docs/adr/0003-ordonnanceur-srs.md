# ADR 0003 — Ordonnanceur SRS : FSRS-lite déterministe

- **Statut** : accepté
- **Date** : 2026-11-09
- **Phase** : 1

## Contexte

Le produit doit faire mémoriser 36 questions à long terme. Les révisions doivent
revenir au bon moment, s'adapter aux erreurs et ne jamais récompenser une
réponse facile par un oubli programmé. Le prototype v0 utilisait des boîtes de
Leitner (5 boîtes, intervalles 1/2/4/8/16 jours) : simple, mais incapable de
représenter la difficulté propre à un item et de s'adapter à une révision en
retard. L'algorithme doit être testable, déterministe et explicable.

## Décision

Adopter un **FSRS-lite** à deux composantes :

- `stabilityDays` (S) : stabilité mémorielle ;
- `difficulty` (D) : difficulté intrinsèque, bornée 1..10.

Rétention estimée : `R = 0.9 ^ (elapsedDays / intervalDays)`.
Croissance de l'intervalle pour `hard`/`good`/`easy`, décroissance et
réapprentissage pour `again`, rappel de difficulté vers la moyenne. Les formules
exactes et les garanties de monotonie sont dans `docs/ARCHITECTURE.md` § 6.

Choix structurants :

- **Aucun fuzz** en v1 : pas d'aléa dans l'ordonnanceur, donc tests exacts et
  échéances reproductibles. Un fuzz optionnel pourra être ajouté plus tard via
  `RandomPort`, sans changer le contrat.
- **Horloge injectée** : `now` est un paramètre, jamais `Date.now()`.
- **Quatre notes** : `again`, `hard`, `good`, `easy` (au lieu du couple
  binaire réussite/échec), pour distinguer un rappel laborieux d'un rappel
  fluide.
- **Pas de pénalité destructrice** : `again` ramène en réapprentissage mais ne
  remet jamais la carte à zéro ni ne supprime l'historique.
- **Critère de maîtrise séparé** : `intervalDays ≥ 21`, `consecutiveSuccesses ≥ 2`,
  `reps ≥ 3`, plus une couverture de directions.

## Conséquences

- Les intervalles initiaux sont lisibles (1 j après apprentissage, 4 j si
  `easy`) et les révisions en retard accélèrent la consolidation.
- Le nombre de paramètres reste faible (une dizaine), tous dans
  `DEFAULT_SCHEDULER_CONFIG`, donc ajustables sans migration de données.
- Les tests peuvent vérifier des invariants forts : une bonne réponse ne recule
  jamais l'échéance, `previewIntervals` est ordonné, la difficulté reste bornée.
- Limite assumée : ce n'est pas un FSRS complet (pas de 17 paramètres ni de
  calibration par utilisateur). Les valeurs par défaut devront être validées
  par un playtest en Phase 5.
- Toute carte est auto-suffisante : `CardState` contient tout le nécessaire,
  aucune dépendance à l'historique complet pour ordonnancer.

## Alternatives rejetées

| Alternative                               | Raison du rejet                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boîtes de Leitner (v0)**                | Ne modélise ni la difficulté ni le retard ; intervalles fixes, progression mécanique.                                                              |
| **SM-2 (Anki historique)**                | Le facteur de facilité peut produire des intervalles non monotones et ne distingue pas la stabilité de la difficulté ; formule moins transparente. |
| **FSRS complet (FSRS-5/6)**               | Puissant mais sur-paramétré pour 36 items et un seul utilisateur ; calibration impossible sans données massives.                                   |
| **Répétition à intervalle fixe**          | Ignore les erreurs et la difficulté ; contraire à L2.                                                                                              |
| **Pas de SRS, révision libre**            | Ne garantit pas la rétention à 7 jours ni le critère « Diamant ».                                                                                  |
| **Apprentissage automatique côté client** | Complexité, taille de bundle, absence de données d'entraînement.                                                                                   |
