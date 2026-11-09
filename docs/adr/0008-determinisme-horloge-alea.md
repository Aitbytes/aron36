# ADR 0008 — Déterminisme par horloge et aléa injectés

- **Statut** : accepté
- **Date** : 2026-11-09
- **Phase** : 1

## Contexte

Les règles du produit dépendent du temps (échéances SRS, séries, quêtes
quotidiennes, fenêtres soir/matin, sessions chronométrées) et du hasard
(entrelacement, leurres de QCM, ordre des options, tirage des quêtes). Si le
domaine lisait directement `Date.now()` ou `Math.random()`, les tests seraient
non reproductibles, les bugs difficiles à reproduire et les sessions
impossibles à rejouer.

## Décision

- **`ClockPort`** fournit `now()`, `dayKey(at)`, `startOfLocalDay(dayKey)` et le
  fuseau. Le domaine reçoit toujours `now: EpochMs` en paramètre.
- **`RandomPort`** fournit `nextFloat`, `nextInt` et `shuffle`, avec une graine
  (`RandomSeed`) en lecture seule.
- **Une session enregistre sa graine** (`SessionPlan.seed`) et la recopie dans
  `SessionLog.planSeed`. Rejouer la graine avec une nouvelle instance de port
  reproduit exactement le plan.
- **Mélange spécifié** : Fisher–Yates de `i = n−1` à `1` avec
  `nextInt(0, i+1)`. Toute consommation de la séquence est donc déterministe et
  documentée.
- **Les cas d'usage créent la graine** via `AppServices.newSeed()`
  (`crypto.randomUUID` en production, compteur en test) ; le domaine ne connaît
  ni `crypto` ni l'horloge système.
- **ESLint interdit** `Date`, `Date.now`, `Math.random`, `performance` et
  `crypto` dans `src/domain/**`.

## Conséquences

- Les tests SRS, séries et quêtes sont exacts, sans fake timers globaux.
- Un rapport de bug peut inclure la graine et l'horloge pour rejouer la session.
- Les tirages quotidiens sont stables après rechargement (même `dayKey`, même
  graine).
- Le `RandomPort` doit être une **nouvelle instance par session** : réutiliser
  une instance après d'autres appels décale la séquence. C'est documenté dans
  le contrat.
- L'horloge locale doit gérer les changements d'heure ; `ClockPort.dayKey` est
  basé sur `Intl` et testé aux transitions DST (Phase 3).
- Coût : passage de paramètres supplémentaires (`now`, `random`) dans les
  fonctions du domaine. C'est explicite et testable.

## Alternatives rejetées

| Alternative                                        | Raison du rejet                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| **`Date.now()` et `Math.random()` directs**        | Tests non déterministes, sessions non rejouables, lint impossible.                |
| **Fake timers globaux (`vi.useFakeTimers`)**       | Efficaces mais implicites ; le domaine resterait dépendant d'une horloge globale. |
| **Graine dérivée du contenu (hash des questions)** | Ne permet pas de varier les sessions ni de contrôler le tirage.                   |
| **Aléa non seedé mais journalisé**                 | Impossible de reproduire exactement un plan.                                      |
| **Fuzz SRS**                                       | Complexifie les tests de monotonie ; reporté, désactivable par configuration.     |
| **UUID généré dans le domaine**                    | Dépendance à `crypto`, non déterministe, viole la pureté.                         |
