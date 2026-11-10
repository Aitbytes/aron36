import type { SessionSummary } from '@/domain/session/types';
import type { DurationMs, Ratio } from '@/domain/shared/types';

/**
 * Critères du Grand Oral (P5-B) — source unique des seuils de l'examen final.
 *
 * Le verdict n'est **jamais** recalculé dans le JSX : l'écran passe le
 * `SessionSummary` produit par le cas d'usage `finishSession` à
 * `evaluateGrandOral`, et n'affiche que le résultat. Tous les seuils sont des
 * constantes nommées, donc testables et modifiables en un seul endroit.
 *
 * Rapport au PLAN (`docs/PLAN.md`, « Métrique de succès ») :
 * - **Diamant** est le seul palier entièrement mesurable en Grand Oral :
 *   « réciter à l'oral, en ≤ 6 min » (`GRAND_ORAL_MAX_DURATION_MS`) avec la
 *   précision exigée par les autres paliers (`GRAND_ORAL_PASS_ACCURACY`, 90 %).
 * - **Or**, **Argent** et **Bronze** dépendent de tests séparés dans le PLAN
 *   (drill mot-clé/image, drill numéroté, récitation libre écrite) : ils ne
 *   sont pas reproductibles dans une session chronométrée. L'échelle retenue
 *   les utilise donc comme **degrés mesurables** du même examen, du plus haut
 *   au plus bas : Diamant (réussi), Or (précision atteinte mais trop lent),
 *   Argent (précision ≥ 80 %), Bronze (examen mené à son terme).
 *
 * Le nombre de jours sans révision (« après 7 jours ») n'est pas vérifiable
 * ici : l'examen mesure une performance, pas la rétention différée.
 */

/** Palier atteint à l'issue de l'examen, du plus élevé au plus faible. */
export type GrandOralTier = 'diamond' | 'gold' | 'silver' | 'bronze';

/** Cause d'échec mesurable, affichée telle quelle dans le bilan. */
export type GrandOralFailureCause = 'duration' | 'accuracy';

/** Durée maximale du Grand Oral (PLAN, palier Diamant) : six minutes. */
export const GRAND_ORAL_MAX_DURATION_MS: DurationMs = 6 * 60 * 1000;

/** Précision minimale de réussite (PLAN, paliers Argent/Or) : 90 %. */
export const GRAND_ORAL_PASS_ACCURACY: Ratio = 0.9;

/** Précision minimale du palier Argent : la majorité des questions restituées. */
export const GRAND_ORAL_SILVER_ACCURACY: Ratio = 0.8;

/** Nombre d'items d'un Grand Oral complet : les 36 questions d'Aron. */
export const GRAND_ORAL_ITEM_COUNT = 36;

/** Verdict du Grand Oral, entièrement dérivé du résumé de session. */
export interface GrandOralOutcome {
  readonly passed: boolean;
  readonly tier: GrandOralTier;
  readonly durationMs: DurationMs;
  readonly accuracy: Ratio;
  readonly itemCount: number;
  /** Vide en cas de réussite ; au moins une cause sinon. */
  readonly failureCauses: readonly GrandOralFailureCause[];
}

/**
 * Verdict de l'examen : réussite si la durée **et** la précision tiennent,
 * palier et causes d'échec dérivés des deux mêmes mesures.
 */
export function evaluateGrandOral(summary: SessionSummary): GrandOralOutcome {
  const slow = summary.durationMs > GRAND_ORAL_MAX_DURATION_MS;
  const inaccurate = summary.accuracy < GRAND_ORAL_PASS_ACCURACY;
  const passed = !slow && !inaccurate;

  const failureCauses: GrandOralFailureCause[] = [];
  if (slow) {
    failureCauses.push('duration');
  }
  if (inaccurate) {
    failureCauses.push('accuracy');
  }

  return {
    passed,
    tier: tierFor(passed, summary.accuracy),
    durationMs: summary.durationMs,
    accuracy: summary.accuracy,
    itemCount: summary.itemCount,
    failureCauses,
  };
}

/** Palier atteint : Diamant si réussi, sinon dégradé selon la précision. */
function tierFor(passed: boolean, accuracy: Ratio): GrandOralTier {
  if (passed) {
    return 'diamond';
  }
  if (accuracy >= GRAND_ORAL_PASS_ACCURACY) {
    return 'gold';
  }
  if (accuracy >= GRAND_ORAL_SILVER_ACCURACY) {
    return 'silver';
  }
  return 'bronze';
}

/** Deux chiffres, zéro-padded (`7` → `07`). */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Formate une durée en `mm:ss` (chronomètre et cause d'échec).
 *
 * La valeur est toujours positive et bornée à zéro : un brouillage d'horloge ne
 * doit jamais afficher `-01:00`.
 */
export function formatElapsed(ms: DurationMs): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`;
}
