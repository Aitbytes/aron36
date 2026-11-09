import type { LocalizedText } from '@/domain/shared/types';
import type { LevelCalculator, LevelCurve, LevelState, XpAmount } from './types';
import { LEVEL_TITLES } from './types';

/**
 * Courbe de niveaux (L8).
 *
 * `XP(L) = baseXp × (L − 1) × L`, soit 100 XP (niveau 2), 300 (3), 600 (4)…
 * Niveau maximal : 36. Au-delà, l'XP continue de s'accumuler sans nouveau
 * palier : aucune progression n'est jamais perdue, donc aucune punition.
 */

/**
 * XP cumulée requise pour atteindre `level`.
 *
 * Le niveau est borné à `[1, curve.maxLevel]` : `thresholdFor(0)` et
 * `thresholdFor(1)` valent 0, et tout niveau au-delà du maximum renvoie le
 * seuil du niveau maximal (dernier palier atteignable).
 */
export function thresholdFor(level: number, curve: LevelCurve): XpAmount {
  const clamped = Math.min(Math.max(1, Math.floor(level)), curve.maxLevel);
  return curve.baseXp * (clamped - 1) * clamped;
}

/** Titre affiché pour un niveau : dernier palier dont `minLevel` est atteint. */
export function titleForLevel(level: number): LocalizedText {
  let title: LocalizedText = LEVEL_TITLES[0].title;
  for (const entry of LEVEL_TITLES) {
    if (level >= entry.minLevel) {
      title = entry.title;
    }
  }
  return title;
}

/** Borne un ratio dans `[0, 1]` (le contrat `Ratio` l'exige). */
function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Niveau et progression pour une XP cumulée.
 *
 * `progressRatio` vaut 1 au niveau maximal (palier terminal, barre pleine) et
 * reste toujours dans `[0, 1]`. `xpIntoLevel` n'est jamais négatif.
 */
export function levelFor(totalXp: XpAmount, curve: LevelCurve): LevelState {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  while (level < curve.maxLevel && xp >= thresholdFor(level + 1, curve)) {
    level += 1;
  }

  const currentThreshold = thresholdFor(level, curve);
  const xpIntoLevel = xp - currentThreshold;
  const atMaxLevel = level >= curve.maxLevel;
  const nextLevelXp = atMaxLevel ? null : thresholdFor(level + 1, curve);
  const xpToNextLevel = nextLevelXp === null ? null : nextLevelXp - xp;
  const span = nextLevelXp === null ? 0 : nextLevelXp - currentThreshold;

  return {
    level,
    xpIntoLevel,
    xpToNextLevel,
    nextLevelXp,
    progressRatio: span <= 0 ? 1 : clampRatio(xpIntoLevel / span),
    title: titleForLevel(level),
  };
}

/** Calcul de niveau pur, dérivé de `LEVEL_CURVE` fourni par l'appelant. */
export const levelCalculator: LevelCalculator = { levelFor, thresholdFor };
