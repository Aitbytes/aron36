import { ACT_COUNT, DRILL_DIRECTIONS, MINUTE_MS } from '@/domain/shared/types';
import type { EpochMs } from '@/domain/shared/types';
import type {
  BadgeCondition,
  BadgeDefinition,
  BadgeEvaluator,
  BadgeMetric,
  BadgeState,
  PlayerMetrics,
} from './types';

/**
 * Catalogue de badges et évaluateur pur (L8, L12, L14, L15, L17).
 *
 * Anti-objectifs servis par ce module :
 * - **pas de rareté artificielle** : chaque badge a une condition atteignable,
 *   testée ; `secret` ne fait que retarder l'affichage d'un indice narratif ;
 * - **pas de punition** : un badge est acquis définitivement, `unlockedAt` n'est
 *   jamais remis à `null` (évaluation idempotente) ;
 * - **pas de récompense sans production** : toutes les conditions dérivent de
 *   productions réelles ou de la maîtrise, jamais d'un simple clic.
 *
 * Le catalogue reprend **exactement** les identifiants et conditions du contrat
 * (`docs/ARCHITECTURE.md` § 8.4) : 19 badges, bronze/silver/gold/diamond.
 */

/** Six minutes : durée maximale du Grand Oral (L15). */
const ORAL_EXAM_MAX_DURATION_MS = 6 * MINUTE_MS;

/**
 * Catalogue livré en Phase 2.
 *
 * `secret: true` uniquement pour `retour` : l'indice narratif « reviens après
 * une pause » n'a de sens qu'à l'obtention.
 */
export const BADGE_DEFINITIONS: readonly BadgeDefinition[] = [
  {
    id: 'premier-pas',
    name: { fr: 'Premier pas', en: 'First step' },
    description: {
      fr: 'Produire une première réponse notée.',
      en: 'Produce a first graded answer.',
    },
    tier: 'bronze',
    condition: { kind: 'metric', metric: 'production-answers', target: 1 },
    xpReward: 10,
    secret: false,
  },
  {
    id: 'diner',
    name: { fr: 'Le dîner', en: 'The dinner' },
    description: {
      fr: 'Maîtriser les 12 questions de l’acte I.',
      en: 'Master the 12 questions of act I.',
    },
    tier: 'bronze',
    condition: { kind: 'act-mastered', actId: 1 },
    xpReward: 30,
    secret: false,
  },
  {
    id: 'boule-de-cristal',
    name: { fr: 'Boule de cristal', en: 'Crystal ball' },
    description: {
      fr: 'Maîtriser les 12 questions de l’acte II.',
      en: 'Master the 12 questions of act II.',
    },
    tier: 'silver',
    condition: { kind: 'act-mastered', actId: 2 },
    xpReward: 50,
    secret: false,
  },
  {
    id: 'incendie',
    name: { fr: 'L’incendie', en: 'The fire' },
    description: {
      fr: 'Maîtriser les 12 questions de l’acte III.',
      en: 'Master the 12 questions of act III.',
    },
    tier: 'gold',
    condition: { kind: 'act-mastered', actId: 3 },
    xpReward: 80,
    secret: false,
  },
  {
    id: 'recitation-parfaite',
    name: { fr: 'Récitation parfaite', en: 'Perfect recitation' },
    description: {
      fr: 'Terminer une session de 12 items sans aucune erreur.',
      en: 'Finish a 12-item session with no mistake.',
    },
    tier: 'silver',
    condition: { kind: 'perfect-session', minItems: 12 },
    xpReward: 40,
    secret: false,
  },
  {
    id: 'mot-cle-impeccable',
    name: { fr: 'Mot-clé impeccable', en: 'Flawless keyword' },
    description: {
      fr: '90 % de réussite sur 20 réponses mot-clé → question.',
      en: '90 % success on 20 keyword → question answers.',
    },
    tier: 'silver',
    condition: {
      kind: 'direction-accuracy',
      direction: 'keyword-to-question',
      minAccuracy: 0.9,
      minAnswers: 20,
    },
    xpReward: 40,
    secret: false,
  },
  {
    id: 'image-impeccable',
    name: { fr: 'Image impeccable', en: 'Flawless image' },
    description: {
      fr: '90 % de réussite sur 20 réponses image → question.',
      en: '90 % success on 20 image → question answers.',
    },
    tier: 'silver',
    condition: {
      kind: 'direction-accuracy',
      direction: 'image-to-question',
      minAccuracy: 0.9,
      minAnswers: 20,
    },
    xpReward: 40,
    secret: false,
  },
  {
    id: 'numero-impeccable',
    name: { fr: 'Numéro impeccable', en: 'Flawless number' },
    description: {
      fr: '90 % de réussite sur 20 réponses numéro → question.',
      en: '90 % success on 20 number → question answers.',
    },
    tier: 'gold',
    condition: {
      kind: 'direction-accuracy',
      direction: 'number-to-question',
      minAccuracy: 0.9,
      minAnswers: 20,
    },
    xpReward: 60,
    secret: false,
  },
  {
    id: 'sens-inverse',
    name: { fr: 'Sens inverse', en: 'Reverse order' },
    description: {
      fr: '90 % de réussite sur 20 réponses question → numéro.',
      en: '90 % success on 20 question → number answers.',
    },
    tier: 'gold',
    condition: {
      kind: 'direction-accuracy',
      direction: 'question-to-number',
      minAccuracy: 0.9,
      minAnswers: 20,
    },
    xpReward: 60,
    secret: false,
  },
  {
    id: 'ordre-sans-faute',
    name: { fr: 'Ordre sans faute', en: 'Flawless order' },
    description: {
      fr: '90 % de réussite sur 20 réponses ordre → question.',
      en: '90 % success on 20 order → question answers.',
    },
    tier: 'silver',
    condition: {
      kind: 'direction-accuracy',
      direction: 'order-to-question',
      minAccuracy: 0.9,
      minAnswers: 20,
    },
    xpReward: 40,
    secret: false,
  },
  {
    id: 'serie-7',
    name: { fr: 'Sept jours', en: 'Seven days' },
    description: { fr: 'Tenir une série de 7 jours.', en: 'Hold a 7-day streak.' },
    tier: 'bronze',
    condition: { kind: 'metric', metric: 'best-streak-days', target: 7 },
    xpReward: 30,
    secret: false,
  },
  {
    id: 'serie-30',
    name: { fr: 'Trente jours', en: 'Thirty days' },
    description: { fr: 'Tenir une série de 30 jours.', en: 'Hold a 30-day streak.' },
    tier: 'gold',
    condition: { kind: 'metric', metric: 'best-streak-days', target: 30 },
    xpReward: 100,
    secret: false,
  },
  {
    id: 'collection-36',
    name: { fr: 'Collection complète', en: 'Full collection' },
    description: { fr: 'Réunir les 36 cartes.', en: 'Gather all 36 cards.' },
    tier: 'diamond',
    condition: { kind: 'metric', metric: 'collection-size', target: 36 },
    xpReward: 150,
    secret: false,
  },
  {
    id: 'plume-personnelle',
    name: { fr: 'Plume personnelle', en: 'Personal pen' },
    description: { fr: 'Écrire 12 accroches personnelles.', en: 'Write 12 personal hooks.' },
    tier: 'silver',
    condition: { kind: 'metric', metric: 'personal-hooks', target: 12 },
    xpReward: 40,
    secret: false,
  },
  {
    id: 'oral-6-minutes',
    name: { fr: 'Grand Oral', en: 'Grand Oral' },
    description: {
      fr: 'Réciter les 36 questions à l’oral en 6 minutes, 90 % de réussite.',
      en: 'Recite all 36 questions aloud in 6 minutes with 90 % success.',
    },
    tier: 'diamond',
    condition: { kind: 'oral-exam', maxDurationMs: ORAL_EXAM_MAX_DURATION_MS, minAccuracy: 0.9 },
    xpReward: 120,
    secret: false,
  },
  {
    id: 'calibration',
    name: { fr: 'Calibration', en: 'Calibration' },
    description: {
      fr: 'Écart confiance/réussite ≤ 0.1 sur 50 réponses.',
      en: 'Confidence/success gap ≤ 0.1 over 50 answers.',
    },
    tier: 'gold',
    condition: { kind: 'calibration', maxGap: 0.1, minAnswers: 50 },
    xpReward: 60,
    secret: false,
  },
  {
    id: 'sans-filet',
    name: { fr: 'Sans filet', en: 'Without a net' },
    description: {
      fr: '30 réponses sans indice, 90 % de réussite.',
      en: '30 hint-free answers with 90 % success.',
    },
    tier: 'gold',
    condition: { kind: 'hint-free', minAnswers: 30, minAccuracy: 0.9 },
    xpReward: 60,
    secret: false,
  },
  {
    id: 'retour',
    name: { fr: 'Retour', en: 'Comeback' },
    description: {
      fr: 'Revenir après au moins 7 jours d’absence.',
      en: 'Come back after at least 7 days away.',
    },
    tier: 'bronze',
    condition: { kind: 'comeback', daysAway: 7 },
    xpReward: 30,
    secret: true,
  },
  {
    id: 'couverture',
    name: { fr: 'Couverture', en: 'Coverage' },
    description: {
      fr: 'Avoir travaillé les 5 directions de drill.',
      en: 'Have worked all 5 drill directions.',
    },
    tier: 'gold',
    condition: { kind: 'direction-coverage', minDirections: DRILL_DIRECTIONS.length },
    xpReward: 60,
    secret: false,
  },
];

/** Valeur d'une métrique entière du catalogue. */
export function metricValue(metrics: PlayerMetrics, metric: BadgeMetric): number {
  switch (metric) {
    case 'production-answers':
      return metrics.productionAnswers;
    case 'correct-production-answers':
      return metrics.correctProductionAnswers;
    case 'distinct-questions':
      return metrics.distinctQuestionsAnswered;
    case 'mastered-questions':
      return metrics.masteredQuestions;
    case 'mastered-acts':
      return metrics.masteredActs;
    case 'best-streak-days':
      return metrics.bestStreakDays;
    case 'perfect-sessions':
      return metrics.perfectSessions;
    case 'collection-size':
      return metrics.collectionSize;
    case 'personal-hooks':
      return metrics.personalHooks;
    case 'oral-exam-passes':
      return metrics.oralExamPasses;
    case 'evening-sessions':
      return metrics.eveningSessions;
    case 'morning-sessions':
      return metrics.morningSessions;
  }
}

/** Nombre de directions de drill déjà travaillées. */
function coveredDirections(metrics: PlayerMetrics): number {
  return DRILL_DIRECTIONS.filter((direction) => metrics.answersByDirection[direction].attempts > 0)
    .length;
}

/**
 * Progression (`progress`, `target`) vers une condition.
 *
 * `PlayerMetrics` ne porte pas toutes les informations de chaque condition ; les
 * cas concernés sont documentés sur place et signalés comme points à arbitrer
 * dans le rapport de lot.
 */
export function conditionProgress(
  condition: BadgeCondition,
  metrics: PlayerMetrics,
): { progress: number; target: number } {
  switch (condition.kind) {
    case 'metric': {
      const target = condition.target;
      return { progress: Math.min(metricValue(metrics, condition.metric), target), target };
    }
    case 'direction-accuracy': {
      const direction = metrics.answersByDirection[condition.direction];
      const target = condition.minAnswers;
      const qualifying = direction.accuracy >= condition.minAccuracy ? direction.attempts : 0;
      return { progress: Math.min(qualifying, target), target };
    }
    case 'act-mastered': {
      // Les actes se débloquent dans l'ordre (L14) : `masteredActs >= actId`
      // vaut « les actes 1..actId sont maîtrisés ».
      const target = condition.actId;
      return { progress: Math.min(metrics.masteredActs, target), target };
    }
    case 'all-acts-mastered': {
      const target = ACT_COUNT;
      return { progress: Math.min(metrics.masteredActs, target), target };
    }
    case 'perfect-session':
      // `PlayerMetrics.perfectSessions` ne conserve pas la taille des sessions :
      // `minItems` n'est pas vérifiable, seule l'existence d'une session parfaite
      // (≥ `PERFECT_SESSION_MIN_ITEMS` items) l'est.
      return { progress: Math.min(metrics.perfectSessions, 1), target: 1 };
    case 'oral-exam':
      // `oralExamPasses` ne conserve ni durée ni précision : seul le nombre de
      // Grands Oraux réussis est disponible.
      return { progress: Math.min(metrics.oralExamPasses, 1), target: 1 };
    case 'calibration': {
      const gap = metrics.calibrationGap;
      const aligned = gap !== null && gap <= condition.maxGap;
      // `PlayerMetrics` ne porte pas le nombre de réponses avec confiance :
      // `minAnswers` n'est pas vérifiable.
      return { progress: aligned ? 1 : 0, target: 1 };
    }
    case 'comeback': {
      const target = condition.daysAway;
      return { progress: Math.min(metrics.longestGapDays, target), target };
    }
    case 'direction-coverage': {
      const target = condition.minDirections;
      return { progress: Math.min(coveredDirections(metrics), target), target };
    }
    case 'hint-free': {
      const target = condition.minAnswers;
      const qualifying =
        metrics.hintFreeAccuracy >= condition.minAccuracy ? metrics.hintFreeAnswers : 0;
      return { progress: Math.min(qualifying, target), target };
    }
  }
}

/**
 * Évalue tous les badges, sans effet de bord.
 *
 * `unlockedAt` n'est écrit qu'une fois : si un état existant porte déjà une date,
 * elle est conservée telle quelle (acquisition définitive, aucune punition).
 */
function evaluate(
  definitions: readonly BadgeDefinition[],
  metrics: PlayerMetrics,
  existing: readonly BadgeState[],
  now: EpochMs,
): readonly BadgeState[] {
  const existingById = new Map(existing.map((state) => [state.badgeId, state] as const));

  return definitions.map((definition) => {
    const { progress, target } = conditionProgress(definition.condition, metrics);
    const unlockedAt =
      existingById.get(definition.id)?.unlockedAt ?? (progress >= target ? now : null);
    return { badgeId: definition.id, unlockedAt, progress, target };
  });
}

/** Évaluateur de badges pur : mêmes entrées, mêmes sorties. */
export const badgeEvaluator: BadgeEvaluator = { evaluate };
