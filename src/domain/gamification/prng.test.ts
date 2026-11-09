import { describe, expect, it } from 'vitest';

import { createPrng, hashSeed } from './prng';

/**
 * Anti-objectif « pas de hasard implicite » : le domaine ne doit jamais appeler
 * `Math.random()`. Le PRNG est donc seedé, reproductible et testable.
 */
describe('prng — mulberry32 seedé', () => {
  it('produit la même séquence pour une même graine', () => {
    const left = createPrng('aron36');
    const right = createPrng('aron36');
    const leftSequence = [left.nextFloat(), left.nextFloat(), left.nextFloat(), left.nextFloat()];
    const rightSequence = [
      right.nextFloat(),
      right.nextFloat(),
      right.nextFloat(),
      right.nextFloat(),
    ];
    expect(leftSequence).toEqual(rightSequence);
    expect(left.seed).toBe('aron36');
  });

  it('produit des séquences différentes pour des graines différentes', () => {
    const left = createPrng('graine-a');
    const right = createPrng('graine-b');
    expect([left.nextFloat(), left.nextFloat()]).not.toEqual([
      right.nextFloat(),
      right.nextFloat(),
    ]);
  });

  it('borne nextFloat à [0, 1)', () => {
    const prng = createPrng('bornes');
    for (let index = 0; index < 500; index += 1) {
      const value = prng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('borne nextInt à [0, maxExclusive) et reste déterministe', () => {
    const left = createPrng('tirage');
    const right = createPrng('tirage');
    for (let index = 0; index < 200; index += 1) {
      const value = left.nextInt(3);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(3);
      expect(value).toBe(right.nextInt(3));
    }
  });

  it('refuse une borne exclusive nulle ou négative', () => {
    const prng = createPrng('invalide');
    expect(() => prng.nextInt(0)).toThrow(RangeError);
    expect(() => prng.nextInt(-1)).toThrow(RangeError);
  });

  it('mélange sans modifier la liste reçue et sans perdre d’élément', () => {
    const source = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const shuffled = createPrng('melange').shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(createPrng('melange').shuffle(source)).toEqual(shuffled);
  });

  it('mélange une liste vide ou à un élément sans erreur', () => {
    const prng = createPrng('vide');
    expect(prng.shuffle([])).toEqual([]);
    expect(prng.shuffle(['seul'])).toEqual(['seul']);
  });

  it('hache une graine de façon stable et non signée', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('aron36')).toBe(hashSeed('aron36'));
    expect(hashSeed('aron36')).not.toBe(hashSeed('aron37'));
    expect(hashSeed('aron36')).toBeGreaterThanOrEqual(0);
  });
});
