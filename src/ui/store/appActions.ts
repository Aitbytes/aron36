import type { AppAction, AppScreen } from '@/application/store';
import { UseCaseRejection } from '@/application/usecases';
import type {
  AbandonSessionOutput,
  ExportProgressOutput,
  FinishSessionOutput,
  ImportProgressInput,
  RevealAnswerOutput,
  RevealHintOutput,
  ResetProgressOutput,
  SaveHookInput,
  SaveHookOutput,
  StartSessionInput,
  StartSessionOutput,
  SubmitAnswerInput,
  SubmitAnswerOutput,
  UpdateSettingsInput,
  UpdateSettingsOutput,
  UseCases,
} from '@/application/usecases';
import type { MasterySnapshot } from '@/domain/mastery/types';
import type { PersistedProgress, ProgressError } from '@/domain/progress/types';
import type { ActId, SessionId } from '@/domain/shared/types';
import type { MessageKey, Translator } from '@/i18n';

/**
 * Surface d'action des écrans (Phase 4-A).
 *
 * **Règle de couche.** Les écrans ne voient ni `UseCases` ni le dépôt : ils
 * voient `AppActions`. Chaque action :
 * 1. appelle le cas d'usage (seule source de vérité métier) ;
 * 2. dispatche l'action de store correspondante ;
 * 3. renvoie une issue explicite `{ ok: true } | { ok: false; reason }` ;
 * 4. remonte une écriture ratée (`writeFailure`) par une notification, jamais
 *    en la perdant.
 *
 * Aucun calcul métier n'est fait ici : pas d'XP, pas de série, pas de maîtrise,
 * pas d'intervalle.
 */

/** Raison stable d'échec d'une action, traduisible par l'UI. */
export type ActionFailureReason =
  | 'unknownSession'
  | 'transitionRefused'
  | 'submissionRefused'
  | 'buildRefused'
  | 'hookRefused'
  | 'hintUnavailable'
  | 'progressUnavailable'
  | 'progressProtected'
  | 'importFailed'
  | 'exportFailed'
  | 'resetFailed'
  | 'unknown';

/** Clé i18n du message d'une raison d'échec. */
export const ACTION_FAILURE_MESSAGE_KEYS = {
  unknownSession: 'action.failure.unknownSession',
  transitionRefused: 'action.failure.transitionRefused',
  submissionRefused: 'action.failure.submissionRefused',
  buildRefused: 'action.failure.buildRefused',
  hookRefused: 'action.failure.hookRefused',
  hintUnavailable: 'action.failure.hintUnavailable',
  progressUnavailable: 'action.failure.progressUnavailable',
  progressProtected: 'action.failure.progressProtected',
  importFailed: 'action.failure.importFailed',
  exportFailed: 'action.failure.exportFailed',
  resetFailed: 'action.failure.resetFailed',
  unknown: 'action.failure.unknown',
} as const satisfies Readonly<Record<ActionFailureReason, MessageKey>>;

/** Succès d'une action : la valeur produite et l'avertissement d'écriture éventuel. */
export interface ActionSuccess<T> {
  readonly ok: true;
  readonly value: T;
  /** Écriture ratée non bloquante (progression conservée en mémoire), sinon `null`. */
  readonly warning: ProgressError | null;
}

/** Échec d'une action : raison stable et erreur de persistance éventuelle. */
export interface ActionFailure {
  readonly ok: false;
  readonly reason: ActionFailureReason;
  readonly error: ProgressError | null;
}

/** Issue d'une action. `{ ok: true }` structurellement compatible. */
export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

/** Notification émise par une action (rendue par le `ToastProvider`). */
export interface ActionNotification {
  readonly tone: 'info' | 'success' | 'danger';
  readonly title: string;
  readonly body: string | null;
}

/** Dépendances injectées dans `createAppActions` (aucun hook ici : testable seul). */
export interface AppActionsDeps {
  readonly useCases: UseCases;
  readonly dispatch: (action: AppAction) => void;
  readonly notify: (notification: ActionNotification) => void;
  readonly t: Translator;
}

/**
 * Actions exposées aux écrans.
 *
 * `revealHint` et `revealAnswer` dispatchent tous deux `session/hint-revealed` :
 * c'est la seule action du store (gelée en Phase 3) qui remplace un `SessionState`
 * sans le rejouer. Les écrans lisent `state.session.phase` pour savoir où ils en
 * sont.
 */
export interface AppActions {
  // Navigation et état d'interface (aucun cas d'usage).
  navigate(screen: AppScreen): void;
  selectAct(actId: ActId | null): void;
  dismissFeedback(): void;
  setBusy(busy: boolean): void;

  // Session.
  startSession(input: StartSessionInput): ActionResult<StartSessionOutput>;
  submitAnswer(input: SubmitAnswerInput): ActionResult<SubmitAnswerOutput>;
  revealHint(sessionId: SessionId): ActionResult<RevealHintOutput>;
  revealAnswer(sessionId: SessionId): ActionResult<RevealAnswerOutput>;
  finishSession(sessionId: SessionId): ActionResult<FinishSessionOutput>;
  abandonSession(sessionId: SessionId): ActionResult<AbandonSessionOutput>;

  // Accroches personnelles et réglages.
  saveHook(input: SaveHookInput): ActionResult<SaveHookOutput>;
  updateSettings(input: UpdateSettingsInput): ActionResult<UpdateSettingsOutput>;

  // Persistance : import, export, réinitialisation.
  importProgress(input: ImportProgressInput): ActionResult<PersistedProgress>;
  exportProgress(): ActionResult<ExportProgressOutput>;
  resetProgress(): ActionResult<ResetProgressOutput>;

  // Lecture déléguée au domaine (maîtrise) pour l'affichage.
  evaluateMastery(): ActionResult<MasterySnapshot>;

  /**
   * Synthèse vocale (L8). Neutre si le réglage est coupé ou si aucune voix
   * n'est disponible : la lecture n'est jamais bloquante et ne lève jamais.
   */
  speak(text: string): void;
}

/** Construit la surface d'action (pure : aucune dépendance React). */
export function createAppActions(deps: AppActionsDeps): AppActions {
  const { useCases, dispatch, notify, t } = deps;

  const success = <T>(value: T, warning: ProgressError | null = null): ActionSuccess<T> => ({
    ok: true,
    value,
    warning,
  });

  const failure = (error: unknown): ActionFailure => {
    if (!(error instanceof UseCaseRejection)) {
      console.error('Action applicative en échec (erreur inattendue) :', error);
    }
    return { ok: false, reason: reasonOf(error), error: progressErrorOf(error) };
  };

  const notifyWriteFailure = (writeFailure: ProgressError): void => {
    notify({
      tone: 'danger',
      title: t('toast.writeFailed.title'),
      body: t('toast.writeFailed.body', { code: writeFailure.code }),
    });
  };

  return {
    navigate(screen) {
      dispatch({ type: 'ui/navigate', screen });
    },

    selectAct(actId) {
      dispatch({ type: 'ui/act-selected', actId });
    },

    dismissFeedback() {
      dispatch({ type: 'ui/feedback-dismissed' });
    },

    setBusy(busy) {
      dispatch({ type: 'ui/busy-changed', busy });
    },

    startSession(input) {
      try {
        const output = useCases.startSession.execute(input);
        dispatch({ type: 'session/started', state: output.state });
        return success(output);
      } catch (error) {
        return failure(error);
      }
    },

    submitAnswer(input) {
      try {
        const output = useCases.submitAnswer.execute(input);
        dispatch({
          type: 'session/answered',
          session: output.session,
          answer: output.answer,
          feedback: output.feedback,
          xp: output.xp,
          progress: output.updatedProgress,
        });
        if (output.writeFailure !== null) {
          notifyWriteFailure(output.writeFailure);
        }
        return success(output, output.writeFailure);
      } catch (error) {
        return failure(error);
      }
    },

    revealHint(sessionId) {
      try {
        const output = useCases.revealHint.execute({ sessionId });
        dispatch({ type: 'session/hint-revealed', state: output.state });
        return success(output);
      } catch (error) {
        return failure(error);
      }
    },

    revealAnswer(sessionId) {
      try {
        const output = useCases.revealAnswer.execute({ sessionId });
        dispatch({ type: 'session/hint-revealed', state: output.state });
        return success(output);
      } catch (error) {
        return failure(error);
      }
    },

    finishSession(sessionId) {
      try {
        const output = useCases.finishSession.execute({ sessionId });
        dispatch({
          type: 'session/completed',
          summary: output.summary,
          xp: output.xp,
          progress: output.updatedProgress,
        });
        if (output.writeFailure !== null) {
          notifyWriteFailure(output.writeFailure);
        }
        return success(output, output.writeFailure);
      } catch (error) {
        return failure(error);
      }
    },

    abandonSession(sessionId) {
      try {
        const output = useCases.abandonSession.execute({ sessionId });
        dispatch({ type: 'session/abandoned' });
        if (output.writeFailure !== null) {
          notifyWriteFailure(output.writeFailure);
        }
        return success(output, output.writeFailure);
      } catch (error) {
        return failure(error);
      }
    },

    saveHook(input) {
      try {
        const output = useCases.saveHook.execute(input);
        dispatch({ type: 'hooks/saved', hook: output.hook });
        if (output.writeFailure !== null) {
          notifyWriteFailure(output.writeFailure);
        }
        return success(output, output.writeFailure);
      } catch (error) {
        return failure(error);
      }
    },

    updateSettings(input) {
      try {
        const output = useCases.updateSettings.execute(input);
        dispatch({ type: 'settings/updated', progress: output.progress });
        if (output.writeFailure !== null) {
          notifyWriteFailure(output.writeFailure);
        }
        return success(output, output.writeFailure);
      } catch (error) {
        return failure(error);
      }
    },

    importProgress(input) {
      try {
        const result = useCases.importProgress.execute(input);
        if (!result.ok) {
          notify({
            tone: 'danger',
            title: t('toast.importFailed.title'),
            body: t('toast.importFailed.body', { code: result.error.code }),
          });
          return { ok: false, reason: 'importFailed', error: result.error };
        }
        dispatch({ type: 'progress/replaced', progress: result.progress });
        notify({
          tone: 'success',
          title: t('toast.importDone.title'),
          body: t('toast.importDone.body'),
        });
        return success(result.progress);
      } catch (error) {
        const reason = reasonOf(error);
        notify({
          tone: 'danger',
          title: t('toast.importFailed.title'),
          body: t(ACTION_FAILURE_MESSAGE_KEYS[reason]),
        });
        return { ok: false, reason, error: progressErrorOf(error) };
      }
    },

    exportProgress() {
      try {
        return success(useCases.exportProgress.execute());
      } catch (error) {
        const reason = reasonOf(error);
        return {
          ok: false,
          reason: reason === 'unknown' ? 'exportFailed' : reason,
          error: progressErrorOf(error),
        };
      }
    },

    resetProgress() {
      try {
        const output = useCases.resetProgress.execute();
        dispatch({ type: 'progress/reset', progress: output.progress });
        notify({
          tone: 'success',
          title: t('toast.resetDone.title'),
          body: t('toast.resetDone.body'),
        });
        if (output.writeFailure !== null) {
          notifyWriteFailure(output.writeFailure);
        }
        return success(output, output.writeFailure);
      } catch (error) {
        return failure(error);
      }
    },

    evaluateMastery() {
      try {
        // L'instantané est déballé : l'UI ne voit que le résultat du domaine.
        return success(useCases.evaluateMastery.execute().mastery);
      } catch (error) {
        return failure(error);
      }
    },

    speak(text) {
      // Volontairement « fire-and-forget » : aucune lecture ne doit bloquer une
      // note ni faire échouer l'écran de jeu.
      void useCases.speak.execute({ text });
    },
  };
}

/** Traduit un rejet de cas d'usage en raison d'action stable. */
function reasonOf(error: unknown): ActionFailureReason {
  if (!(error instanceof UseCaseRejection)) {
    return 'unknown';
  }
  switch (error.reason) {
    case 'unknown-session':
      return 'unknownSession';
    case 'session-transition-refused':
      return 'transitionRefused';
    case 'session-submission-refused':
      return 'submissionRefused';
    case 'session-build-refused':
      return 'buildRefused';
    case 'hook-refused':
      return 'hookRefused';
    case 'hint-unavailable':
      return 'hintUnavailable';
    case 'progress-unavailable':
      return 'progressUnavailable';
    case 'progress-protected':
      return 'progressProtected';
  }
}

/** Erreur de persistance portée par un rejet, sinon `null`. */
function progressErrorOf(error: unknown): ProgressError | null {
  if (error instanceof UseCaseRejection && error.detail.kind === 'progress') {
    return error.detail.error;
  }
  return null;
}
