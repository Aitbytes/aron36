import type {
  ActId,
  ConfidenceRating,
  DrillDirection,
  DurationMs,
  EpochMs,
  ExerciseKind,
  LocalizedText,
  PositionInAct,
  QuestionId,
  RandomSeed,
  Ratio,
  ReviewGrade,
  SessionId,
} from '@/domain/shared/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';
import type { QuestionCatalog } from '@/domain/questions/types';
import type { PersonalHook } from '@/domain/memory/types';

/**
 * Moteur de session (L1, L3, L4, L5, L9, L12, L16, L18).
 *
 * Une session est toujours une production active : l'apprenant voit un indice
 * (mot-clé, image, numéro, rang) et doit restituer la question. Le QCM de
 * discrimination existe, mais reste minoritaire, étiqueté et plafonné.
 */

/** Mode d'une session ; chacun a un objectif pédagogique distinct. */
export type SessionMode =
  'discovery' | 'learning' | 'review' | 'recitation' | 'speed' | 'grand-oral';

/** Politique d'indices (L9). */
export type HintPolicy =
  /** Indices disponibles un par un, à la demande (défaut). */
  | 'on-demand'
  /** Indices révélés automatiquement après un délai ou un échec. */
  | 'progressive'
  /** Aucun indice : difficulté maximale, réservé aux tests. */
  | 'disabled';

/** Politique d'entrelacement (L4). */
export type InterleavingPolicy =
  /** Alterne actes et directions ; interdit les blocs. */
  | 'acts-and-directions'
  /** Mélange les directions à l'intérieur d'un acte (apprentissage). */
  | 'directions'
  /** Ordre bloqué par acte (réservé à la découverte d'un nouvel acte). */
  | 'blocked';

/**
 * Type d'indice, du plus faible au plus fort.
 * `personal-hook` réinjecte l'accroche écrite par l'apprenant (L10, L11).
 */
export type HintKind =
  'initials' | 'first-words' | 'keyword' | 'mental-image' | 'personal-hook' | 'full-answer';

/** Indice pré-calculé ; le contenu est localisé et immuable. */
export interface Hint {
  readonly kind: HintKind;
  readonly content: LocalizedText;
}

/**
 * Indice de départ présenté à l'apprenant.
 *
 * Le mapping direction → indice est fixe :
 * - `order-to-question` → `order` ;
 * - `keyword-to-question` → `keyword` ;
 * - `image-to-question` → `image` ;
 * - `number-to-question` → `number` ;
 * - `question-to-number` → `question`.
 */
export type SessionCue =
  | { readonly kind: 'order'; readonly actId: ActId; readonly positionInAct: PositionInAct }
  | { readonly kind: 'keyword'; readonly text: LocalizedText }
  | { readonly kind: 'image'; readonly text: LocalizedText }
  | { readonly kind: 'number'; readonly questionNumber: QuestionId }
  | { readonly kind: 'question'; readonly text: LocalizedText };

/** Réponse attendue : texte de la question, ou numéro global. */
export type ExpectedAnswer =
  | { readonly kind: 'question'; readonly text: LocalizedText }
  | { readonly kind: 'number'; readonly questionNumber: QuestionId };

/** Option d'un exercice de discrimination (QCM étiqueté). */
export interface DiscriminationOption {
  readonly id: string;
  readonly questionId: QuestionId;
  readonly label: LocalizedText;
}

interface SessionItemBase {
  /** Identifiant stable dans la session, `${sessionId}:${index}`. */
  readonly id: string;
  readonly questionId: QuestionId;
  readonly actId: ActId;
  readonly direction: DrillDirection;
  readonly cue: SessionCue;
  readonly expectedAnswer: ExpectedAnswer;
  /** Image mentale de la réponse, utilisée par le feedback (L13). */
  readonly mentalImage: LocalizedText;
  /** Indices ordonnés du plus faible au plus fort, jamais vides. */
  readonly hints: readonly Hint[];
  /**
   * Item de prétest (L18) : l'apprenant devine avant toute révélation.
   * La devinette n'est ni notée ni journalisée ; seule la tentative graduée
   * qui suit compte pour le SRS.
   */
  readonly isPretest: boolean;
}

/** Item de production : aucune option proposée. */
export interface ProductionSessionItem extends SessionItemBase {
  readonly exerciseKind: Extract<ExerciseKind, 'production'>;
}

/** Item de discrimination : QCM explicitement étiqueté, jamais majoritaire. */
export interface DiscriminationSessionItem extends SessionItemBase {
  readonly exerciseKind: Extract<ExerciseKind, 'discrimination'>;
  /** Exactement 4 options, dont une seule correcte. */
  readonly options: readonly DiscriminationOption[];
  readonly correctOptionId: string;
}

/** Item de session, discriminé par `exerciseKind`. */
export type SessionItem = ProductionSessionItem | DiscriminationSessionItem;

/** Limites de pacing par défaut (L3), surchargées par la requête. */
export const DEFAULT_SESSION_LIMITS = {
  maxItems: 20,
  maxDurationMs: 15 * 60 * 1000,
  productionItemMs: 30_000,
  discriminationItemMs: 15_000,
  maxDiscriminationRatio: 0.2,
} as const;

/** Configuration effective d'une session, enregistrée avec le plan. */
export interface SessionConfig {
  readonly mode: SessionMode;
  /** Nombre maximal d'items (L3). */
  readonly maxItems: number;
  /** Durée cible maximale, en ms (L3). */
  readonly maxDurationMs: DurationMs;
  /** Directions autorisées ; au moins une. */
  readonly directions: readonly DrillDirection[];
  readonly interleaving: InterleavingPolicy;
  readonly hintPolicy: HintPolicy;
  /** Part maximale d'items de discrimination, bornée à 0.2. */
  readonly maxDiscriminationRatio: Ratio;
  /** Exige un jugement de confiance avant révélation (L12). */
  readonly requiresConfidence: boolean;
  /** Cible de temps de réponse pour le mode `speed` (L15), sinon `null`. */
  readonly speedTargetMs: DurationMs | null;
}

/** Demande de construction, fournie par la couche application. */
export interface SessionRequest {
  readonly mode: SessionMode;
  /** Restreint la sélection à ces actes ; absent = tous les actes débloqués. */
  readonly actIds?: readonly ActId[];
  /** Restreint la sélection à ces questions ; absent = tout l'acte. */
  readonly questionIds?: readonly QuestionId[];
  /** Graine enregistrée dans le plan pour rendre le tirage reproductible. */
  readonly seed: RandomSeed;
  /** Horloge injectée, en ms epoch. */
  readonly now: EpochMs;
  readonly maxItems?: number;
  readonly maxDurationMs?: DurationMs;
  readonly directions?: readonly DrillDirection[];
}

/** Dépendances pures nécessaires à la construction d'un plan. */
export interface SessionBuildContext {
  readonly catalog: QuestionCatalog;
  /** Cartes SRS connues, indexées par identifiant de question. */
  readonly cards: ReadonlyMap<QuestionId, CardState>;
  /** Accroches personnelles, réinjectées dans les drills (L11). */
  readonly hooks: readonly PersonalHook[];
  /** Journal récent, pour éviter de répéter la même direction (L4, L16). */
  readonly recentLogs: readonly ReviewLog[];
  /** Actes débloqués par la maîtrise (L14). */
  readonly unlockedActIds: readonly ActId[];
}

/** Traçabilité de l'ordre construit, vérifiable en test. */
export interface InterleavingDescriptor {
  readonly policy: InterleavingPolicy;
  readonly actSequence: readonly ActId[];
  readonly directionSequence: readonly DrillDirection[];
  readonly directionCounts: Readonly<Record<DrillDirection, number>>;
  readonly productionCount: number;
  readonly discriminationCount: number;
}

/** Plan immuable d'une session. */
export interface SessionPlan {
  readonly id: SessionId;
  readonly mode: SessionMode;
  readonly seed: RandomSeed;
  readonly createdAt: EpochMs;
  readonly config: SessionConfig;
  readonly items: readonly SessionItem[];
  readonly interleaving: InterleavingDescriptor;
  /** Questions dont la carte était due au démarrage (mode `review`). */
  readonly dueQuestionIds: readonly QuestionId[];
}

/** Motif d'échec de construction, à traduire par l'UI. */
export type SessionBuildFailure =
  'empty-selection' | 'no-due-cards' | 'act-locked' | 'invalid-config';

/** Résultat explicite de la construction d'un plan. */
export type SessionBuildResult =
  | { readonly ok: true; readonly plan: SessionPlan }
  | { readonly ok: false; readonly failure: SessionBuildFailure };

/** Phase courante d'une session. */
export type SessionPhase = 'asking' | 'revealed' | 'completed';

/** État mutable logique d'une session, remplacé à chaque transition. */
export interface SessionState {
  readonly plan: SessionPlan;
  readonly phase: SessionPhase;
  /** Index de l'item courant, 0-based ; vaut `items.length` une fois terminé. */
  readonly currentIndex: number;
  readonly answers: readonly SessionAnswer[];
  /** Nombre d'indices révélés pour l'item courant. */
  readonly revealedHints: number;
  /** Confiance déclarée pour l'item courant, avant révélation (L12). */
  readonly confidence: ConfidenceRating | null;
  readonly startedAt: EpochMs;
  readonly completedAt: EpochMs | null;
}

/** Signal d'erreur produite par le feedback correctif (L13). */
export type ErrorSignal =
  | 'none'
  | 'partial-answer'
  | 'wrong-question'
  | 'number-confusion'
  | 'keyword-confusion'
  | 'omission';

/** Feedback immédiat affiché après révélation. */
export interface AnswerFeedback {
  readonly correct: boolean;
  readonly expectedAnswer: ExpectedAnswer;
  readonly mentalImage: LocalizedText;
  readonly errorSignal: ErrorSignal;
  /** Clé de catalogue i18n du message d'explication. */
  readonly messageKey: string;
}

/** Canal de production déclaré par l'apprenant. */
export type AnswerChannel = 'written' | 'spoken' | 'self-declared';

/** Moment de la journée où la session a eu lieu (L17). */
export type SessionWindow = 'morning' | 'day' | 'evening' | 'night';

/** Réponse notée d'un item. */
export interface SessionAnswer {
  readonly itemId: string;
  readonly questionId: QuestionId;
  readonly direction: DrillDirection;
  readonly exerciseKind: ExerciseKind;
  readonly grade: ReviewGrade;
  readonly confidence: ConfidenceRating | null;
  readonly responseTimeMs: DurationMs;
  readonly hintsUsed: number;
  readonly channel: AnswerChannel;
  readonly answeredAt: EpochMs;
  readonly isCorrect: boolean;
}

/** Saisie d'une réponse par l'UI. */
export interface SessionAnswerInput {
  readonly itemId: string;
  readonly grade: ReviewGrade;
  readonly confidence: ConfidenceRating | null;
  readonly responseTimeMs: DurationMs;
  readonly hintsUsed: number;
  readonly channel: AnswerChannel;
}

/** Sortie d'une soumission : nouvel état, réponse normalisée et feedback. */
export interface SessionSubmission {
  readonly state: SessionState;
  readonly answer: SessionAnswer;
  readonly feedback: AnswerFeedback;
  readonly completed: boolean;
}

/** Journal persistant d'une session terminée. */
export interface SessionLog {
  readonly sessionId: SessionId;
  readonly mode: SessionMode;
  readonly planSeed: RandomSeed;
  readonly startedAt: EpochMs;
  readonly endedAt: EpochMs;
  readonly durationMs: DurationMs;
  /** Fenêtre de la journée, fournie par ClockPort (L17). */
  readonly window: SessionWindow;
  readonly itemCount: number;
  readonly productionCount: number;
  readonly discriminationCount: number;
  /** Nombre de productions déclarées à l'oral (L8). */
  readonly spokenCount: number;
  readonly correctCount: number;
  readonly accuracy: Ratio;
  readonly xpAwarded: number;
}

/** Vue agrégée d'une session, pour l'écran de bilan. */
export interface SessionSummary {
  readonly sessionId: SessionId;
  readonly mode: SessionMode;
  readonly itemCount: number;
  readonly answeredCount: number;
  readonly correctCount: number;
  readonly accuracy: Ratio;
  readonly durationMs: DurationMs;
  readonly xpAwarded: number;
  readonly byDirection: Readonly<
    Record<DrillDirection, { readonly attempts: number; readonly correct: number }>
  >;
}

/**
 * Constructeur de plan.
 *
 * Déterminisme : à `SessionRequest` et `SessionBuildContext` égaux, et avec un
 * `RandomPort` recréé depuis `request.seed`, le plan produit est identique
 * (mêmes items, mêmes directions, même ordre).
 */
export interface SessionBuilder {
  build(request: SessionRequest, context: SessionBuildContext): SessionBuildResult;
}

/**
 * Machine à états de session.
 *
 * Transitions autorisées : `asking → revealed → completed`. `submitAnswer`
 * n'est valide qu'en phase `revealed` ; `revealNextHint` qu'en phase `asking`.
 */
export interface SessionEngine {
  start(plan: SessionPlan, now: EpochMs): SessionState;
  revealNextHint(state: SessionState): SessionState;
  revealAnswer(state: SessionState): SessionState;
  submitAnswer(state: SessionState, input: SessionAnswerInput): SessionSubmission;
}
