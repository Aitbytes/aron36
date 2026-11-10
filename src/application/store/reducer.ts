import type { PersistedProgress } from '@/domain/progress/types';
import type { HookLibrary } from '@/domain/memory/types';

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
 * Décision d'architecture (revue Phase 3, non négociable) : **la progression
 * `PersistedProgress` a un seul propriétaire — les cas d'usage**. Le store ne
 * la calcule jamais, il la **reçoit** : `session/answered` et
 * `session/completed` portent l'état complet produit (et déjà persisté) par le
 * cas d'usage, et le réducteur l'installe tel quel. Il n'y dérive plus rien :
 * ni carte SRS, ni `ReviewLog`, ni XP, ni quête, ni série, ni badge, ni
 * collection — la divergence store/persisté observée en revue (streak, badges,
 * quêtes, collection) devient structurellement impossible.
 *
 * Choix documentés par cas :
 * - `session/answered` / `session/completed` : voir ci-dessus ; `xp` ne sert
 *   qu'à l'affichage (déjà créditée dans `progress`) ; `session/completed`
 *   conserve `session` (phase `completed`, matière de l'écran de bilan) et
 *   ramène `ui.screen` à `'home'` : une session finie ne peut pas piéger
 *   l'utilisateur sur l'écran d'entraînement, et `session/started`,
 *   `session/abandoned` ou les chemins de récupération la remplaceront ;
 * - `progress/reset` est un chemin de **récupération** : il purge `lastError`
 *   et retire la session courante, dont les items référencent des cartes
 *   remplacées par des cartes neuves.
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
      // Source de vérité unique : `progress` vient du cas d'usage, déjà
      // persisté ; le réducteur l'installe par référence, sans dérivation.
      return withUi(
        { ...state, session: action.session, progress: action.progress },
        { feedback: { answer: action.answer, feedback: action.feedback } },
      );
    }

    case 'session/completed':
      // `progress` porte déjà le SessionLog et l'XP de clôture (cas d'usage).
      // `session` est conservée pour l'écran de bilan (phase `completed`) ;
      // l'écran revient à l'accueil et le feedback s'efface.
      return withUi({ ...state, progress: action.progress }, { feedback: null, screen: 'home' });

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
      // Source de vérité unique : la progression (réglages fusionnés et
      // persistés) vient du cas d'usage `updateSettings`. Le réducteur ne
      // fusionne plus rien lui-même ; il reflète seulement la locale dans
      // `ui.locale`, duplication d'affichage maintenue comme `activeSessionId`
      // l'est pour `session`.
      const locale = action.progress.player.settings.locale;
      const next = withProgress(state, action.progress);
      if (locale === state.ui.locale) {
        return next;
      }
      return withUi(next, { locale });
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
