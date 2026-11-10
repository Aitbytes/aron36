import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { cx } from './classNames';
import { IconButton } from './IconButton';
import styles from './Toast.module.css';
import { DEFAULT_TOAST_DURATION_MS, ToastContext } from './toastContext';
import type { ToastApi, ToastInput, ToastTone } from './toastContext';

interface ToastItem {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly tone: ToastTone;
}

export interface ToastProviderProps {
  /** Libellé de la région (`aria-label`) ; transmis traduit par l'application. */
  readonly label?: string | undefined;
  /** Libellé accessible du bouton de fermeture de chaque notification. */
  readonly closeLabel: string;
  readonly defaultDurationMs?: number | undefined;
  readonly children: ReactNode;
}

/**
 * Notifications accessibles.
 *
 * - région `aria-live="polite"` permanente, donc annoncée sans voler le focus ;
 * - chaque notification porte `role="status"` (`aria-live="polite"`) ou
 *   `role="alert"` (`aria-live="assertive"`) pour les erreurs : les erreurs ne
 *   sont jamais silencieuses ;
 * - fermeture manuelle possible (bouton dédié) en plus de l'auto-fermeture ;
 * - aucune animation bloquante : le retrait est un simple démontage.
 */
export function ToastProvider({
  label,
  closeLabel,
  defaultDurationMs = DEFAULT_TOAST_DURATION_MS,
  children,
}: ToastProviderProps) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((id: string): void => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string): void => {
      clearTimer(id);
      setItems((previous) => previous.filter((item) => item.id !== id));
    },
    [clearTimer],
  );

  const show = useCallback(
    (input: ToastInput): void => {
      counterRef.current += 1;
      const id = input.id ?? `toast-${String(counterRef.current)}`;
      const item: ToastItem = {
        id,
        title: input.title,
        body: input.body ?? null,
        tone: input.tone ?? 'info',
      };
      clearTimer(id);
      setItems((previous) => [...previous.filter((entry) => entry.id !== id), item]);
      const duration = input.durationMs ?? defaultDurationMs;
      if (duration > 0) {
        timersRef.current.set(
          id,
          setTimeout(() => {
            timersRef.current.delete(id);
            setItems((previous) => previous.filter((entry) => entry.id !== id));
          }, duration),
        );
      }
    },
    [clearTimer, defaultDurationMs],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className={styles.region}
        aria-live="polite"
        aria-relevant="additions"
        aria-label={label}
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={cx(styles.toast, styles[item.tone])}
            role={item.tone === 'danger' ? 'alert' : 'status'}
            aria-live={item.tone === 'danger' ? 'assertive' : 'polite'}
          >
            <div className={styles.content}>
              <p className={styles.title}>{item.title}</p>
              {item.body === null ? null : <p className={styles.body}>{item.body}</p>}
            </div>
            <IconButton label={closeLabel} size="sm" onClick={() => dismiss(item.id)}>
              ✕
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
