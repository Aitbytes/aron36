import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

import { cx } from './classNames';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: 'surface' | 'raised' | undefined;
}

/** Surface neutre : conteneur visuel sans sémantique de section. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'surface', className, children, ...rest },
  ref,
) {
  return (
    <div {...rest} ref={ref} className={cx(styles.card, styles[tone], className)}>
      {children}
    </div>
  );
});
