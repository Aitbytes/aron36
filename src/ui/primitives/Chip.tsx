import type { HTMLAttributes } from 'react';

import { cx } from './classNames';
import styles from './Tag.module.css';

export type TagTone = 'default' | 'accent' | 'success' | 'danger' | 'muted';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: TagTone | undefined;
}

/** Étiquette courte (rang, acte, statut). */
export function Chip({ tone = 'default', className, children, ...rest }: ChipProps) {
  return (
    <span {...rest} className={cx(styles.tag, styles[tone], className)}>
      {children}
    </span>
  );
}
