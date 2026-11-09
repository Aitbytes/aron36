import type { SpeechPort } from '@/application/ports/SpeechPort';
import type { RandomSeed } from '@/domain/shared/types';
import type { ClockPort, IdPort, RandomPort, StoragePort } from '@/application/ports';
import { SystemClock } from './clock/SystemClock';
import { CryptoIdPort } from './ids/CryptoIdPort';
import { createSeededRandom } from './random/SeededRandomPort';
import { LocalStorageAdapter } from './storage/LocalStorageAdapter';
import { NullSpeechPort } from './speech/NullSpeechPort';
import { WebSpeechPort } from './speech/WebSpeechPort';

export { SystemClock, type SystemClockOptions } from './clock/SystemClock';
export { CryptoIdPort, type CryptoIdPortOptions } from './ids/CryptoIdPort';
export { SeededRandomPort, createSeededRandom } from './random/SeededRandomPort';
export {
  LocalStorageAdapter,
  type LocalStorageAdapterOptions,
} from './storage/LocalStorageAdapter';
export { MemoryStorageAdapter, type MemoryStorageOptions } from './storage/MemoryStorageAdapter';
export { WebSpeechPort } from './speech/WebSpeechPort';
export { NullSpeechPort } from './speech/NullSpeechPort';

/** Configuration de la composition racine (toutes les options sont facultatives). */
export interface InfrastructureConfig {
  /** Fuseau IANA de l'horloge (ex. `Europe/Paris`). Défaut : fuseau du système. */
  readonly timeZone?: string | undefined;
  /** `Storage` navigateur à envelopper. Défaut : `globalThis.localStorage` ; `null` force l'indisponibilité. */
  readonly storage?: Storage | null | undefined;
  /** Port de stockage déjà adapté (tests, repli mémoire) : prioritaire sur `storage`. */
  readonly storagePort?: StoragePort | undefined;
}

/**
 * Ensemble des adaptateurs concrets, prêt à injecter dans les cas d'usage.
 *
 * `createRandom` renvoie une **nouvelle** instance à chaque appel (ADR 0008 :
 * une instance par session, pour ne pas décaler la séquence consommée).
 */
export interface Infrastructure {
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly speech: SpeechPort;
  readonly createRandom: (seed: RandomSeed) => RandomPort;
}

/** Port vocal selon les capacités réelles du navigateur (jamais bloquant). */
export function createSpeechPort(): SpeechPort {
  return new WebSpeechPort().isAvailable() ? new WebSpeechPort() : new NullSpeechPort();
}

/** Fabrique unique de l'infrastructure — le seul endroit où `localStorage`, `crypto` et l'horloge système sont assemblés. */
export function createInfrastructure(config: InfrastructureConfig = {}): Infrastructure {
  return {
    storage: config.storagePort ?? new LocalStorageAdapter({ storage: config.storage }),
    clock:
      config.timeZone === undefined
        ? new SystemClock()
        : new SystemClock({ timeZone: config.timeZone }),
    ids: new CryptoIdPort(),
    speech: createSpeechPort(),
    createRandom: createSeededRandom,
  };
}
