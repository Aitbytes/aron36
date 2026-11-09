import type { ClockPort, StoragePort } from '@/application/ports';
import {
  LEGACY_V0_STORAGE_KEYS,
  STORAGE_CORRUPT_BACKUP_PREFIX,
  STORAGE_KEY,
  type PersistedProgress,
  type ProgressError,
  type ProgressLoadResult,
} from '@/domain/progress/types';
import type { ProgressCodec } from '@/domain/progress/types';
import { migrateLegacyState } from './migrations';
import { progressCodec } from './codec';
import { storageFailureToError } from './saveProgress';

/**
 * Lecture + décodage de la progression (ADR 0004, ARCHITECTURE § 5.2).
 *
 * Garanties :
 * - une clé absente ⇒ `empty` (pas une erreur) ;
 * - une donnée **future** ⇒ `future-version`, et **rien n'est écrit** :
 *   ni migration, ni sauvegarde de corruption, ni réinitialisation ;
 * - toute autre corruption ⇒ la donnée brute est recopiée sous
 *   `STORAGE_CORRUPT_BACKUP_PREFIX<epochMs>` avant de renvoyer `corrupt`
 *   (aucun écrasement silencieux) ;
 * - les clés du prototype v0 sont lues une seule fois si la clé principale est
 *   absente ; une clé v0 illisible est ignorée sans être effacée ni modifiée.
 */
export interface LoadProgressDeps {
  readonly storage: StoragePort;
  readonly clock: ClockPort;
  /** Codec injectable (tests) ; défaut : codec standard de l'application. */
  readonly codec?: ProgressCodec | undefined;
}

export function loadProgress(deps: LoadProgressDeps): ProgressLoadResult {
  const codec = deps.codec ?? progressCodec;
  const read = deps.storage.read(STORAGE_KEY);
  if (!read.ok) {
    // Échec du support : rien à sauvegarder (pas de donnée brute), on remonte
    // le code storage (`read-failed` / `storage-unavailable`) tel quel.
    return { status: 'corrupt', error: storageFailureToError(read.failure), backupKey: null };
  }
  const raw = read.value;
  if (raw === null) {
    return loadFromLegacyKeys(deps, codec);
  }
  const decoded = codec.decode(raw);
  if (decoded.ok) {
    return {
      status: 'loaded',
      progress: decoded.progress,
      migratedFrom: decoded.migratedFrom,
    };
  }
  const error = decoded.error;
  if (error.code === 'future-version') {
    return { status: 'future-version', version: versionOf(error), error };
  }
  // Corruption : sauvegarde brute d'abord, résultat ensuite.
  const backupKey = `${STORAGE_CORRUPT_BACKUP_PREFIX}${deps.clock.now()}`;
  const backup = deps.storage.write(backupKey, raw);
  return { status: 'corrupt', error, backupKey: backup.ok ? backupKey : null };
}

/**
 * Repli prototype v0 : parcourt `LEGACY_V0_STORAGE_KEYS` dans l'ordre. Le plan
 * 7 jours (`aron36.plan`) est présent dans la constante gelée mais son contenu
 * n'est **pas** importé (hors périmètre v1) : seule la forme « srs » migre.
 */
function loadFromLegacyKeys(deps: LoadProgressDeps, codec: ProgressCodec): ProgressLoadResult {
  for (const key of LEGACY_V0_STORAGE_KEYS) {
    const read = deps.storage.read(key);
    if (!read.ok || read.value === null) {
      continue;
    }
    const raw = read.value;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // JSON illisible dans une clé v0 : on ignore la clé sans rien écrire.
      continue;
    }
    const migrated = migrateLegacyState(parsed);
    if (!migrated.ok) {
      continue;
    }
    const decoded = codec.decode(JSON.stringify(migrated.value));
    if (decoded.ok) {
      // La migration est pure et sans horloge : `savedAt` est estampillé ici,
      // par le `ClockPort`, comme le veut le contrat. `migratedFrom` vaut 0 :
      // l'état vient du prototype v0, pas du schéma interne.
      const progress: PersistedProgress = { ...decoded.progress, savedAt: deps.clock.now() };
      return { status: 'loaded', progress, migratedFrom: 0 };
    }
    const backupKey = `${STORAGE_CORRUPT_BACKUP_PREFIX}${deps.clock.now()}`;
    const backup = deps.storage.write(backupKey, raw);
    return { status: 'corrupt', error: decoded.error, backupKey: backup.ok ? backupKey : null };
  }
  return { status: 'empty' };
}

function versionOf(error: ProgressError): number {
  const raw = error.details?.version;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
