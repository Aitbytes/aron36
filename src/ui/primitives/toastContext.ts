import { createContext, useContext } from 'react';

/** Durée d'affichage par défaut (ms) ; `0` rend la notification persistante. */
export const DEFAULT_TOAST_DURATION_MS = 8000;

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastInput {
  readonly title: string;
  readonly body?: string | undefined;
  readonly tone?: ToastTone | undefined;
  /** `0` : la notification reste jusqu'à fermeture manuelle. */
  readonly durationMs?: number | undefined;
  /** Identifiant stable : re-`show` la même valeur remplace la notification. */
  readonly id?: string | undefined;
}

/**
 * API de notification.
 *
 * `show` et `dismiss` sont déclarés comme **propriétés** (et non méthodes) :
 * les destructurer ne détache aucun `this`.
 */
export interface ToastApi {
  readonly show: (input: ToastInput) => void;
  readonly dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** API de notification ; lève si le `ToastProvider` est absent. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) {
    throw new Error('useToast doit être utilisé sous <ToastProvider>.');
  }
  return api;
}
