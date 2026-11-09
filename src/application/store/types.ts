import type { ActId, EpochMs, LocaleCode, SessionId } from '@/domain/shared/types';
import type { PlayerSettings, XpAward } from '@/domain/gamification/types';
import type { PersistedProgress, ProgressError } from '@/domain/progress/types';
import type {
  AnswerFeedback,
  SessionAnswer,
  SessionState,
  SessionSummary,
} from '@/domain/session/types';
import type { PersonalHook } from '@/domain/memory/types';
import type { ScheduledReview } from '@/domain/srs/types';

/**
 * Store applicatif (Phase 3).
 *
 * Le store est un réducteur pur côté état : les effets (localStorage, voix)
 * restent dans les cas d'usage et les adaptateurs. L'UI ne lit que `AppState`
 * et n'écrit que des `AppAction` typées.
 */

/** Écran racine affiché par l'application. */
export type AppScreen = 'home' | 'train' | 'collection' | 'stats' | 'settings' | 'grand-oral';

/** Feedback courant affiché après révélation (L13). */
export interface FeedbackState {
  readonly answer: SessionAnswer;
  readonly feedback: AnswerFeedback;
}

/** État d'interface, volontairement minimal et sérialisable. */
export interface UiState {
  readonly screen: AppScreen;
  readonly locale: LocaleCode;
  /** Acte sélectionné dans les menus, `null` pour « tous ». */
  readonly activeActId: ActId | null;
  /** Session en cours d'affichage, dupliquée depuis `session` pour l'UI. */
  readonly activeSessionId: SessionId | null;
  readonly feedback: FeedbackState | null;
  /** Une opération d'I/O est en cours (chargement, export, import). */
  readonly busy: boolean;
}

/** État racine consommé par React. */
export interface AppState {
  /** `false` tant que la progression n'a pas été hydratée. */
  readonly ready: boolean;
  readonly progress: PersistedProgress;
  readonly ui: UiState;
  readonly session: SessionState | null;
  readonly lastError: ProgressError | null;
}

/** Action de réveil après hydratation. */
export type AppAction =
  | { readonly type: 'progress/hydrated'; readonly progress: PersistedProgress }
  | { readonly type: 'progress/replaced'; readonly progress: PersistedProgress }
  | { readonly type: 'progress/saved'; readonly savedAt: EpochMs }
  | { readonly type: 'progress/error'; readonly error: ProgressError }
  | { readonly type: 'progress/reset'; readonly progress: PersistedProgress }
  | { readonly type: 'session/started'; readonly state: SessionState }
  | { readonly type: 'session/hint-revealed'; readonly state: SessionState }
  | {
      readonly type: 'session/answered';
      readonly session: SessionState;
      readonly answer: SessionAnswer;
      readonly feedback: AnswerFeedback;
      readonly scheduledReview: ScheduledReview | null;
      readonly xp: XpAward;
    }
  | {
      readonly type: 'session/completed';
      readonly summary: SessionSummary;
      readonly xp: XpAward;
    }
  | { readonly type: 'session/abandoned' }
  | { readonly type: 'ui/navigate'; readonly screen: AppScreen }
  | { readonly type: 'ui/act-selected'; readonly actId: ActId | null }
  | { readonly type: 'ui/feedback-dismissed' }
  | { readonly type: 'ui/busy-changed'; readonly busy: boolean }
  | { readonly type: 'settings/updated'; readonly settings: Partial<PlayerSettings> }
  | { readonly type: 'hooks/saved'; readonly hook: PersonalHook };

/** Désabonnement d'un listener de store. */
export type Unsubscribe = () => void;

/** Contrat du store ; implémentation en Phase 3 (React Context + useSyncExternalStore). */
export interface AppStore {
  getState(): AppState;
  dispatch(action: AppAction): void;
  subscribe(listener: (state: AppState) => void): Unsubscribe;
}
