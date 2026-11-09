/**
 * Table de correspondance « mécanisme d'apprentissage → code → preuve ».
 *
 * Source de vérité de `scripts/traceability.mjs`, qui régénère
 * `docs/TRACEABILITY.md` et échoue si un mécanisme `implemented` n'a plus aucun
 * test correspondant. Toute modification ici est donc vérifiée par la CI.
 *
 * Champs :
 * - `id` / `name` : le mécanisme de `docs/PLAN.md` (§ 2).
 * - `modules` : modules du domaine qui le portent.
 * - `interfaces` : fichiers d'interface réels (vérifiés par le générateur).
 * - `tests` : motifs (RegExp) cherchés dans les intitulés **réels** de tests.
 * - `status` : `implemented` (preuve exigée et présente) · `partial` (une partie
 *   dépend d'une phase ultérieure) · `deferred-phase-3`.
 *
 * Sois honnête : un statut `partial` est un constat, jamais une excuse pour
 * inventer un test. Un test cité doit exister à l'identique dans `src/**`.
 */
export const MECHANISMS = [
  {
    id: 'L1',
    name: 'Rappel actif',
    modules: ['session'],
    interfaces: ['src/domain/session/types.ts'],
    tests: [/révéler la réponse ne note pas/i, /aucun QCM/i, /sans QCM/i],
    status: 'implemented',
  },
  {
    id: 'L2',
    name: 'Répétition espacée',
    modules: ['srs'],
    interfaces: ['src/domain/srs/types.ts'],
    tests: [
      /progresse dans les paliers puis gradue/i,
      /rétention décroît quand elapsedDays/i,
      /review \+ again déclenche une chute/i,
      /est croissant en jours/i,
      /applique exactement targetRetention/i,
    ],
    status: 'implemented',
  },
  {
    id: 'L3',
    name: 'Intervalle de séance',
    modules: ['session'],
    interfaces: ['src/domain/session/types.ts'],
    tests: [/respecte `maxItems`/i, /durée estimée/i],
    status: 'implemented',
  },
  {
    id: 'L4',
    name: 'Entrelacement',
    modules: ['session'],
    interfaces: ['src/domain/session/types.ts'],
    tests: [/entrelacement/i, /jamais deux actes identiques/i, /groupe les items par acte/i],
    status: 'implemented',
  },
  {
    id: 'L5',
    name: 'Chunking hiérarchique',
    modules: ['questions', 'mastery'],
    interfaces: ['src/domain/questions/types.ts', 'src/domain/mastery/types.ts'],
    tests: [
      /3 actes de 12/i,
      /verrouille l.acte suivant sous 90/i,
      /débloque l.acte suivant à 90/i,
      /compte les questions maîtrisées par acte/i,
    ],
    status: 'implemented',
  },
  {
    id: 'L6',
    name: 'Double codage / imagerie',
    modules: ['memory', 'session'],
    interfaces: ['src/domain/memory/types.ts', 'src/domain/session/types.ts'],
    tests: [/12 scènes/i, /images mentales non vides/i, /image-to-question/i],
    status: 'implemented',
  },
  {
    id: 'L7',
    name: 'Méthode des liens (histoire)',
    modules: ['memory'],
    interfaces: ['src/domain/memory/types.ts'],
    tests: [/chaîne les scènes/i, /transition non nulle sauf la dernière/i, /phrase de liaison/i],
    status: 'implemented',
  },
  {
    id: 'L8',
    name: 'Effet de production',
    modules: ['session', 'application'],
    interfaces: ['src/application/ports/SpeechPort.ts'],
    // Aucun test ne couvre encore la récitation orale ni `SpeechPort` : la
    // journalisation du canal appartient à la Phase 3. Constat, pas test bidon.
    tests: [],
    status: 'partial',
  },
  {
    id: 'L9',
    name: 'Difficultés désirables',
    modules: ['session'],
    interfaces: ['src/domain/session/types.ts'],
    tests: [/indices un par un/i, /plan d.indices/i],
    status: 'implemented',
  },
  {
    id: 'L10',
    name: 'Effet de génération',
    modules: ['memory'],
    interfaces: ['src/domain/memory/types.ts'],
    tests: [/une seule accroche par question/i, /280 caractères/i, /rejette un texte vide/i],
    status: 'implemented',
  },
  {
    id: 'L11',
    name: 'Effet d’auto-référence',
    modules: ['memory', 'session'],
    interfaces: ['src/domain/memory/types.ts', 'src/domain/session/types.ts'],
    tests: [/réinjecte l.accroche personnelle en indice/i],
    status: 'implemented',
  },
  {
    id: 'L12',
    name: 'Métacognition / calibration',
    modules: ['session', 'gamification'],
    interfaces: ['src/domain/shared/types.ts', 'src/domain/gamification/types.ts'],
    tests: [
      /confiance exigée avant révélation/i,
      /confiance seulement si la session l.exige/i,
      /écart moyen entre confiance et réussite/i,
    ],
    status: 'implemented',
  },
  {
    id: 'L13',
    name: 'Feedback correctif immédiat',
    modules: ['session'],
    interfaces: ['src/domain/session/types.ts'],
    tests: [
      /produit une réponse normalisée depuis la saisie/i,
      /number-confusion/i,
      /keyword-confusion/i,
      /hard est partiel/i,
    ],
    status: 'implemented',
  },
  {
    id: 'L14',
    name: 'Apprentissage de maîtrise',
    modules: ['mastery'],
    interfaces: ['src/domain/mastery/types.ts'],
    tests: [
      /verrouille l.acte suivant sous 90/i,
      /débloque l.acte suivant à 90/i,
      /l.acte I est toujours débloqué/i,
      /tout débloquer renvoie nextActToUnlock/i,
    ],
    status: 'implemented',
  },
  {
    id: 'L15',
    name: 'Sur-apprentissage / automaticité',
    modules: ['session', 'gamification'],
    interfaces: ['src/domain/session/types.ts', 'src/domain/gamification/types.ts'],
    tests: [/speed refusé avant maîtrise/i, /bonus de rapidité/i],
    status: 'implemented',
  },
  {
    id: 'L16',
    name: 'Variation contextuelle',
    modules: ['session'],
    interfaces: ['src/domain/session/types.ts'],
    tests: [/cinq directions/i, /appariement direction → indice/i, /question-to-number/i],
    status: 'implemented',
  },
  {
    id: 'L17',
    name: 'Consolidation par le sommeil',
    modules: ['session', 'gamification'],
    interfaces: ['src/domain/shared/types.ts'],
    // Les fenêtres et les quêtes soir/matin sont testées ; le calcul de la
    // fenêtre à partir de `ClockPort` relève de la Phase 3.
    tests: [/quêtes du soir et du matin/i, /fenêtres de journée aux bornes croissantes/i],
    status: 'partial',
  },
  {
    id: 'L18',
    name: 'Prétest / génération erronée',
    modules: ['session'],
    interfaces: ['src/domain/session/types.ts'],
    // Le prétest est marqué et non corrigé ; sa journalisation SRS est Phase 3.
    tests: [/marque `isPretest` en mode discovery/i, /prétest sans feedback de correction/i],
    status: 'partial',
  },
];
