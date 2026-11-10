import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress, ProgressCodec, ProgressError } from '@/domain/progress/types';
import { readProgressWithRaw } from '@/application/progress/loadProgress';
import type { ProgressLoadResult } from '@/domain/progress/types';
import type { AppServices } from './types';

/**
 * Lecture et écriture de la progression persistée, pour les cas d'usage.
 *
 * La lecture **délègue au lecteur unique** `readProgressWithRaw`
 * (`@/application/progress/loadProgress`), qui décode, applique le repli v0 et
 * **sauvegarde la donnée illisible** sous `aron36.progress.corrupt.*`. Il n'y a
 * qu'un seul chemin de lecture : le chemin branché (`hydrate`, dépôt des cas
 * d'usage) hérite donc de la sauvegarde de corruption (revue Phase 3, majeur A4).
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

/** Lit la progression via le lecteur unique (décodage, v0, sauvegarde). */
export function readPersistedProgress(
  services: AppServices,
  codec: ProgressCodec,
): PersistedProgressRead {
  return readProgressWithRaw({ storage: services.storage, clock: services.clock, codec });
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
