import { describe, expect, it } from 'vitest';

import { levelCalculator, thresholdFor, titleForLevel } from './level';
import { LEVEL_CURVE, LEVEL_TITLES, MAX_LEVEL } from './types';

/**
 * Anti-objectif « pas de punition » : la courbe est monotone, l’XP ne redescend
 * jamais et le niveau maximal continue d’accumuler sans jamais bloquer.
 */
describe('level — courbe de niveaux', () => {
  it('place exactement les seuils du contrat', () => {
    expect(thresholdFor(1, LEVEL_CURVE)).toBe(0);
    expect(thresholdFor(2, LEVEL_CURVE)).toBe(100);
    expect(thresholdFor(3, LEVEL_CURVE)).toBe(300);
    expect(thresholdFor(4, LEVEL_CURVE)).toBe(600);
    expect(thresholdFor(5, LEVEL_CURVE)).toBe(1000);
  });

  it('borne le niveau à [1, maxLevel]', () => {
    expect(thresholdFor(0, LEVEL_CURVE)).toBe(0);
    expect(thresholdFor(-5, LEVEL_CURVE)).toBe(0);
    expect(thresholdFor(2.9, LEVEL_CURVE)).toBe(100);
    expect(thresholdFor(MAX_LEVEL + 1, LEVEL_CURVE)).toBe(thresholdFor(MAX_LEVEL, LEVEL_CURVE));
    expect(thresholdFor(1000, LEVEL_CURVE)).toBe(thresholdFor(MAX_LEVEL, LEVEL_CURVE));
  });

  it('rend la courbe strictement croissante jusqu’au niveau maximal', () => {
    for (let level = 1; level < MAX_LEVEL; level += 1) {
      expect(thresholdFor(level + 1, LEVEL_CURVE)).toBeGreaterThan(
        thresholdFor(level, LEVEL_CURVE),
      );
    }
  });

  it('dérive le niveau et la progression de l’XP cumulée', () => {
    expect(levelCalculator.levelFor(0, LEVEL_CURVE)).toMatchObject({
      level: 1,
      xpIntoLevel: 0,
      nextLevelXp: 100,
      xpToNextLevel: 100,
      progressRatio: 0,
    });
    expect(levelCalculator.levelFor(99, LEVEL_CURVE)).toMatchObject({
      level: 1,
      xpIntoLevel: 99,
      xpToNextLevel: 1,
    });
    expect(levelCalculator.levelFor(100, LEVEL_CURVE)).toMatchObject({
      level: 2,
      xpIntoLevel: 0,
      nextLevelXp: 300,
      xpToNextLevel: 200,
      progressRatio: 0,
    });
    expect(levelCalculator.levelFor(299, LEVEL_CURVE)).toMatchObject({
      level: 2,
      xpIntoLevel: 199,
      xpToNextLevel: 1,
    });
    expect(levelCalculator.levelFor(300, LEVEL_CURVE)).toMatchObject({ level: 3, xpIntoLevel: 0 });
    expect(levelCalculator.levelFor(600, LEVEL_CURVE)).toMatchObject({ level: 4, xpIntoLevel: 0 });
  });

  it('borne progressRatio à [0, 1] sur toute la plage testée', () => {
    for (let xp = 0; xp <= 2000; xp += 7) {
      const state = levelCalculator.levelFor(xp, LEVEL_CURVE);
      expect(state.progressRatio).toBeGreaterThanOrEqual(0);
      expect(state.progressRatio).toBeLessThanOrEqual(1);
      expect(state.xpIntoLevel).toBeGreaterThanOrEqual(0);
    }
  });

  it('plafonne au niveau 36 sans perdre d’XP', () => {
    const maxXp = thresholdFor(MAX_LEVEL, LEVEL_CURVE);
    const atMax = levelCalculator.levelFor(maxXp, LEVEL_CURVE);
    const farAbove = levelCalculator.levelFor(maxXp + 100_000, LEVEL_CURVE);

    expect(atMax.level).toBe(MAX_LEVEL);
    expect(atMax.nextLevelXp).toBeNull();
    expect(atMax.xpToNextLevel).toBeNull();
    expect(atMax.progressRatio).toBe(1);
    expect(farAbove.level).toBe(MAX_LEVEL);
    expect(farAbove.xpIntoLevel).toBe(100_000);
    expect(farAbove.progressRatio).toBe(1);
  });

  it('traite une XP négative comme zéro', () => {
    expect(levelCalculator.levelFor(-500, LEVEL_CURVE)).toMatchObject({
      level: 1,
      xpIntoLevel: 0,
      progressRatio: 0,
    });
  });

  it('associe les titres aux bons paliers', () => {
    expect(titleForLevel(1).fr).toBe('Novice');
    expect(titleForLevel(4).fr).toBe('Novice');
    expect(titleForLevel(5).fr).toBe('Apprenti');
    expect(titleForLevel(10).fr).toBe('Conteur');
    expect(titleForLevel(18).fr).toBe('Orateur');
    expect(titleForLevel(26).fr).toBe('Mémorialiste');
    expect(titleForLevel(36).fr).toBe('Légende');
    expect(titleForLevel(999).fr).toBe('Légende');
    expect(levelCalculator.levelFor(100, LEVEL_CURVE).title.fr).toBe('Novice');
  });

  it('couvre tous les titres déclarés par le contrat', () => {
    expect(LEVEL_TITLES).toHaveLength(6);
    for (const entry of LEVEL_TITLES) {
      expect(titleForLevel(entry.minLevel)).toEqual(entry.title);
    }
  });
});
