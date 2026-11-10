import type { HTMLAttributes } from 'react';

import { cx } from './classNames';
import styles from './Layout.module.css';

/** Pas d'espacement de l'échelle de tokens (`1` → `--space-1`, … `7`). */
export type SpaceStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type LayoutAlign = 'stretch' | 'start' | 'center' | 'end';
export type LayoutJustify = 'start' | 'center' | 'end' | 'between';

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: SpaceStep | undefined;
  readonly align?: LayoutAlign | undefined;
}

/** Empilement vertical avec espacement issu des tokens. */
export function Stack({ gap = 4, align = 'stretch', className, children, ...rest }: StackProps) {
  return (
    <div
      {...rest}
      className={cx(styles.stack, styles[`gap${gap}`], styles[`align${align}`], className)}
    >
      {children}
    </div>
  );
}

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: SpaceStep | undefined;
  readonly align?: LayoutAlign | undefined;
  readonly justify?: LayoutJustify | undefined;
  readonly wrap?: boolean | undefined;
}

/** Rangée horizontale avec espacement issu des tokens. */
export function Inline({
  gap = 2,
  align = 'center',
  justify = 'start',
  wrap = false,
  className,
  children,
  ...rest
}: InlineProps) {
  return (
    <div
      {...rest}
      className={cx(
        styles.inline,
        styles[`gap${gap}`],
        styles[`align${align}`],
        styles[`justify${justify}`],
        wrap && styles.wrap,
        className,
      )}
    >
      {children}
    </div>
  );
}
