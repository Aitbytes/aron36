import type { HTMLAttributes } from 'react';

import { cx } from './classNames';
import styles from './Kbd.module.css';

export type KbdProps = HTMLAttributes<HTMLElement>;

/** Touche de clavier affichée dans une aide contextuelle. */
export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd {...rest} className={cx(styles.kbd, className)}>
      {children}
    </kbd>
  );
}
