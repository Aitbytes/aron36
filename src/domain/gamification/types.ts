import { QUESTION_COUNT } from '@/domain/shared/types';
import type {
  ActId,
  DayKey,
  DrillDirection,
  DurationMs,
  EpochMs,
  LocalizedText,
  LocaleCode,
  QuestionId,
  Ratio,
  RandomSeed,
  ReviewGrade,
} from '@/domain/shared/types';

/**
 * Économie de jeu au service de la rétention (L8, L12, L15, L17).
 *
 * Règle cardinale : l'XP ne récompense que la production réelle. Un simple clic,
 * une révélation ou une reconnaissance ne rapportent aucun point. Les bonus de
 * session, de quête ou de badge dérivent tous d'actes de production.
 */

/** Quantité d'XP, toujours un entier ≥ 0 (arrondi inférieur). */
export type XpAmount = number;

/** Origine d'un gain d'XP. */
export type XpReason =
  | 'production-answer'
  | 'discrimination-answer'
  | 'session-complete'
  | 'perfect-session'
  | 'quest'
  | 'badge';

/** Détail auditable d'un gain d'XP. */
export interface XpBreakdown {
  /** XP de base de la direction, avant multiplicateurs. */
  readonly base: number;
  /** XP après note et facteur de discrimination. */
  readonly gradeAdjusted: number;
  readonly firstExposureBonus: number;
  readonly noHintBonus: number;
  readonly speedBonus: number;
  /** Facteur anti-farm appliqué (1, 0.5, 0.25 ou 0). */
  readonly antiFarmFactor: number;
  /** Total entier effectivement crédité. */
  readonly total: number;
}

/** Gain d'XP attribué. */
export interface XpAward {
  readonly amount: XpAmount;
  readonly reason: XpReason;
  /** `null` pour les bonus qui ne portent pas sur une question précise. */
  readonly breakdown: XpBreakdown | null;
  readonly questionId: QuestionId | null;
  readonly at: EpochMs;
}

/** Barème d'XP, versionné avec le code. */
export interface XpRules {
  /** XP de base par direction de production. */
  readonly baseByDirection: Readonly<Record<DrillDirection, number>>;
  /** Multiplicateur par note ; `again` vaut 0. */
  readonly gradeMultiplier: Readonly<Record<ReviewGrade, number>>;
  /** Un item de discrimination ne peut rapporter plus de 50 % d'une production. */
  readonly discriminationFactor: Ratio;
  /** Bonus à la première exposition réussie d'une question. */
  readonly firstExposureBonus: number;
  /** Bonus si aucun indice n'a été utilisé. */
  readonly noHintBonus: number;
  /** Bonus de rapidité, en XP, si `responseTimeMs <= speedThresholdMs`. */
  readonly speedBonus: number;
  readonly speedThresholdMs: DurationMs;
  /**
   * Facteurs anti-farm appliqués aux réponses d'une même question le même jour :
   * 1re réponse ×1, 2e ×0.5, 3e ×0.25, 4e et suivantes ×0.
   */
  readonly antiFarmFactors: readonly number[];
  /** Bonus de fin de session, quelle que soit la performance. */
  readonly sessionCompletionXp: XpAmount;
  /** Bonus de session sans aucune erreur. */
  readonly perfectSessionBonus: XpAmount;
}

/** Barème par défaut, gelé par la Phase 1. */
export const XP_RULES = {
  baseByDirection: {
    'order-to-question': 12,
    'keyword-to-question': 10,
    'image-to-question': 12,
    'number-to-question': 14,
    'question-to-number': 14,
  },
  gradeMultiplier: { again: 0, hard: 0.5, good: 1, easy: 1.25 },
  discriminationFactor: 0.5,
  firstExposureBonus: 5,
  noHintBonus: 2,
  speedBonus: 2,
  speedThresholdMs: 4000,
  antiFarmFactors: [1, 0.5, 0.25, 0],
  sessionCompletionXp: 10,
  perfectSessionBonus: 15,
} as const satisfies XpRules;

/** Courbe de niveaux : XP cumulée du niveau `L` = `baseXp × (L-1) × L`. */
export interface LevelCurve {
  /** XP cumulée du niveau `L` : `baseXp × (L - 1) × L`. */
  readonly baseXp: number;
  /** Niveau maximal ; au-delà, l'XP continue d'accumuler sans nouveau palier. */
  readonly maxLevel: number;
}

/** Courbe par défaut : 100 XP pour le niveau 2, 300 pour le 3, 600 pour le 4… */
export const LEVEL_CURVE = {
  baseXp: 50,
  maxLevel: 36,
} as const satisfies LevelCurve;

/** Niveau maximal thématique (36, comme les questions). */
export const MAX_LEVEL = LEVEL_CURVE.maxLevel;

/** Palier de titre affiché, du plus bas au plus haut. */
export interface LevelTitle {
  readonly minLevel: number;
  readonly title: LocalizedText;
}

/** Titres de niveaux (contenu de contrat, pas de logique). */
export const LEVEL_TITLES = [
  { minLevel: 1, title: { fr: 'Novice', en: 'Novice' } },
  { minLevel: 5, title: { fr: 'Apprenti', en: 'Apprentice' } },
  { minLevel: 10, title: { fr: 'Conteur', en: 'Storyteller' } },
  { minLevel: 18, title: { fr: 'Orateur', en: 'Speaker' } },
  { minLevel: 26, title: { fr: 'Mémorialiste', en: 'Memorialist' } },
  { minLevel: 36, title: { fr: 'Légende', en: 'Legend' } },
] as const satisfies readonly LevelTitle[];

/** Progression de niveau dérivée de l'XP totale. */
export interface LevelState {
  readonly level: number;
  readonly xpIntoLevel: XpAmount;
  /** `null` au niveau maximal. */
  readonly xpToNextLevel: XpAmount | null;
  /** Seuil d'XP cumulée du niveau suivant, ou `null` au niveau maximal. */
  readonly nextLevelXp: XpAmount | null;
  /** Avancement dans le niveau courant, dans [0, 1]. */
  readonly progressRatio: Ratio;
  readonly title: LocalizedText;
}

/** Barème des séries quotidiennes. */
export interface StreakRules {
  /** Nombre minimal de productions réussies pour valider une journée. */
  readonly minProductionAnswersPerDay: number;
  /** Une recharge de gel tous les N jours de série. */
  readonly freezeEarnedEveryDays: number;
  /** Nombre maximal de gels stockés. */
  readonly maxFreezes: number;
  /** Un gel couvre automatiquement une journée manquée (jamais de punition). */
  readonly autoConsumeFreeze: boolean;
}

/** Règles de série par défaut. */
export const STREAK_RULES = {
  minProductionAnswersPerDay: 1,
  freezeEarnedEveryDays: 7,
  maxFreezes: 2,
  autoConsumeFreeze: true,
} as const satisfies StreakRules;

/** État persistant de la série. */
export interface StreakState {
  /** Jours consécutifs validés (ou couverts par un gel). */
  readonly current: number;
  readonly longest: number;
  /** Dernier jour validé, ou `null` avant la première session. */
  readonly lastActiveDay: DayKey | null;
  /** Gels disponibles. */
  readonly freezes: number;
  /** Jours couverts par un gel, pour l'audit et l'affichage. */
  readonly frozenDays: readonly DayKey[];
}

/** Résultat d'une mise à jour de série. */
export interface StreakUpdate {
  readonly state: StreakState;
  /** La journée a-t-elle été validée par cette activité ? */
  readonly extended: boolean;
  /** Jours manqués couverts par un gel lors de cette mise à jour. */
  readonly frozenDays: readonly DayKey[];
  /** La série repart-elle de 1 après une interruption non couverte ? */
  readonly broken: boolean;
}

/** Métriques par direction, dérivées des journaux. */
export interface DirectionMetrics {
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: Ratio;
  readonly averageResponseTimeMs: DurationMs | null;
}

/**
 * Métriques agrégées du joueur, recalculées depuis `ReviewLog` et `SessionLog`.
 * Aucune de ces valeurs n'est persistée : elles sont dérivées.
 */
export interface PlayerMetrics {
  readonly totalAnswers: number;
  readonly productionAnswers: number;
  readonly correctProductionAnswers: number;
  readonly distinctQuestionsAnswered: number;
  readonly masteredQuestions: number;
  readonly masteredActs: number;
  /** Meilleure série jamais atteinte, en jours. */
  readonly bestStreakDays: number;
  readonly perfectSessions: number;
  readonly collectionSize: number;
  readonly personalHooks: number;
  readonly oralExamPasses: number;
  readonly eveningSessions: number;
  readonly morningSessions: number;
  /** Réponses données sans aucun indice. */
  readonly hintFreeAnswers: number;
  /** Précision des réponses sans indice, dans [0, 1]. */
  readonly hintFreeAccuracy: Ratio;
  /** Plus grand nombre de jours consécutifs sans activité. */
  readonly longestGapDays: number;
  readonly answersByDirection: Readonly<Record<DrillDirection, DirectionMetrics>>;
  /** Écart moyen |confiance/5 − réussite|, ou `null` sans donnée (L12). */
  readonly calibrationGap: Ratio | null;
}

/** Niveau de rareté d'une carte de collection. */
export type CardRarity = 'common' | 'rare' | 'epic';

/** Niveau de badge / palier de collection. */
export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'diamond';

/** Carte de collection obtenue en maîtrisant une question. */
export interface CollectionEntry {
  readonly questionId: QuestionId;
  readonly rarity: CardRarity;
  readonly obtainedAt: EpochMs;
  /** Palier de maîtrise atteint, 1..5 (5 = maîtrise complète). */
  readonly masteryTier: 1 | 2 | 3 | 4 | 5;
}

/** Collection des 36 cartes. */
export interface CollectionState {
  /** Au plus une entrée par question. */
  readonly entries: readonly CollectionEntry[];
}

/** Taille attendue de la collection. */
export const COLLECTION_SIZE = QUESTION_COUNT;

/**
 * Seuils d'intervalle (en jours) pour le palier de maîtrise d'une carte.
 * `masteryTier` = nombre de seuils atteints, borné à 1..5.
 */
export const COLLECTION_MASTERY_TIER_DAYS = [1, 7, 21, 60, 120] as const;

/** Identifiant stable d'un badge (kebab-case). */
export type BadgeId = string;

/** Métrique entière utilisable dans une condition de badge. */
export type BadgeMetric =
  | 'production-answers'
  | 'correct-production-answers'
  | 'distinct-questions'
  | 'mastered-questions'
  | 'mastered-acts'
  | 'best-streak-days'
  | 'perfect-sessions'
  | 'collection-size'
  | 'personal-hooks'
  | 'oral-exam-passes'
  | 'evening-sessions'
  | 'morning-sessions';

/**
 * Condition d'obtention d'un badge. Forme données, sérialisable et évaluable
 * sans code arbitraire.
 */
export type BadgeCondition =
  | { readonly kind: 'metric'; readonly metric: BadgeMetric; readonly target: number }
  | {
      readonly kind: 'direction-accuracy';
      readonly direction: DrillDirection;
      readonly minAccuracy: Ratio;
      readonly minAnswers: number;
    }
  | { readonly kind: 'act-mastered'; readonly actId: ActId }
  | { readonly kind: 'all-acts-mastered' }
  | { readonly kind: 'perfect-session'; readonly minItems: number }
  | {
      readonly kind: 'oral-exam';
      readonly maxDurationMs: DurationMs;
      readonly minAccuracy: Ratio;
    }
  | { readonly kind: 'calibration'; readonly maxGap: Ratio; readonly minAnswers: number }
  | { readonly kind: 'comeback'; readonly daysAway: number }
  | { readonly kind: 'direction-coverage'; readonly minDirections: number }
  | {
      readonly kind: 'hint-free';
      readonly minAnswers: number;
      readonly minAccuracy: Ratio;
    };

/** Définition d'un badge, livrée en Phase 2. */
export interface BadgeDefinition {
  readonly id: BadgeId;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly tier: BadgeTier;
  readonly condition: BadgeCondition;
  readonly xpReward: XpAmount;
  /** Badge masqué jusqu'à obtention (indice narratif, pas de rareté artificielle). */
  readonly secret: boolean;
}

/** État d'un badge pour un joueur. */
export interface BadgeState {
  readonly badgeId: BadgeId;
  readonly unlockedAt: EpochMs | null;
  /** Progression courante vers la cible, bornée à `target`. */
  readonly progress: number;
  readonly target: number;
}

/** Évaluateur pur de badges. */
export interface BadgeEvaluator {
  evaluate(
    definitions: readonly BadgeDefinition[],
    metrics: PlayerMetrics,
    existing: readonly BadgeState[],
    now: EpochMs,
  ): readonly BadgeState[];
}

/** Identifiant stable d'une quête (kebab-case). */
export type QuestId = string;

/** Objectif d'une quête quotidienne. */
export type QuestObjective =
  | {
      readonly kind: 'answer-count';
      readonly min: number;
      readonly direction: DrillDirection | null;
      readonly productionOnly: boolean;
    }
  | {
      readonly kind: 'accuracy';
      readonly minAccuracy: Ratio;
      readonly minAnswers: number;
      readonly direction: DrillDirection | null;
    }
  | { readonly kind: 'distinct-questions'; readonly min: number }
  | { readonly kind: 'new-cards'; readonly min: number }
  | { readonly kind: 'hint-free'; readonly min: number; readonly minAccuracy: Ratio }
  | { readonly kind: 'speed'; readonly maxResponseTimeMs: DurationMs; readonly min: number }
  | { readonly kind: 'act-recall'; readonly actId: ActId }
  | { readonly kind: 'calibration'; readonly maxGap: Ratio; readonly minAnswers: number }
  | { readonly kind: 'evening-review'; readonly min: number }
  | { readonly kind: 'morning-review'; readonly min: number };

/** Définition d'une quête, livrée en Phase 2. */
export interface QuestDefinition {
  readonly id: QuestId;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly objective: QuestObjective;
  readonly xpReward: XpAmount;
}

/** État d'une quête proposée un jour donné. */
export interface QuestState {
  readonly questId: QuestId;
  readonly dayKey: DayKey;
  readonly progress: number;
  readonly target: number;
  readonly completedAt: EpochMs | null;
}

/** Tableau des quêtes du jour (3 quêtes, tirage déterministe depuis `seed`). */
export interface QuestBoard {
  readonly dayKey: DayKey;
  readonly seed: RandomSeed;
  readonly quests: readonly QuestState[];
  /** Un seul reroll autorisé par jour, sans pénalité. */
  readonly rerollUsed: boolean;
}

/** Nombre de quêtes quotidiennes. */
export const DAILY_QUEST_COUNT = 3;

/** Préférences persistantes du joueur. */
export interface PlayerSettings {
  readonly locale: LocaleCode;
  /** Synthèse vocale activée (L8) ; aucune donnée n'est envoyée. */
  readonly speechEnabled: boolean;
  readonly reducedMotion: 'system' | 'reduce' | 'no-preference';
  /** Objectif quotidien affiché, en minutes (L3). */
  readonly dailyGoalMinutes: 10 | 15 | 20 | 25;
  /** Demande un jugement de confiance avant révélation (L12). */
  readonly confidencePromptEnabled: boolean;
}

/** Profil local, sans compte serveur. */
export interface PlayerProfile {
  /** Identifiant local généré une fois, jamais transmis. */
  readonly id: string;
  readonly displayName: string;
  readonly createdAt: EpochMs;
}

/** État persistant complet du joueur. */
export interface PlayerState {
  readonly profile: PlayerProfile;
  readonly totalXp: XpAmount;
  readonly streak: StreakState;
  readonly badges: readonly BadgeState[];
  readonly questBoard: QuestBoard | null;
  readonly collection: CollectionState;
  readonly settings: PlayerSettings;
}

/** Vue dérivée prête pour l'UI (niveau, métriques, collection complétée). */
export interface PlayerProgressView {
  readonly level: LevelState;
  readonly metrics: PlayerMetrics;
  readonly collection: CollectionState;
  readonly streak: StreakState;
  readonly badges: readonly BadgeState[];
  readonly dailyQuests: QuestBoard | null;
}
