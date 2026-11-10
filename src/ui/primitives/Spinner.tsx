import { cx } from './classNames';
import styles from './Spinner.module.css';
import { VisuallyHidden } from './VisuallyHidden';

export type SpinnerSize = 'sm' | 'md';

export interface SpinnerProps {
  readonly size?: SpinnerSize | undefined;
  /** Libellé annoncé ; sans libellé, le spinner est purement décoratif. */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * Indicateur d'activité.
 *
 * L'animation est neutralisée par `prefers-reduced-motion` (le cercle reste
 * visible et décrit). Sans libellé, il est `aria-hidden` : c'est alors au
 * composant appelant d'annoncer l'attente (`aria-busy`).
 */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span
      className={cx(styles.spinner, styles[size], className)}
      role={label === undefined ? undefined : 'status'}
      aria-hidden={label === undefined ? true : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle className={styles.track} cx="12" cy="12" r="9" />
        <circle className={styles.head} cx="12" cy="12" r="9" />
      </svg>
      {label === undefined ? null : <VisuallyHidden>{label}</VisuallyHidden>}
    </span>
  );
}
