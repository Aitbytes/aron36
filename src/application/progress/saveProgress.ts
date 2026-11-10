import type { StoragePort, ClockPort } from '@/application/ports';
import type { StorageFailure } from '@/application/ports/StoragePort';
import {
  STORAGE_KEY,
  type PersistedProgress,
  type ProgressCodec,
  type ProgressError,
} from '@/domain/progress/types';
import { progressCodec } from './codec';

/**
 * Écriture de la progression (ADR 0004).
 *
 * `savedAt` provient **toujours** du `ClockPort` (jamais du domaine), puis
 * l'état est encodé et écrit en une seule opération sur la clé unique. Un
 * échec de support (quota, mode privé) est un **résultat** typé : la session
 * en cours continue en mémoire, l'UI proposera l'export.
 */
export interface SaveProgressDeps {
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  /** Codec injectable (tests) ; défaut : codec standard de l'application. */
  readonly codec?: ProgressCodec | undefined;
}

/** Résultat explicite d'une sauvegarde, jamais une exception. */
export type ProgressSaveResult =
  | { readonly ok: true; readonly progress: PersistedProgress; readonly savedAt: number }
  | { readonly ok: false; readonly error: ProgressError };

export function saveProgress(
  deps: SaveProgressDeps,
  progress: PersistedProgress,
): ProgressSaveResult {
  const codec = deps.codec ?? progressCodec;
  const savedAt = deps.clock.now();
  const stamped: PersistedProgress = { ...progress, savedAt };
  const write = deps.storage.write(STORAGE_KEY, codec.encode(stamped));
  if (!write.ok) {
    return { ok: false, error: storageFailureToError(write.failure) };
  }
  return { ok: true, progress: stamped, savedAt };
}

/** Conversion unique d'un échec `StoragePort` en `ProgressError` (taxonomie partagée). */
export function storageFailureToError(failure: StorageFailure): ProgressError {
  return { code: failure.code, message: failure.message, details: null };
}
