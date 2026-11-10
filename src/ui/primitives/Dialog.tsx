import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

import { cx } from './classNames';
import styles from './Dialog.module.css';
import { IconButton } from './IconButton';

/** Sélecteur des éléments focusables d'une boîte (ordre du DOM). */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface DialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Titre référencé par `aria-labelledby` : identité accessible de la boîte. */
  readonly title: string;
  /** Libellé du bouton de fermeture. */
  readonly closeLabel: string;
  readonly children?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  readonly className?: string | undefined;
}

/**
 * Boîte de dialogue modale (confirmation destructive, récupération de données).
 *
 * Accessibilité :
 * - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` ;
 * - **piège de focus** : `Tab`/`Maj+Tab` bouclent à l'intérieur de la boîte ;
 * - `Échap` ferme la boîte, d'où que soit le focus (écoute au niveau document,
 *   sans `onKeyDown` sur un élément non interactif) ;
 * - le focus revient à l'élément déclencheur à la fermeture.
 *
 * Le clic sur le fond ne ferme pas : une confirmation destructive ne doit pas
 * partir sur un clic imprécis.
 */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  children,
  footer,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  // `onClose` peut être recréé à chaque rendu : le garder dans une référence
  // évite de relancer l'effet (et donc de rejouer le focus) à chaque rendu.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = focusablesWithin(panel)[0];
    if (first !== undefined) {
      first.focus();
    } else {
      panel?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || panel === null) {
        return;
      }
      const focusables = focusablesWithin(panel);
      const head = focusables[0];
      const tail = focusables[focusables.length - 1];
      if (head === undefined || tail === undefined) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && panel.contains(active);
      if (event.shiftKey && (active === head || !inside)) {
        event.preventDefault();
        tail.focus();
        return;
      }
      if (!event.shiftKey && (active === tail || !inside)) {
        event.preventDefault();
        head.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const previous = restoreFocusRef.current;
      restoreFocusRef.current = null;
      previous?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className={styles.overlay}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(styles.panel, className)}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton label={closeLabel} size="sm" onClick={onClose}>
            ✕
          </IconButton>
        </div>
        {children === undefined ? null : <div className={styles.body}>{children}</div>}
        {footer === undefined ? null : <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}

function focusablesWithin(panel: HTMLElement | null): readonly HTMLElement[] {
  if (panel === null) {
    return [];
  }
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
  );
}
