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
 * Lecture + décodage de la progression (ADR 0004, ARCHITECTURE § 5.2) — **le
 * lecteur unique** de la couche application.
 *
 * `readProgressWithRaw` est l'unique implémentation ; `loadProgress` et le
 * `readPersistedProgress` des cas d'usage en dérivent, de sorte qu'il n'existe
 * qu'un seul chemin de décodage, de repli v0 et de **sauvegarde de corruption**
 * (revue Phase 3 : le chemin branché renvoyait `backupKey: null` et ne
 * sauvegardait jamais).
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

/** Résultat d'une lecture : le statut métier **et** la donnée source lue. */
export interface ProgressReadWithRaw {
  readonly result: ProgressLoadResult;
  /** Dernière chaîne lue dans le stockage (clé principale ou clé v0), `null` sinon. */
  readonly raw: string | null;
}

/** Lit la progression, sauvegarde la donnée illisible, ne la détruit jamais. */
export function readProgressWithRaw(deps: LoadProgressDeps): ProgressReadWithRaw {
  const codec = deps.codec ?? progressCodec;
  const read = deps.storage.read(STORAGE_KEY);
  if (!read.ok) {
    // Échec du support : rien à sauvegarder (pas de donnée brute), on remonte
    // le code storage (`read-failed` / `storage-unavailable`) tel quel.
    return {
      result: { status: 'corrupt', error: storageFailureToError(read.failure), backupKey: null },
      raw: null,
    };
  }
  const raw = read.value;
  if (raw === null) {
    return loadFromLegacyKeys(deps, codec);
  }
  const decoded = codec.decode(raw);
  if (decoded.ok) {
    return {
      result: {
        status: 'loaded',
        progress: decoded.progress,
        migratedFrom: decoded.migratedFrom,
      },
      raw,
    };
  }
  const error = decoded.error;
  if (error.code === 'future-version') {
    return { result: { status: 'future-version', version: versionOf(error), error }, raw };
  }
  // Corruption : sauvegarde brute d'abord, résultat ensuite.
  return { result: { status: 'corrupt', error, ...backupCorruptRaw(deps, raw) }, raw };
}

/** Statut seul, sans la donnée brute (API historique du module). */
export function loadProgress(deps: LoadProgressDeps): ProgressLoadResult {
  return readProgressWithRaw(deps).result;
}

/**
 * Repli prototype v0 : parcourt `LEGACY_V0_STORAGE_KEYS` dans l'ordre. Le plan
 * 7 jours (`aron36.plan`) est présent dans la constante gelée mais son contenu
 * n'est **pas** importé (hors périmètre v1) : seule la forme « srs » migre.
 */
function loadFromLegacyKeys(deps: LoadProgressDeps, codec: ProgressCodec): ProgressReadWithRaw {
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
      return { result: { status: 'loaded', progress, migratedFrom: 0 }, raw };
    }
    return {
      result: { status: 'corrupt', error: decoded.error, ...backupCorruptRaw(deps, raw) },
      raw,
    };
  }
  return { result: { status: 'empty' }, raw: null };
}

/**
 * Recopie la donnée illisible sous la clé de sauvegarde, avant toute
 * récupération. Renvoie la `backupKey` effectivement créée, ou `null` si la
 * sauvegarde elle-même échoue (l'appelant garde alors la donnée principale
 * intacte et signale l'échec).
 */
function backupCorruptRaw(
  deps: LoadProgressDeps,
  raw: string,
): { readonly backupKey: string | null } {
  const backupKey = `${STORAGE_CORRUPT_BACKUP_PREFIX}${deps.clock.now()}`;
  const backup = deps.storage.write(backupKey, raw);
  return { backupKey: backup.ok ? backupKey : null };
}

function versionOf(error: ProgressError): number {
  const raw = error.details?.version;
  const parsed = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
