import type {
  ActId,
  ConfidenceRating,
  DurationMs,
  EpochMs,
  QuestionId,
  RandomSeed,
  ReviewGrade,
  SessionId,
  SessionWindow,
} from '@/domain/shared/types';
import type { BadgeId, XpAward } from '@/domain/gamification/types';
import type { PersonalHook, PersonalHookKind } from '@/domain/memory/types';
import type { MasteryCriteria, MasterySnapshot } from '@/domain/mastery/types';
import type {
  PersistedProgress,
  ProgressError,
  ProgressImportResult,
} from '@/domain/progress/types';
import type { QuestionCatalog } from '@/domain/questions/types';
import type {
  AnswerChannel,
  AnswerFeedback,
  SessionAnswer,
  SessionMode,
  SessionPlan,
  SessionState,
  SessionSummary,
} from '@/domain/session/types';
import type { ScheduledReview, Scheduler, SchedulerConfig } from '@/domain/srs/types';
import type { ClockPort } from '@/application/ports/ClockPort';
import type { IdPort } from '@/application/ports/IdPort';
import type { RandomPort } from '@/application/ports/RandomPort';
import type { SpeechPort } from '@/application/ports/SpeechPort';
import type { StoragePort } from '@/application/ports/StoragePort';

/**
 * Cas d'usage (Phase 3).
 *
 * Chaque cas d'usage est synchrone, reçoit ses dépendances via `AppServices` et
 * renvoie un résultat explicite. Il ne touche jamais React ni le DOM.
 */

/** Dépendances injectées dans tous les cas d'usage. */
export interface AppServices {
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  readonly speech: SpeechPort;
  /**
   * Fabrique d'identifiants opaques. Le domaine étant pur, un cas d'usage doit
   * appeler `ids.newSessionId()` et le transmettre dans `SessionRequest.sessionId`
   * (le constructeur de plan ne génère jamais d'identifiant lui-même).
   */
  readonly ids: IdPort;
  readonly catalog: QuestionCatalog;
  readonly scheduler: Scheduler;
  readonly schedulerConfig: SchedulerConfig;
  readonly masteryCriteria: MasteryCriteria;
  /** Fabrique un générateur reproductible à partir d'une graine. */
  createRandom(seed: RandomSeed): RandomPort;
  /**
   * Produit une graine opaque (UUID en production, compteur en test).
   * Seule cette fabrique a le droit d'utiliser `crypto`.
   */
  newSeed(): RandomSeed;
}

/** Entrée de démarrage de session ; la graine et l'horloge sont fournies par le cas d'usage. */
export interface StartSessionInput {
  readonly mode: SessionMode;
  readonly actIds?: readonly ActId[];
  readonly questionIds?: readonly QuestionId[];
  readonly maxItems?: number;
  readonly maxDurationMs?: DurationMs;
}

/** Sortie de démarrage de session. */
export interface StartSessionOutput {
  readonly plan: SessionPlan;
  readonly state: SessionState;
}

/** Entrée de soumission d'une réponse. */
export interface SubmitAnswerInput {
  readonly sessionId: SessionId;
  readonly itemId: string;
  readonly grade: ReviewGrade;
  /** Vocabulaire partagé, jamais redéclaré (voir `ConfidenceRating`). */
  readonly confidence: ConfidenceRating | null;
  readonly responseTimeMs: DurationMs;
  readonly hintsUsed: number;
  readonly channel: AnswerChannel;
}

/** Sortie de soumission : tout ce que l'UI et la persistance doivent connaître. */
export interface SubmitAnswerOutput {
  readonly session: SessionState;
  readonly answer: SessionAnswer;
  readonly feedback: AnswerFeedback;
  /** `null` pour un exercice de discrimination ou une première exposition. */
  readonly scheduledReview: ScheduledReview | null;
  readonly xp: XpAward;
  readonly newlyUnlockedBadges: readonly BadgeId[];
  readonly updatedProgress: PersistedProgress;
  /** Non `null` si la réponse terminait la session. */
  readonly summary: SessionSummary | null;
  /**
   * Échec de la sauvegarde de cette réponse, ou `null` en cas de succès
   * (ARCHITECTURE § 5.4). Jamais lancé : en cas d'échec (quota, mode privé),
   * le résultat est renvoyé normalement et l'état en mémoire du dépôt reste
   * la référence — l'UI affiche un avertissement non bloquant et propose
   * l'export.
   */
  readonly writeFailure: ProgressError | null;
}

/**
 * Entrée de fin de session (abandon ou clôture explicite).
 *
 * `now` et `window` sont fournis par la couche application : le domaine n'a
 * aucune source de temps, et `SessionLog.window` (L17) doit être calculé depuis
 * l'heure **locale** (`ClockPort.dayKey` / fuseau), pas depuis le domaine.
 */
export interface FinishSessionInput {
  readonly sessionId: SessionId;
  /** Instant de clôture, fourni par `ClockPort.now()`. */
  readonly now: EpochMs;
  /** Fenêtre de journée de la session, calculée depuis l'heure locale. */
  readonly window: SessionWindow;
}

/** Sortie de fin de session. */
export interface FinishSessionOutput {
  readonly summary: SessionSummary;
  readonly xp: XpAward;
  readonly updatedProgress: PersistedProgress;
  /** Échec de la sauvegarde de clôture, ou `null` (jamais lancé — § 5.4). */
  readonly writeFailure: ProgressError | null;
}

/** Entrée d'enregistrement d'une accroche personnelle (L10, L11). */
export interface SaveHookInput {
  readonly questionId: QuestionId;
  readonly kind: PersonalHookKind;
  readonly text: string;
}

/** Sortie d'enregistrement d'une accroche. */
export interface SaveHookOutput {
  readonly hook: PersonalHook;
  readonly updatedProgress: PersistedProgress;
  /** Échec de la sauvegarde de l'accroche, ou `null` (jamais lancé — § 5.4). */
  readonly writeFailure: ProgressError | null;
}

/** Entrée d'import de progression. */
export interface ImportProgressInput {
  readonly raw: string;
}

/** Sortie d'import, alignée sur le décodeur de progression. */
export type ImportProgressOutput = ProgressImportResult;

/** Sortie d'export : nom de fichier proposé et contenu JSON. */
export interface ExportProgressOutput {
  readonly filename: string;
  readonly json: string;
}

/** Sortie de réinitialisation (double confirmation côté UI). */
export interface ResetProgressOutput {
  readonly progress: PersistedProgress;
  /** Échec de l'écriture du profil neuf, ou `null` (jamais lancé — § 5.4). */
  readonly writeFailure: ProgressError | null;
}

/** Évaluation de maîtrise exposée à l'UI. */
export interface EvaluateMasteryOutput {
  readonly mastery: MasterySnapshot;
}

/** Contrat d'un cas d'usage synchrone. */
export interface UseCase<Input, Output> {
  execute(input: Input): Output;
}

/** Surface applicative consommée par l'UI (Phase 4). */
export interface UseCases {
  readonly startSession: UseCase<StartSessionInput, StartSessionOutput>;
  readonly submitAnswer: UseCase<SubmitAnswerInput, SubmitAnswerOutput>;
  readonly finishSession: UseCase<FinishSessionInput, FinishSessionOutput>;
  readonly saveHook: UseCase<SaveHookInput, SaveHookOutput>;
  readonly importProgress: UseCase<ImportProgressInput, ImportProgressOutput>;
  readonly exportProgress: UseCase<void, ExportProgressOutput>;
  readonly resetProgress: UseCase<void, ResetProgressOutput>;
  readonly evaluateMastery: UseCase<void, EvaluateMasteryOutput>;
}
