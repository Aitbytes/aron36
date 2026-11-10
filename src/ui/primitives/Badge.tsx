import type { HTMLAttributes } from 'react';

import { cx } from './classNames';
import styles from './Tag.module.css';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: 'default' | 'accent' | 'success' | 'danger' | 'muted';
}

/** Compteur ou marqueur numérique (quêtes terminées, gels, badges). */
export function Badge({ tone = 'accent', className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx(styles.tag, styles.badge, styles[tone], className)}>
      {children}
    </span>
  );
}
