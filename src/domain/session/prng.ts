import type { RandomSeed } from '@/domain/shared/types';

/**
 * Générateur pseudo-aléatoire déterministe du moteur de session (L4, L16, L18).
 *
 * Le domaine ne touche jamais `Math.random` : toute part d'aléa d'une session
 * provient de `request.seed`, recopiée dans le plan. Rejouer la même graine
 * avec le même `SessionBuildContext` produit exactement le même plan.
 *
 * L'implémentation est volontairement minimale et stable :
 * - hachage de la graine par FNV-1a 32 bits ;
 * - générateur mulberry32 ;
 * - mélange Fisher-Yates, du dernier index vers le premier.
 *
 * Aucune dépendance, aucun accès à l'horloge : le fichier est pur.
 */
export interface Prng {
  /** Graine ayant initialisé ce générateur. */
  readonly seed: RandomSeed;
  /** Réel dans `[0, 1)`. */
  nextFloat(): number;
  /**
   * Entier dans `[minInclusive, maxExclusive)`.
   * Lève si la plage est vide (`maxExclusive <= minInclusive`).
   */
  nextInt(minInclusive: number, maxExclusive: number): number;
  /** Renvoie une permutation du tableau reçu sans jamais le modifier. */
  shuffle<T>(items: readonly T[]): readonly T[];
}

/** Hachage FNV-1a 32 bits : déterministe, sans état global. */
function hashSeed(seed: RandomSeed): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 : générateur 32 bits, période 2^32, séquence documentée. */
function mulberry32(state: number): () => number {
  let accumulator = state >>> 0;
  return () => {
    accumulator = (accumulator + 0x6d2b79f5) | 0;
    let value = accumulator;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Crée un générateur reproductible à partir d'une graine de session. */
export function createPrng(seed: RandomSeed): Prng {
  const nextFloat = mulberry32(hashSeed(seed));

  const nextInt = (minInclusive: number, maxExclusive: number): number => {
    if (!Number.isFinite(minInclusive) || !Number.isFinite(maxExclusive)) {
      throw new Error('createPrng : bornes non finies.');
    }
    if (maxExclusive <= minInclusive) {
      throw new Error('createPrng : plage vide.');
    }
    return minInclusive + Math.floor(nextFloat() * (maxExclusive - minInclusive));
  };

  return {
    seed,
    nextFloat,
    nextInt,
    shuffle<T>(items: readonly T[]): readonly T[] {
      const result = items.slice();
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swapWith = nextInt(0, index + 1);
        const current = result[index];
        const target = result[swapWith];
        if (current === undefined || target === undefined) {
          continue;
        }
        result[index] = target;
        result[swapWith] = current;
      }
      return result;
    },
  };
}
