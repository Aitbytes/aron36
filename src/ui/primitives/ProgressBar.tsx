import { cx } from './classNames';
import styles from './ProgressBar.module.css';

export type ProgressTone = 'accent' | 'success' | 'act1' | 'act2' | 'act3';

export interface ProgressBarProps {
  /** Valeur courante, bornée à `[0, max]`. */
  readonly value: number;
  readonly max?: number | undefined;
  /** Libellé accessible de la barre (`aria-label`). */
  readonly label: string;
  readonly tone?: ProgressTone | undefined;
  readonly className?: string | undefined;
}

/**
 * Barre de progression accessible.
 *
 * La valeur est bornée avant affichage : `aria-valuenow` reste toujours dans
 * `[aria-valuemin, aria-valuemax]`, y compris sur un ratio légèrement hors
 * bornes. La couleur n'est jamais le seul indicateur : la valeur est annoncée.
 */
export function ProgressBar({
  value,
  max = 1,
  label,
  tone = 'accent',
  className,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.min(safeMax, Math.max(0, value));
  const percent = (clamped / safeMax) * 100;
  // `inline-size` n'accepte pas d'espace avant le `%` : `0 %` est une déclaration
  // invalide, silencieusement ignorée, et le remplissage reprend 100 % de largeur.
  // D'où deux formes : une pour le style, une pour le texte accessible.
  const percentStyle = `${String(percent)}%`;
  const percentLabel = `${String(Math.round(percent))} %`;

  return (
    <div
      className={cx(styles.track, className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={percentLabel}
    >
      <div className={cx(styles.fill, styles[tone])} style={{ inlineSize: percentStyle }} />
    </div>
  );
}
