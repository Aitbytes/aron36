import type { ActId, DrillDirection, EpochMs, QuestionId, Ratio } from '@/domain/shared/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';

/**
 * Maîtrise par acte (L5, L14).
 *
 * Un acte n'est « maîtrisé » que si ses 12 questions sont maîtrisées, chacune
 * ayant été produite dans plusieurs directions. Un acte ne se débloque qu'après
 * le seuil de maîtrise de l'acte précédent.
 */

/** Critères de maîtrise, explicites et testables. */
export interface MasteryCriteria {
  /** Intervalle SRS minimal d'une carte maîtrisée, en jours. */
  readonly minIntervalDays: number;
  /** Réussites consécutives minimales sur la carte. */
  readonly minConsecutiveSuccesses: number;
  /** Nombre minimal de révisions notées. */
  readonly minReps: number;
  /** Nombre de directions distinctes où la question a été produite. */
  readonly minDistinctDirections: number;
  /** Précision minimale par direction couverte. */
  readonly minDirectionAccuracy: Ratio;
  /** Nombre minimal de tentatives par direction pour qu'elle compte. */
  readonly minDirectionAttempts: number;
  /** Ratio de questions maîtrisées requis pour débloquer l'acte suivant. */
  readonly actUnlockRatio: Ratio;
}

/** Critères par défaut, gelés par la Phase 1. */
export const DEFAULT_MASTERY_CRITERIA = {
  minIntervalDays: 21,
  minConsecutiveSuccesses: 2,
  minReps: 3,
  minDistinctDirections: 3,
  minDirectionAccuracy: 0.8,
  minDirectionAttempts: 2,
  actUnlockRatio: 0.9,
} as const satisfies MasteryCriteria;

/** Performance observée dans une direction de drill. */
export interface DirectionMastery {
  readonly direction: DrillDirection;
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: Ratio;
  /** `attempts >= minDirectionAttempts && accuracy >= minDirectionAccuracy`. */
  readonly meetsAccuracy: boolean;
}

/** Maîtrise d'une question. */
export interface QuestionMastery {
  readonly questionId: QuestionId;
  /** Critère SRS : intervalle, réussites consécutives et nombre de révisions. */
  readonly cardMastered: boolean;
  readonly directions: readonly DirectionMastery[];
  /** Nombre de directions ayant atteint le seuil de précision. */
  readonly distinctDirections: number;
  /** `cardMastered && distinctDirections >= minDistinctDirections`. */
  readonly mastered: boolean;
}

/** Maîtrise d'un acte. */
export interface ActMastery {
  readonly actId: ActId;
  readonly questionCount: number;
  readonly masteredCount: number;
  /** `masteredCount / questionCount`, dans [0, 1]. */
  readonly ratio: Ratio;
  /** L'acte est-il accessible ? L'acte I l'est toujours. */
  readonly unlocked: boolean;
  readonly questions: readonly QuestionMastery[];
}

/** Photographie complète de la maîtrise, recalculable à partir des journaux. */
export interface MasterySnapshot {
  readonly acts: readonly ActMastery[];
  readonly totalMastered: number;
  readonly overallRatio: Ratio;
  /** Prochain acte à débloquer, ou `null` si tout est débloqué. */
  readonly nextActToUnlock: ActId | null;
  readonly computedAt: EpochMs;
}

/** Entrées du calcul : aucune I/O, uniquement des états purs. */
export interface MasteryInput {
  readonly cards: readonly CardState[];
  readonly reviewLogs: readonly ReviewLog[];
  /** Nombre total de questions par acte (attendu : 12). */
  readonly questionsPerAct: number;
  /** Horloge injectée, recopiée dans `MasterySnapshot.computedAt`. */
  readonly now: EpochMs;
}

/** Évaluateur pur de maîtrise. */
export interface MasteryEvaluator {
  evaluate(input: MasteryInput, criteria: MasteryCriteria): MasterySnapshot;
}
