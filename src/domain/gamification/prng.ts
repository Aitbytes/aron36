/**
 * Ré-export du PRNG unique du domaine (`@/domain/shared/prng`).
 *
 * Ce fichier ne contient plus d'implémentation : deux copies de mulberry32
 * pouvaient diverger. Les noms exportés (`Prng`, `createPrng`, `hashSeed`) sont
 * conservés pour que le module `gamification` et ses consommateurs n'aient rien
 * à changer.
 */
export { createPrng, hashSeed } from '@/domain/shared/prng';
export type { Prng } from '@/domain/shared/prng';
