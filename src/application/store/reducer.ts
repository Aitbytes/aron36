import { MAX_REVIEW_LOG_ENTRIES } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import type { HookLibrary } from '@/domain/memory/types';
import type { ReviewLog } from '@/domain/srs/types';
import type { EpochMs } from '@/domain/shared/types';

import type { AppAction, AppState, UiState } from './types';

/**
 * Réducteur pur de l'application.
 *
 * Garanties (ADR 0008 — déterminisme, horloge et aléa) :
 * - **aucune mutation** : chaque cas reconstruit les niveaux touchés et un
 *   nouvel objet racine ;
 * - **aucune source de temps ni d'aléa** : pas de `Date.now()`, pas de
 *   `Math.random()`, pas de stockage — tout instant utile arrive **dans
 *   l'action**, calculé par le cas d'usage via `ClockPort`.
 *
 * Choix documentés par cas (voir aussi la PR Phase 3-B) :
 * - `session/answered` applique lui-même les deltas de progression dérivables
 *   de l'action (XP, carte SRS suivante, journal de révision) et laisse
 *   `savedAt` intact : c'est le cas d'usage qui écrit, via `progress/saved` ;
 * - `session/completed` conserve `session` (phase `completed`, matière de
 *   l'écran de bilan) et ramène `ui.screen` à `'home'` : une session finie ne
 *   peut pas piéger l'utilisateur sur l'écran d'entraînement, et
 *   `session/started` ou `session/abandoned` la remplaceront ;
 * - `session/completed` ne fabrique **pas** de `SessionLog` : le champ
 *   `SessionLog.window` (L17) est calculé depuis l'heure **locale** par
 *   `ClockPort`, que le réducteur ne possède pas. La journalisation persistée
 *   de la session revient au cas d'usage `finishSession`, qui émet
 *   `progress/replaced` avec l'agrégat complet ;
 * - `progress/reset` et `progress/replaced` sont des chemins de
 *   **récupération** (donnée corrompue ou import) : ils purgent `lastError` ;
 *   `reset` retire en plus la session courante, dont les items référencent
 *   des cartes remplacées par des cartes neuves.
 */

/** Erreur de compilation si une variante d'`AppAction` venait à manquer. */
function assertNeverAction(action: never): never {
  throw new Error(`Action inconnue (inatteignable par typage) : ${JSON.stringify(action)}`);
}

/** Reconstruit `ui` avec les champs fournis, sans toucher aux autres. */
function withUi(state: AppState, ui: Partial<UiState>): AppState {
  return { ...state, ui: { ...state.ui, ...ui } };
}

/** Reconstruit `progress` avec les champs fournis, sans toucher aux autres. */
function withProgress(state: AppState, progress: PersistedProgress): AppState {
  return { ...state, progress };
}

/**
 * Insère ou remplace l'accroche d'une question (au plus une par question,
 * invariant `HookLibrary`) et avance `updatedAt` à l'instant le plus récent
 * connu — l'horodatage est porté par l'accroche, créée par le cas d'usage.
 */
function upsertHook(library: HookLibrary, hook: HookLibrary['hooks'][number]): HookLibrary {
  const remaining = library.hooks.filter((entry) => entry.questionId !== hook.questionId);
  return {
    hooks: [...remaining, hook],
    updatedAt: Math.max(library.updatedAt, hook.updatedAt),
  };
}

/**
 * Construit la ligne de journal d'une réponse à partir des seules données de
 * l'action (contournement local, à arbitrer en Phase 4) :
 * - `id` : `SessionAnswer.itemId` est déjà unique (``${sessionId}:${index}``)
 *   et déterministe, il sert d'identifiant de journal ;
 * - `nextDueAt` / `intervalDays` : sans réordonnancement (discrimination,
 *   première exposition), la carte garde son échéance courante ;
 * - les prétests (L18) ne sont **jamais** journalisés : leur correction
 *   révélerait la réponse attendue (contrat du moteur de session).
 */
function reviewLogFor(
  state: AppState,
  action: Extract<AppAction, { type: 'session/answered' }>,
): ReviewLog | null {
  const { answer, scheduledReview } = action;
  if (answer.isPretest) {
    return null;
  }
  const currentCard = state.progress.cards[answer.questionId];
  const dueAt: EpochMs = scheduledReview?.nextCard.dueAt ?? currentCard?.dueAt ?? answer.answeredAt;
  const intervalDays = scheduledReview?.nextCard.intervalDays ?? currentCard?.intervalDays ?? 0;

  return {
    id: answer.itemId,
    sessionId: action.session.plan.id,
    questionId: answer.questionId,
    direction: answer.direction,
    exerciseKind: answer.exerciseKind,
    grade: answer.grade,
    reviewedAt: answer.answeredAt,
    previousDueAt: scheduledReview?.previousCard.dueAt ?? null,
    nextDueAt: dueAt,
    intervalDays,
    elapsedDays: scheduledReview?.elapsedDays ?? 0,
    responseTimeMs: answer.responseTimeMs,
    hintsUsed: answer.hintsUsed,
    confidence: answer.confidence,
  };
}

/**
 * `session/answered` : XP, carte SRS suivante, journal de révision —
 * tronqués aux limites de persistance et sans toucher à `savedAt`.
 */
function applyAnswerToProgress(
  state: AppState,
  action: Extract<AppAction, { type: 'session/answered' }>,
): PersistedProgress {
  const log = reviewLogFor(state, action);
  const reviewLogs =
    log === null
      ? state.progress.reviewLogs
      : [...state.progress.reviewLogs, log].slice(-MAX_REVIEW_LOG_ENTRIES);
  const cards =
    action.scheduledReview === null
      ? state.progress.cards
      : {
          ...state.progress.cards,
          [action.scheduledReview.nextCard.questionId]: action.scheduledReview.nextCard,
        };

  return {
    ...state.progress,
    cards,
    reviewLogs,
    player: {
      ...state.progress.player,
      totalXp: state.progress.player.totalXp + action.xp.amount,
    },
  };
}

/**
 * Réducteur applicatif : `AppState × AppAction → AppState`.
 *
 * Le `switch` est exhaustif et clos par `assertNeverAction` : oublier une
 * variante d'`AppAction` est une erreur de compilation, pas un bug silencieux.
 * Un `default` qui renverrait l'état romprait cette garantie, d'où le choix
 * d'une assertion (jamais atteinte à l'exécution).
 */
export function reduce(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'progress/hydrated':
      return { ...state, ready: true, progress: action.progress };

    case 'progress/replaced':
      // Chemin de récupération (import) : une donnée saine résout la dernière
      // erreur de persistance, on la purge.
      return { ...state, progress: action.progress, lastError: null };

    case 'progress/saved':
      return withProgress(state, { ...state.progress, savedAt: action.savedAt });

    case 'progress/error':
      // L'erreur n'écrase rien : la progression courante reste utilisable.
      return { ...state, lastError: action.error };

    case 'progress/reset': {
      const cleared: AppState = {
        ...state,
        progress: action.progress,
        lastError: null,
        session: null,
      };
      return withUi(cleared, { activeSessionId: null, feedback: null });
    }

    case 'session/started':
      // Une nouvelle session démarre : plus de feedback d'un item précédent.
      // L'écran reste sous le contrôle explicite de `ui/navigate`.
      return withUi(
        { ...state, session: action.state },
        { activeSessionId: action.state.plan.id, feedback: null },
      );

    case 'session/hint-revealed':
      // Seul le compteur d'indices (porté par l'état du moteur) change.
      return { ...state, session: action.state };

    case 'session/answered': {
      const progress = applyAnswerToProgress(state, action);
      return withUi(
        { ...state, session: action.session, progress },
        { feedback: { answer: action.answer, feedback: action.feedback } },
      );
    }

    case 'session/completed':
      // `session` est conservée pour l'écran de bilan (phase `completed`) ;
      // l'XP de fin de session est créditée. Le résumé persisté (`SessionLog`,
      // tronqué à `MAX_SESSION_LOG_ENTRIES`) relève du cas d'usage, qui seul
      // connaît la fenêtre locale (L17).
      return withUi(
        withProgress(state, {
          ...state.progress,
          player: {
            ...state.progress.player,
            totalXp: state.progress.player.totalXp + action.xp.amount,
          },
        }),
        { feedback: null, screen: 'home' },
      );

    case 'session/abandoned':
      // Abandon : la session disparaît sans journal ni pénalité (anti-objectif
      // « pas de punition ») ; l'écran reste sous contrôle de `ui/navigate`.
      return withUi({ ...state, session: null }, { activeSessionId: null, feedback: null });

    case 'ui/navigate': {
      if (state.ui.screen === action.screen) {
        // Identique par référence : le store ne notifiera personne.
        return state;
      }
      return withUi(state, { screen: action.screen });
    }

    case 'ui/act-selected': {
      if (state.ui.activeActId === action.actId) {
        return state;
      }
      return withUi(state, { activeActId: action.actId });
    }

    case 'ui/feedback-dismissed': {
      if (state.ui.feedback === null) {
        return state;
      }
      return withUi(state, { feedback: null });
    }

    case 'ui/busy-changed': {
      if (state.ui.busy === action.busy) {
        return state;
      }
      return withUi(state, { busy: action.busy });
    }

    case 'settings/updated': {
      // Fusion partielle : les champs absents du patch gardent leur valeur.
      const settings = { ...state.progress.player.settings, ...action.settings };
      const next = withProgress(state, {
        ...state.progress,
        player: { ...state.progress.player, settings },
      });
      // `ui.locale` duplique `PlayerSettings.locale` pour l'UI : l'invariant
      // est maintenu ici, comme `activeSessionId` l'est pour `session`.
      if (action.settings.locale === undefined || action.settings.locale === state.ui.locale) {
        return next;
      }
      return withUi(next, { locale: action.settings.locale });
    }

    case 'hooks/saved':
      return withProgress(state, {
        ...state.progress,
        hooks: upsertHook(state.progress.hooks, action.hook),
      });

    default:
      // Défensif et documenté : inatteignable tant que `AppAction` est une
      // union fermée — `assertNeverAction` garantit l'exhaustivité à la
      // compilation et lève explicitement si l'exécution y contredit le type.
      return assertNeverAction(action);
  }
}
