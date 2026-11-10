import { forwardRef } from 'react';

import { Button } from './Button';
import type { ButtonProps, ButtonSize, ButtonVariant } from './Button';
import { cx } from './classNames';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'leadingIcon' | 'block'> {
  /** Libellé accessible **obligatoire** : un bouton icône n'a pas de texte visible. */
  readonly label: string;
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  /** Contenu visuel décoratif (SVG `aria-hidden` ou émoji sobre). */
  readonly children: ButtonProps['children'];
}

/** Bouton icône : `aria-label` obligatoire, cible tactile conservée. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', children, className, ...rest },
  ref,
) {
  return (
    <Button
      {...rest}
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      className={cx(styles.icon, className)}
    >
      <span aria-hidden="true">{children}</span>
    </Button>
  );
});
