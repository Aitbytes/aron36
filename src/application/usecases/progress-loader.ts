import { STORAGE_KEY } from '@/domain/progress/types';
import type {
  PersistedProgress,
  ProgressCodec,
  ProgressError,
  ProgressLoadResult,
} from '@/domain/progress/types';
import type { AppServices } from './types';

/**
 * Lecture et écriture de la progression persistée.
 *
 * La taxonomie d'erreurs est **unique** (`ProgressErrorCode`) : un échec du
 * support de stockage est converti en statut `corrupt` (jamais une exception),
 * et un `future-version` n'entraîne **aucune écriture** — voir
 * `ProgressLoadResult` (`@/domain/progress/types`) et la table
 * `PROGRESS_RECOVERY_ACTIONS` gelée par la Phase 1.
 */

/** Résultat brut d'une lecture : le statut métier **et** la donnée source. */
export interface PersistedProgressRead {
  readonly result: ProgressLoadResult;
  /** Dernière chaîne lue dans le stockage, `null` si la clé était absente. */
  readonly raw: string | null;
}

/** Lit la progression sans jamais écrire ni supprimer. */
export function readPersistedProgress(
  services: AppServices,
  codec: ProgressCodec,
): PersistedProgressRead {
  const read = services.storage.read(STORAGE_KEY);
  if (!read.ok) {
    // Échec du support (quota, mode privé…) : traité comme donnée non lisible,
    // jamais comme une exception franchissant la frontière.
    return {
      result: {
        status: 'corrupt',
        error: {
          code: read.failure.code,
          message: read.failure.message,
          details: null,
        },
        backupKey: null,
      },
      raw: null,
    };
  }
  const raw = read.value;
  if (raw === null) {
    return { result: { status: 'empty' }, raw: null };
  }
  const decoded = codec.decode(raw);
  if (decoded.ok) {
    return {
      result: { status: 'loaded', progress: decoded.progress, migratedFrom: decoded.migratedFrom },
      raw,
    };
  }
  if (decoded.error.code === 'future-version') {
    return {
      result: {
        status: 'future-version',
        version: futureVersionOf(decoded.error),
        error: decoded.error,
      },
      raw,
    };
  }
  // `invalid-json`, `invalid-shape`, `unsupported-version`, `missing-migration` :
  // récupérables (import ou réinitialisation explicite), donc statut `corrupt`.
  return { result: { status: 'corrupt', error: decoded.error, backupKey: null }, raw };
}

/** Version rencontrée, extraite des détails d'erreur du décodeur. */
function futureVersionOf(error: ProgressError): number {
  const reported = error.details?.['version'];
  const parsed = reported === undefined ? Number.NaN : Number(reported);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Écrit un état complet. Renvoie `null` en cas de succès, sinon une erreur
 * explicite — l'appelant décide de l'affichage (l'état en mémoire reste à
 * jour et reste la référence des cas d'usage).
 */
export function writeProgress(
  services: AppServices,
  codec: ProgressCodec,
  progress: PersistedProgress,
): ProgressError | null {
  const encoded = codec.encode(progress);
  const write = services.storage.write(STORAGE_KEY, encoded);
  return write.ok
    ? null
    : { code: write.failure.code, message: write.failure.message, details: null };
}
