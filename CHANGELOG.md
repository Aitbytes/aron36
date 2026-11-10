# Journal des modifications

## [1.0.0] — Version jouable, installable, hors-ligne

L'application est complète : les 36 questions s'apprennent, se révisent et
s'examinent dans un navigateur, sans compte et sans réseau.

### Ajouté

- **Interface** : accueil, carte de progression (3 actes × 12 nœuds, 5 états),
  écran de jeu, collection, tableau de bord, réglages, Grand Oral.
- **Écran de jeu** : les 5 directions de drill, indices progressifs, jugement de
  confiance **avant** révélation, feedback correctif, auto-notation, abandon.
- **Grand Oral** : examen final sur les 36 items, aucun QCM, aucun champ de
  saisie, chronomètre mesuré par `ClockPort`, verdict chiffré
  (durée ≤ 6 min et précision ≥ 90 %).
- **PWA** : manifeste, icônes, service worker à cache versionné par hash du
  build, précache exhaustif vérifié par test, bannière de mise à jour discrète.
  L'application fonctionne entièrement hors-ligne après le premier chargement.
- **Déploiement** : `Dockerfile` multi-étapes + `nginx.conf` (repli SPA, gzip,
  `immutable` sur `/assets/`, `no-store` sur `sw.js` et `index.html`, MIME
  correct du manifeste). `docs/DEPLOY.md`.
- **Accessibilité** : repères, lien d'évitement, focus géré, `aria-live`,
  cibles ≥ 44 px, mouvement réduit, contrastes vérifiés, reflow sans débordement
  de 320 à 1280 px.
- **i18n** : catalogues FR/EN typés (une clé manquante casse la compilation).

### Corrigé

- Barres de progression pleines à 0 : `inlineSize: "0 %"` est une déclaration
  CSS invalide, silencieusement ignorée.
- Seuil de déblocage d'acte affiché à 0 % au lieu de 90 %.
- Défilement horizontal sur tous les écrans ≤ 414 px.
- Quatre réglages affichés et persistés mais jamais relus.
- L18 (prétest) inatteignable depuis l'interface ; indices identiques au cue,
  facturés en XP.
- Confiance journalisée seulement en `review`/`grand-oral`.
- `sessionLogs` jamais écrits, `IdPort` jamais appelé (métriques et badges
  inatteignables).
- Deux sources de vérité pour la progression (store vs cas d'usage) : le store
  ne calcule plus rien, il installe l'état persisté.
- Rétention calculée sur un intervalle en minutes ; chute cosmétique ;
  difficulté jamais relue dans l'ordonnanceur.

### Limites connues

- **Traduction FR en attente de relecture par un francophone natif**
  (`TRANSLATION_PROVENANCE.humanReview = 'pending'`). Les 36 libellés sont figés
  par un test de régression : ils ne bougeront plus seuls, mais leur justesse
  n'est pas certifiée.
- Le palier « Diamant » du plan mentionne « après 7 jours sans révision » : non
  vérifiable dans une session, le verdict repose sur les deux critères
  mesurables (durée, précision).
- Multi-onglets : le dernier écrivain gagne (documenté, non résolu).
- Pas de synchronisation entre appareils (choix assumé : aucun serveur).
- Les tests de bout en bout ne sont pas automatisés dans la CI : le parcours a
  été vérifié manuellement dans Chromium, et le reflow mesuré à 320/375/414 px.

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
