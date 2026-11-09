import type { RandomSeed } from '@/domain/shared/types';

/**
 * Port d'aléa déterministe.
 *
 * Une session enregistre sa graine. Rejouer la même graine avec une nouvelle
 * instance de port produit exactement la même séquence : les plans de session
 * sont reproductibles en test et en production.
 *
 * Invariants :
 * - `nextFloat()` ∈ [0, 1) ;
 * - `nextInt(min, max)` ∈ [min, max), et lève si la plage est vide ;
 * - `shuffle` ne modifie jamais le tableau reçu ;
 * - chaque appel consomme la séquence, dans un ordre documenté par
 *   l'implémentation (Fisher-Yates).
 */
export interface RandomPort {
  /** Graine ayant initialisé ce port, recopiée dans le plan de session. */
  readonly seed: RandomSeed;
  nextFloat(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
  shuffle<T>(items: readonly T[]): readonly T[];
}
