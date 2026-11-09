import { describe, expect, it } from 'vitest';

import { createPrng } from './prng';

describe('prng — aléa déterministe de session', () => {
  it('reproduit exactement la même séquence pour une graine identique', () => {
    const first = createPrng('graine-alpha');
    const second = createPrng('graine-alpha');
    const firstSequence = Array.from({ length: 12 }, () => first.nextFloat());
    const secondSequence = Array.from({ length: 12 }, () => second.nextFloat());
    expect(firstSequence).toEqual(secondSequence);
    expect(first.seed).toBe('graine-alpha');
  });

  it('produit des séquences différentes pour des graines différentes', () => {
    const first = Array.from({ length: 8 }, () => createPrng('graine-alpha').nextFloat());
    const second = Array.from({ length: 8 }, () => createPrng('graine-beta').nextFloat());
    expect(first).not.toEqual(second);
  });

  it('borne nextInt à [min, max) et renvoie des entiers', () => {
    const prng = createPrng('bornes');
    for (let draw = 0; draw < 200; draw += 1) {
      const value = prng.nextInt(3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(7);
    }
  });

  it('refuse une plage vide ou des bornes non finies', () => {
    const prng = createPrng('vide');
    expect(() => prng.nextInt(4, 4)).toThrow();
    expect(() => prng.nextInt(9, 2)).toThrow();
    expect(() => prng.nextInt(Number.NaN, 3)).toThrow();
    expect(() => prng.nextInt(0, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('mélange aussi des tableaux contenant des éléments indéfinis', () => {
    const result = createPrng('indefini').shuffle([undefined, 1, undefined, 2, undefined]);
    expect(result).toHaveLength(5);
    expect(result.filter((value) => value === undefined)).toHaveLength(3);
  });

  it('mélange sans muter le tableau reçu, de façon reproductible', () => {
    const source = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const first = createPrng('melange').shuffle(source);
    const second = createPrng('melange').shuffle(source);
    expect(first).toEqual(second);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...first].sort((left, right) => left - right)).toEqual([...source]);
    expect(first).toHaveLength(source.length);
  });
});
