import { STORAGE_CORRUPT_BACKUP_PREFIX } from '@/domain/progress/types';
import type { PersistedProgress, ProgressCodec, ProgressError } from '@/domain/progress/types';
import type { EpochMs } from '@/domain/shared/types';

import { readPersistedProgress, writeProgress } from './progress-loader';
import { UseCaseRejection } from './errors';
import type { AppServices } from './types';

/**
 * Dépôt de progression des cas d'usage.
 *
 * Les cas d'usage ne reçoivent pas le store (contrat `AppServices` gelé) : ce
 * dépôt est leur copie de travail locale. Il charge la progression **une**
 * fois (au premier accès), applique chaque mutation en mémoire et persiste
 * immédiatement (`savedAt` tamponné par `ClockPort`). La Phase 4 maintiendra
 * le store aligné en dispatchant soit les actions granulaires (les deltas du
 * réducteur sont identiques), soit `progress/replaced` avec
 * `updatedProgress`.
 *
 * Garanties :
 * - une donnée `future-version` ou illisible n'est **jamais** écrasée :
 *   `requireProgress` refuse (`progress-unavailable`) tant qu'un chemin de
 *   récupération explicite (import, réinitialisation) n'a pas eu lieu ;
 * - un échec d'écriture est non fatal : l'état mémoire reste la référence et
 *   `lastWriteFailure()` expose l'erreur pour l'UI (`progress/error`).
 */
export interface ProgressRepository {
  /** Charge (une fois) puis renvoie l'état, ou l'erreur bloquante. */
  ensureLoaded():
    | { readonly status: 'ready'; readonly progress: PersistedProgress }
    | { readonly status: 'blocked'; readonly error: ProgressError };
  /** État prêt, sinon rejet `progress-unavailable` (appelant fautif). */
  requireProgress(): PersistedProgress;
  /** Tamponne `savedAt` via l'horloge, met en cache et écrit. */
  save(next: PersistedProgress): PersistedProgress;
  /** Copie la donnée illisible avant un écrasement explicite (reset). */
  backupCorruptRaw(): void;
  /** Dernier échec d'écriture, ou `null`. */
  lastWriteFailure(): ProgressError | null;
}

/** Crée le dépôt lié aux services et au codec injectés. */
export function createProgressRepository(
  services: AppServices,
  codec: ProgressCodec,
  createInitial: (locale: 'fr' | 'en') => PersistedProgress,
): ProgressRepository {
  type Cache =
    | { readonly status: 'ready'; readonly progress: PersistedProgress }
    | { readonly status: 'blocked'; readonly error: ProgressError }
    | { readonly status: 'blocked-corrupt'; readonly error: ProgressError };

  let cache: Cache | null = null;
  let corruptRaw: string | null = null;
  let writeFailure: ProgressError | null = null;

  function ensureLoaded():
    | { readonly status: 'ready'; readonly progress: PersistedProgress }
    | { readonly status: 'blocked'; readonly error: ProgressError } {
    if (cache === null) {
      const read = readPersistedProgress(services, codec);
      switch (read.result.status) {
        case 'loaded':
          cache = { status: 'ready', progress: read.result.progress };
          break;
        case 'empty': {
          // Premier lancement : profil neuf, écrit immédiat (le stockage était
          // vide — rien ne peut être détruit).
          const fresh = createInitial('fr');
          writeFailure = writeProgress(services, codec, fresh);
          cache = { status: 'ready', progress: fresh };
          break;
        }
        case 'future-version':
          corruptRaw = read.raw;
          cache = { status: 'blocked', error: read.result.error };
          break;
        case 'corrupt':
          corruptRaw = read.raw;
          cache = { status: 'blocked-corrupt', error: read.result.error };
          break;
      }
    }
    if (cache.status === 'ready') {
      return cache;
    }
    return { status: 'blocked', error: cache.error };
  }

  return {
    ensureLoaded,

    requireProgress(): PersistedProgress {
      const loaded = ensureLoaded();
      if (loaded.status === 'blocked') {
        throw new UseCaseRejection(
          'progress-unavailable',
          { kind: 'progress', error: loaded.error },
          `Progression indisponible (${loaded.error.code}) : passer par le chemin de récupération.`,
        );
      }
      return loaded.progress;
    },

    save(next: PersistedProgress): PersistedProgress {
      const now: EpochMs = services.clock.now();
      const stamped: PersistedProgress = { ...next, savedAt: now };
      cache = { status: 'ready', progress: stamped };
      writeFailure = writeProgress(services, codec, stamped);
      return stamped;
    },

    backupCorruptRaw(): void {
      if (corruptRaw === null || cache === null || cache.status === 'ready') {
        return;
      }
      // Sauvegarde brute avant l'écrasement **explicite** (réinitialisation) :
      // la donnée corrompue n'est jamais perdue silencieusement.
      const backupKey = `${STORAGE_CORRUPT_BACKUP_PREFIX}${String(services.clock.now())}`;
      const write = services.storage.write(backupKey, corruptRaw);
      if (!write.ok) {
        writeFailure = {
          code: write.failure.code,
          message: write.failure.message,
          details: null,
        };
      }
    },

    lastWriteFailure(): ProgressError | null {
      return writeFailure;
    },
  };
}
