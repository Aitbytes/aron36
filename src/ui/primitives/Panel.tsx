import { useId } from 'react';
import type { ReactNode } from 'react';

import { cx } from './classNames';
import styles from './Panel.module.css';

export interface PanelProps {
  /** Titre affiché et référencé par `aria-labelledby`. */
  readonly title: string;
  /** Niveau de titre : `h2` par défaut (un `h1` par écran, hiérarchie continue). */
  readonly titleAs?: 'h2' | 'h3' | undefined;
  /** Contenu optionnel aligné à droite du titre (compteur, action). */
  readonly actions?: ReactNode | undefined;
  readonly children?: ReactNode | undefined;
  readonly className?: string | undefined;
}

/**
 * Section titrée : le conteneur des blocs de contenu (accueil, écrans).
 * Le titre porte l'identité accessible de la section.
 */
export function Panel({ title, titleAs = 'h2', actions, children, className }: PanelProps) {
  const titleId = useId();
  const Heading = titleAs === 'h3' ? 'h3' : 'h2';
  return (
    <section className={cx(styles.panel, className)} aria-labelledby={titleId}>
      <div className={styles.header}>
        <Heading id={titleId} className={styles.title}>
          {title}
        </Heading>
        {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
      </div>
      {children === undefined ? null : <div className={styles.body}>{children}</div>}
    </section>
  );
}
