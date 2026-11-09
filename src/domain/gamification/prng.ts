import type { RandomSeed } from '@/domain/shared/types';

/**
 * Générateur pseudo-aléatoire **pur** et **déterministe** (mulberry32).
 *
 * Le domaine n'a pas le droit d'appeler `Math.random()` (règle ESLint) : les
 * quêtes quotidiennes doivent être reproductibles après un rechargement, donc
 * dérivées d'une graine. Ce module n'a aucune dépendance : deux instances
 * créées depuis la même graine produisent exactement la même séquence.
 *
 * Contrepartie assumée : mulberry32 n'est **pas** cryptographiquement sûr. Il
 * ne sert qu'à mélanger des listes de contenu pédagogique, jamais à produire un
 * secret.
 */

/** Générateur seedé, à usage interne du domaine. */
export interface Prng {
  /** Graine d'origine, recopiée pour l'audit et les tests. */
  readonly seed: RandomSeed;
  /** Flottant dans `[0, 1)`. */
  nextFloat(): number;
  /** Entier dans `[0, maxExclusive)`. Lève si la borne est nulle ou négative. */
  nextInt(maxExclusive: number): number;
  /** Copie mélangée (Fisher-Yates) ; le tableau reçu n'est jamais modifié. */
  shuffle<T>(items: readonly T[]): readonly T[];
}

/** Constante FNV-1a 32 bits (offset basis). */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** Constante FNV-1a 32 bits (prime). */
const FNV_PRIME = 0x01000193;

/**
 * Hachage FNV-1a d'une graine textuelle vers un entier non signé 32 bits.
 *
 * Transforme une graine lisible (`session-2024-01-01`) en état initial du
 * générateur, sans dépendre de l'horloge ni de l'environnement.
 */
export function hashSeed(seed: RandomSeed): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Implémentation de mulberry32 : état 32 bits, sortie 32 bits, période 2^32.
 * Algorithme volontairement court et entièrement arithmétique (aucun `Date`,
 * aucun `Math.random`).
 */
function mulberry32(state: number): () => number {
  let accumulator = state >>> 0;
  return (): number => {
    accumulator = (accumulator + 0x6d2b79f5) >>> 0;
    let mixed = accumulator;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Crée un générateur déterministe à partir d'une graine.
 *
 * Contrat : `createPrng(seed)` rejoué donne la même séquence d'appels. Toute
 * consommation (`nextFloat`, `nextInt`, `shuffle`) avance l'état, dans un ordre
 * documenté par l'appelant.
 */
export function createPrng(seed: RandomSeed): Prng {
  const next = mulberry32(hashSeed(seed));

  return {
    seed,
    nextFloat: next,
    nextInt(maxExclusive: number): number {
      if (!(maxExclusive > 0)) {
        throw new RangeError('nextInt : la borne exclusive doit être strictement positive.');
      }
      return Math.floor(next() * maxExclusive);
    },
    shuffle<T>(items: readonly T[]): readonly T[] {
      const remaining = [...items];
      const shuffled: T[] = [];
      while (remaining.length > 0) {
        const index = Math.floor(next() * remaining.length);
        const picked = remaining.splice(index, 1);
        shuffled.push(...picked);
      }
      return shuffled;
    },
  };
}
