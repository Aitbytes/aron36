# Journal des modifications

## [0.2.0] — Phase 2 : domaine complet

Domaine métier pur (aucun DOM, aucune I/O), couvert par ses tests.

### Ajouté

- **Dataset FR/EN** : les 36 questions d'Aron et al. (1997), 3 actes de 12,
  mots-clés uniques et discernables, images mentales, provenance de traduction
  explicite.
- **Films mentaux** : 3 films de 12 scènes chaînées par des transitions
  causales ou visuelles.
- **SRS** (FSRS-lite déterministe) : stabilité `S`, difficulté `D`, intervalles
  bornés, prévisualisation des notes, journal de révision.
- **Maîtrise** : critères par carte et par directions, déblocage des actes.
- **Session** : builder (5 directions, entrelacement, indices progressifs,
  prétest), machine à états, feedback correctif.
- **Économie de jeu** : XP adossée à la production réelle, niveaux et titres,
  séries et gels, badges, quêtes quotidiennes déterministes, collection des 36
  cartes, métriques dérivées.

### Corrigé

Cinq défauts issus des revues adverses :

1. **Rétention sur la stabilité** : `R = targetRetention ^ (elapsedDays /
max(S, ε))`, et non sur `intervalDays` (un palier de minutes en
   apprentissage), bornée à `[0, 1]`, `R = 0` pour une carte jamais révisée.
2. **Chute réellement coûteuse** : la graduation du réapprentissage repart d'un
   intervalle court fixé par la configuration (1 j, 2 j pour `easy`),
   indépendant de la stabilité héritée.
3. **Difficulté active** : facteurs de croissance multipliés par
   `m(D) ∈ [0,5 ; 1,5]` ; la croissance de `hard` est plafonnée à 50 % de
   `maxIntervalDays`.
4. **Maîtrise sur notes de qualité** : la série (`good`/`easy`) et le nombre de
   révisions sont recalculés depuis les `ReviewLog` ; le compteur
   `CardState.consecutiveSuccesses` de l'ordonnanceur n'entre pas dans le
   critère.
5. **Monotonie garantie** : reports bornés par `maxIntervalDays` et
   `dueAt' > dueAt` pour `hard`/`good`/`easy`, y compris à saturation et sur un
   état importé hors invariants.

### Limites connues

- Traduction FR en attente d'une relecture native (`TRANSLATION_PROVENANCE` :
  `humanReview: 'pending'`).
- Phases 3 à 5 à venir : application et persistance, interface, durcissement.
- L8 (récitation orale, `SpeechPort`) et les volets Phase 3 de L17/L18 restent
  partiels ; voir `docs/TRACEABILITY.md`, généré depuis les tests.
