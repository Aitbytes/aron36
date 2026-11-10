import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cx } from './classNames';
import styles from './Button.module.css';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  /** État de chargement : désactive le bouton et bloque `onClick`. */
  readonly loading?: boolean | undefined;
  /** Occupe toute la largeur disponible. */
  readonly block?: boolean | undefined;
  readonly leadingIcon?: ReactNode;
}

/**
 * Bouton de l'interface.
 *
 * - `loading` implique `disabled` **et** neutralise `onClick` : un double clic
 *   pendant une écriture ne peut donc pas rejouer l'action ;
 * - `aria-busy` signale l'attente aux technologies d'assistance ;
 * - cible tactile ≥ `--target-min-size` (44 px) à toutes les tailles.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    block = false,
    leadingIcon,
    className,
    children,
    disabled,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled === true || loading;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(styles.button, styles[variant], styles[size], block && styles.block, className)}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      onClick={loading ? undefined : onClick}
    >
      {loading ? <Spinner size="sm" /> : leadingIcon}
      <span className={styles.label}>{children}</span>
    </button>
  );
});
