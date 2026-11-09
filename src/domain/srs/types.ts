import type {
  ConfidenceRating,
  Days,
  DrillDirection,
  DurationMs,
  EpochMs,
  ExerciseKind,
  QuestionId,
  Ratio,
  ReviewGrade,
  ReviewLogId,
  SessionId,
} from '@/domain/shared/types';

/**
 * Répétition espacée par item (L2).
 *
 * Algorithme retenu : FSRS-lite à deux composantes (stabilité `stabilityDays`
 * et difficulté `difficulty`). Il est déterministe : aucun « fuzz », aucune
 * dépendance à l'horloge ou au hasard. Voir docs/ARCHITECTURE.md § SRS.
 */

/** Phase d'une carte dans le cycle d'apprentissage. */
export type CardPhase = 'new' | 'learning' | 'review' | 'relearning';

/**
 * État SRS d'une question.
 *
 * Invariants :
 * - `dueAt` est la seule source de vérité pour l'échéance ;
 * - `intervalDays >= 0`, `stabilityDays >= 0`, `difficulty ∈ [1, 10]` ;
 * - `phase === 'new'` ⇒ `reps === 0`, `lastReviewedAt === null` ;
 * - `lastGrade !== null` ⇔ `lastReviewedAt !== null` ;
 * - `learningStep` est un entier ≥ 0, borné par la longueur du palier courant.
 */
export interface CardState {
  readonly questionId: QuestionId;
  readonly phase: CardPhase;
  /** Échéance en ms epoch UTC. Une carte neuve est due immédiatement. */
  readonly dueAt: EpochMs;
  /** Intervalle courant en jours ; fractionnaire pendant l'apprentissage. */
  readonly intervalDays: Days;
  /** Stabilité mémorielle estimée, en jours. */
  readonly stabilityDays: Days;
  /**
   * Index du palier courant dans `learningStepsMinutes` (phase `learning`) ou
   * `relearningStepsMinutes` (phase `relearning`). Vaut 0 en phase `new`/`review`.
   */
  readonly learningStep: number;
  /** Difficulté intrinsèque estimée, de 1 (facile) à 10 (difficile). */
  readonly difficulty: number;
  /** Nombre total de révisions notées. */
  readonly reps: number;
  /** Nombre de chutes en réapprentissage (note `again` après graduation). */
  readonly lapses: number;
  /**
   * Réussites consécutives depuis la dernière chute.
   *
   * Compteur **de l'ordonnanceur** : une note compte dès qu'elle appartient à
   * `CORRECT_GRADES` (`hard`, `good`, `easy`) ; seule `again` remet ce compteur
   * à zéro et provoque une chute. Il ne doit pas être confondu avec la série de
   * notes **de qualité** exigée par la maîtrise (`MASTERY_QUALITY_GRADES`), que
   * l'évaluateur de maîtrise recalcule lui-même depuis les `ReviewLog` :
   * un rappel `hard` entretient la carte ici, mais ne prouve pas la maîtrise.
   */
  readonly consecutiveSuccesses: number;
  /** Dernière révision notée, ou `null` pour une carte neuve. */
  readonly lastReviewedAt: EpochMs | null;
  readonly lastGrade: ReviewGrade | null;
}

/** Réglages de l'ordonnanceur. Tous les seuils sont explicites et testables. */
export interface SchedulerConfig {
  /** Rétention visée à l'échéance (0.9 = 90 %). */
  readonly targetRetention: Ratio;
  /** Intervalle maximal en jours (garde-fou anti-« jamais revu »). */
  readonly maxIntervalDays: Days;
  /** Intervalle minimal entre deux révisions de consolidation. */
  readonly minimumReviewIntervalDays: Days;
  /** Intervalle attribué quand une carte d'apprentissage est graduée. */
  readonly graduatingIntervalDays: Days;
  /** Intervalle attribué à une carte neuve notée `easy`. */
  readonly easyIntervalDays: Days;
  /** Palier d'apprentissage en minutes (ex. [1, 10]). */
  readonly learningStepsMinutes: readonly number[];
  /** Report appliqué à la note `hard` pendant l'apprentissage, en minutes. */
  readonly hardLearningDelayMinutes: number;
  /** Palier de réapprentissage en minutes après une chute. */
  readonly relearningStepsMinutes: readonly number[];
  /**
   * Intervalle attribué à la **graduation du réapprentissage** (`good` qui
   * quitte `relearning`), en jours. Valeur courte et volontairement indépendante
   * de l'ancienne stabilité : après une chute, aucune rétention longue n'est
   * prouvée, donc la carte repart de près (1 à 2 jours) et doit regagner ses
   * intervalles par des réussites espacées. `easy` reçoit le double.
   */
  readonly relearningGraduatingIntervalDays: Days;
  /** Facteur de croissance de l'intervalle pour `hard` (≥ 1). */
  readonly hardGrowthFactor: number;
  /**
   * Plafond de l'intervalle atteignable par `hard` seul, en fraction de
   * `maxIntervalDays` (0.5 = 50 %). Empêche `hard` de dériver vers le plafond
   * global par répétition.
   */
  readonly hardIntervalCeilingRatio: Ratio;
  /** Facteur de base pour `good` (≥ 1). */
  readonly goodGrowthFactor: number;
  /** Facteur de base pour `easy` (≥ 1). */
  readonly easyGrowthFactor: number;
  /**
   * Plancher du multiplicateur de croissance lié à `difficulty`.
   *
   * Multiplicateur = interpolation linéaire entre `2 − floor` (carte facile,
   * `D = 1`) et `floor` (carte difficile, `D = 10`), valant 1 pour la difficulté
   * moyenne. `1` ⇒ la difficulté n'influe pas ; `0.5` ⇒ une carte de difficulté
   * 10 croît trois fois moins vite qu'une carte de difficulté 1.
   */
  readonly difficultyGrowthFloor: Ratio;
  /** Bonus de croissance quand la révision est en retard : `+ x * (1 - R)`. */
  readonly overdueBonus: number;
  /** Facteur appliqué à la stabilité lors d'une chute. */
  readonly lapseStabilityFactor: number;
  /** Plancher de stabilité après une chute, en jours. */
  readonly minimumStabilityDays: Days;
  /** Difficulté initiale d'une carte neuve (1..10). */
  readonly initialDifficulty: number;
  /** Variation de difficulté par note (bornée ensuite à [1, 10]). */
  readonly difficultyDelta: Readonly<Record<ReviewGrade, number>>;
  /** Rappel vers la difficulté moyenne (0 = aucun, 1 = réinitialisation). */
  readonly difficultyMeanReversion: Ratio;
}

/** Configuration par défaut, gelée par la Phase 1. */
export const DEFAULT_SCHEDULER_CONFIG = {
  targetRetention: 0.9,
  maxIntervalDays: 180,
  minimumReviewIntervalDays: 1,
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  learningStepsMinutes: [1, 10],
  hardLearningDelayMinutes: 5,
  relearningStepsMinutes: [10],
  relearningGraduatingIntervalDays: 1,
  hardGrowthFactor: 1.2,
  hardIntervalCeilingRatio: 0.5,
  goodGrowthFactor: 1.8,
  easyGrowthFactor: 2.5,
  difficultyGrowthFloor: 0.5,
  overdueBonus: 0.7,
  lapseStabilityFactor: 0.35,
  minimumStabilityDays: 0.5,
  initialDifficulty: 5,
  difficultyDelta: { again: 1, hard: 0.15, good: -0.15, easy: -0.5 },
  difficultyMeanReversion: 0.1,
} as const satisfies SchedulerConfig;

/** Six mois : au-delà, une carte est considérée comme consolidée. */
export const MAX_REVIEW_INTERVAL_DAYS = 180;

/*
 * Les seuils de « maîtrisé » ne sont PAS définis ici.
 *
 * Source unique : `DEFAULT_MASTERY_CRITERIA` dans `@/domain/mastery/types`.
 * Ce module ne connaît que l'ordonnancement par carte ; la maîtrise combine
 * l'état SRS et la couverture des directions, ce qui relève du module `mastery`.
 * Un `contracts.test` interdit toute duplication de ces seuils.
 */

/**
 * Résultat d'un ordonnancement, avant journalisation applicative.
 *
 * `retrievabilityBefore` est la probabilité de rappel estimée au moment de la
 * révision : `targetRetention ^ (elapsedDays / max(stabilityDays, ε))`, bornée à
 * [0, 1]. Elle se mesure sur la **stabilité** mémorielle, jamais sur
 * `intervalDays` : pendant `learning`/`relearning` l'intervalle n'est qu'un
 * palier de minutes et n'a aucune signification mnésique.
 */
export interface ScheduledReview {
  readonly previousCard: CardState;
  readonly nextCard: CardState;
  /** Jours écoulés depuis la dernière révision (0 pour une carte neuve). */
  readonly elapsedDays: Days;
  readonly retrievabilityBefore: Ratio;
  /** `true` si la carte quitte la phase `review` pour `relearning`. */
  readonly isLapse: boolean;
  /** `nextCard.intervalDays - previousCard.intervalDays`. */
  readonly intervalDeltaDays: Days;
}

/**
 * Contrat de l'ordonnanceur.
 *
 * Monotonie garantie pour `hard`, `good` et `easy`, quel que soit l'état
 * d'entrée (y compris importé ou corrompu) :
 * - `nextCard.dueAt > previousCard.dueAt` strictement ;
 * - `nextCard.intervalDays <= maxIntervalDays` ;
 * - `nextCard.intervalDays >= min(previousCard.intervalDays, maxIntervalDays)`,
 *   le plafond primant sur un intervalle d'entrée hors bornes.
 * Seul `again` peut ramener l'échéance à quelques minutes plus tard.
 */
export interface Scheduler {
  /** Carte neuve due immédiatement, difficulté initiale, phase `new`. */
  initialState(questionId: QuestionId, now: EpochMs): CardState;
  /** `true` si `dueAt <= now`. */
  isDue(card: CardState, now: EpochMs): boolean;
  /** Applique une note et renvoie l'état suivant, sans effet de bord. */
  schedule(card: CardState, grade: ReviewGrade, now: EpochMs): ScheduledReview;
  /** Intervalles prévisualisés pour l'UI, indexés par note. */
  previewIntervals(card: CardState, now: EpochMs): Readonly<Record<ReviewGrade, Days>>;
}

/**
 * Journal immuable d'une réponse. Une ligne par item répondu.
 *
 * `direction` et `exerciseKind` permettent de prouver la couverture des cinq
 * directions (L16) et de distinguer la production de la discrimination.
 */
export interface ReviewLog {
  readonly id: ReviewLogId;
  readonly sessionId: SessionId;
  readonly questionId: QuestionId;
  readonly direction: DrillDirection;
  readonly exerciseKind: ExerciseKind;
  readonly grade: ReviewGrade;
  readonly reviewedAt: EpochMs;
  /** Échéance avant la révision ; `null` pour une première exposition. */
  readonly previousDueAt: EpochMs | null;
  /** Nouvelle échéance calculée par l'ordonnanceur. */
  readonly nextDueAt: EpochMs;
  /** Nouvel intervalle en jours. */
  readonly intervalDays: Days;
  readonly elapsedDays: Days;
  /** Temps de réponse mesuré par la couche application, en ms. */
  readonly responseTimeMs: DurationMs;
  /** Nombre d'indices révélés avant la réponse (L9). */
  readonly hintsUsed: number;
  /** Confiance déclarée avant révélation, ou `null` si l'option est désactivée. */
  readonly confidence: ConfidenceRating | null;
}
