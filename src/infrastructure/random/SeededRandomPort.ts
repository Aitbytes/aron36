import type { RandomPort } from '@/application/ports/RandomPort';
import { createPrng, type Prng } from '@/domain/shared/prng';
import type { RandomSeed } from '@/domain/shared/types';

/**
 * `RandomPort` déterministe, seedé (ADR 0008).
 *
 * Réutilise le PRNG **pur du domaine** (`@/domain/shared/prng`, mulberry32 +
 * FNV-1a) : aucune seconde implémentation, une seule source de vérité. Le port
 * ajoute le contrat applicatif (`nextInt(min, max)` à deux bornes) et le
 * mélange spécifié par l'architecture : **Fisher–Yates, de `i = n − 1` à `1`,
 * avec `nextInt(0, i + 1)`**.
 *
 * Rappel du contrat : une **nouvelle instance par session** — réutiliser une
 * instance après d'autres appels décale la séquence.
 */
export class SeededRandomPort implements RandomPort {
  readonly seed: RandomSeed;

  private readonly prng: Prng;

  constructor(seed: RandomSeed) {
    this.seed = seed;
    this.prng = createPrng(seed);
  }

  nextFloat(): number {
    return this.prng.nextFloat();
  }

  /**
   * Entier dans `[minInclusive, maxExclusive)`. Lève (`RangeError`) si la plage
   * est vide ou si les bornes ne sont pas des entiers, comme le spécifie le
   * port : une plage vide est un bug d'appelant, pas une donnée externe.
   */
  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new RangeError('nextInt : les bornes doivent être des entiers.');
    }
    if (maxExclusive <= minInclusive) {
      throw new RangeError(`nextInt : plage vide [${minInclusive}, ${maxExclusive}).`);
    }
    return this.prng.nextInt(maxExclusive - minInclusive) + minInclusive;
  }

  /**
   * Copie mélangée ; le tableau reçu n'est jamais modifié. Consomme exactement
   * `max(0, n − 1)` tirages, dans l'ordre documenté (Fisher–Yates descendant).
   */
  shuffle<T>(items: readonly T[]): readonly T[] {
    const copy = [...items];
    for (let index = copy.length - 1; index >= 1; index -= 1) {
      const target = this.nextInt(0, index + 1);
      const current = copy[index];
      const swapped = copy[target];
      if (current === undefined || swapped === undefined) {
        continue;
      }
      copy[index] = swapped;
      copy[target] = current;
    }
    return copy;
  }
}

/** Fabrique : une nouvelle instance par appel (contrat du port). */
export function createSeededRandom(seed: RandomSeed): RandomPort {
  return new SeededRandomPort(seed);
}
