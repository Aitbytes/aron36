import type { PersistedProgress } from '@/domain/progress/types';
import type { LocaleCode } from '@/domain/shared/types';

import type { AppState } from './types';

/**
 * État initial de l'application.
 *
 * `createInitialAppState` reçoit une progression **déjà hydratée** (le cas
 * d'usage de chargement a résolu le stockage, les migrations et les erreurs) :
 * la fonction est donc pure et déterministe — aucune lecture d'horloge, aucun
 * aléa, aucun accès au stockage, aucune date fabriquée ici.
 */
export function createInitialAppState(progress: PersistedProgress, locale?: LocaleCode): AppState {
  // La locale de l'UI duplique `PlayerSettings.locale` ; un paramètre explicite
  // (préférence détectée avant hydratation, par exemple) prime sur la valeur
  // persistée.
  const resolvedLocale: LocaleCode = locale ?? progress.player.settings.locale;

  return {
    ready: true,
    progress,
    ui: {
      screen: 'home',
      locale: resolvedLocale,
      activeActId: null,
      activeSessionId: null,
      feedback: null,
      busy: false,
    },
    session: null,
    lastError: null,
  };
}
