import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './classNames';
import styles from './VisuallyHidden.module.css';

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children: ReactNode;
}

/**
 * Contenu réservé aux technologies d'assistance.
 *
 * Équivalent du `.visually-hidden` global, mais en CSS Module : la primitive ne
 * dépend pas d'une feuille globale.
 */
export function VisuallyHidden({ children, className, ...rest }: VisuallyHiddenProps) {
  return (
    <span {...rest} className={cx(styles.hidden, className)}>
      {children}
    </span>
  );
}
