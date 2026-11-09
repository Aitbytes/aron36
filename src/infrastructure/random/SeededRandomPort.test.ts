import { describe, expect, it } from 'vitest';

import { createPrng } from '@/domain/shared/prng';
import { SeededRandomPort, createSeededRandom } from './SeededRandomPort';

describe('SeededRandomPort', () => {
  it('produit la même séquence pour la même graine', () => {
    const first = createSeededRandom('graine-de-test');
    const second = createSeededRandom('graine-de-test');
    for (let index = 0; index < 20; index += 1) {
      expect(first.nextFloat()).toBe(second.nextFloat());
    }
    expect(first.seed).toBe('graine-de-test');
  });

  it('diverge dès que la graine change', () => {
    const first = createSeededRandom('graine-a');
    const second = createSeededRandom('graine-b');
    const floatsA = Array.from({ length: 10 }, () => first.nextFloat());
    const floatsB = Array.from({ length: 10 }, () => second.nextFloat());
    expect(floatsA).not.toEqual(floatsB);
  });

  it('reste dans [0, 1) sur un grand nombre de tirages', () => {
    const port = createSeededRandom('bornes');
    for (let index = 0; index < 500; index += 1) {
      const value = port.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('borne nextInt sur [min, max) et lève sur une plage vide', () => {
    const port = createSeededRandom('entiers');
    for (let index = 0; index < 100; index += 1) {
      const value = port.nextInt(3, 9);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(9);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(() => port.nextInt(5, 5)).toThrow(RangeError);
    expect(() => port.nextInt(9, 3)).toThrow(RangeError);
    expect(() => port.nextInt(0.5, 3)).toThrow(RangeError);
  });

  it('mélange sans muter l’entrée et de façon reproductible', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const port = createSeededRandom('melange');
    const first = port.shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(first).not.toBe(items);
    expect([...first].sort((a, b) => a - b)).toEqual(items);
    const replayed = createSeededRandom('melange').shuffle(items);
    expect(replayed).toEqual(first);
  });

  it('consomme exactement n − 1 tirages par mélange (Fisher–Yates descendant)', () => {
    const seed = 'consommation';
    const port = new SeededRandomPort(seed);
    port.shuffle([1, 2, 3, 4, 5]);
    // Un PRNG de référence, avancé de 4 valeurs (n − 1 = 4)…
    const reference = createPrng(seed);
    for (let index = 0; index < 4; index += 1) {
      reference.nextFloat();
    }
    // …doit retomber exactement sur la valeur suivante du port.
    const expected = Math.floor(reference.nextFloat() * 10);
    expect(port.nextInt(0, 10)).toBe(expected);
  });

  it('fournit une nouvelle instance par appel de fabrique', () => {
    const first = createSeededRandom('fabrique');
    first.nextFloat();
    const second = createSeededRandom('fabrique');
    const secondFirst = second.nextFloat();
    expect(secondFirst).toBe(createSeededRandom('fabrique').nextFloat());
    // `first` a déjà consommé un tirage : sa valeur suivante diffère.
    expect(first.nextFloat()).not.toBe(secondFirst);
  });
});
