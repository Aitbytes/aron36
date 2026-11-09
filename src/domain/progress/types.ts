import type { EpochMs, IsoDateTime } from '@/domain/shared/types';
import type { HookLibrary } from '@/domain/memory/types';
import type { PlayerState } from '@/domain/gamification/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';
import type { SessionLog } from '@/domain/session/types';

/**
 * Persistance locale versionnée (voir docs/ARCHITECTURE.md § Persistance).
 *
 * Une seule clé localStorage contient l'état complet. Toute lecture passe par
 * un décodeur qui valide la forme, applique les migrations puis renvoie un
 * résultat explicite. Une donnée corrompue n'est jamais écrasée silencieusement.
 */

/** Clé localStorage de l'état principal. Ne change jamais entre versions. */
export const STORAGE_KEY = 'aron36.progress';

/** Préfixe des sauvegardes brutes de données corrompues. */
export const STORAGE_CORRUPT_BACKUP_PREFIX = 'aron36.progress.corrupt.';

/** Version courante du schéma persisté. */
export const SCHEMA_VERSION = 1;

/** Version minimale lisible ; en dessous, la migration est impossible. */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;

/** Nombre maximal de lignes de journal de révision conservées (les plus récentes). */
export const MAX_REVIEW_LOG_ENTRIES = 5000;

/** Nombre maximal de sessions conservées (les plus récentes). */
export const MAX_SESSION_LOG_ENTRIES = 500;

/** Identifiant du format d'export JSON. */
export const EXPORT_FORMAT = 'aron36-progress';

/** Version du format d'export JSON. */
export const EXPORT_FORMAT_VERSION = 1;

/** Clés localStorage du prototype v0, lues une seule fois pour migration. */
export const LEGACY_V0_STORAGE_KEYS = ['aron36.srs', 'aron36.plan'] as const;

/**
 * État complet persisté.
 *
 * Invariants :
 * - `schemaVersion` est un entier ≥ 1 ;
 * - `Object.keys(cards)` ne contient que des identifiants 1..36 sous forme
 *   décimale, et chaque valeur porte le même `questionId` ;
 * - `hooks.hooks` contient au plus une entrée par question ;
 * - `reviewLogs` et `sessionLogs` sont triés du plus ancien au plus récent et
 *   tronqués aux limites `MAX_*_LOG_ENTRIES` ;
 * - `savedAt` est fourni par `ClockPort`, jamais par le domaine.
 */
export interface PersistedProgress {
  readonly schemaVersion: number;
  /** Version de l'application ayant écrit l'état (diagnostic, non bloquant). */
  readonly appVersion: string;
  readonly savedAt: EpochMs;
  readonly player: PlayerState;
  /** Cartes indexées par identifiant décimal sérialisé en chaîne. */
  readonly cards: Readonly<Record<string, CardState>>;
  readonly hooks: HookLibrary;
  readonly reviewLogs: readonly ReviewLog[];
  readonly sessionLogs: readonly SessionLog[];
}

/** Codes d'erreur de lecture/écriture, stables pour l'UI et les tests. */
export type ProgressErrorCode =
  | 'invalid-json'
  | 'invalid-shape'
  | 'unsupported-version'
  | 'missing-migration'
  | 'read-failed'
  | 'write-failed'
  | 'quota-exceeded';

/** Erreur de persistance explicite, jamais levée à travers une frontière. */
export interface ProgressError {
  readonly code: ProgressErrorCode;
  /** Message technique en anglais, destiné aux logs. */
  readonly message: string;
  /** Détails sérialisables (champ fautif, version rencontrée…). */
  readonly details: Readonly<Record<string, string>> | null;
}

/** Résultat d'une lecture de progression. */
export type ProgressLoadResult =
  | { readonly status: 'empty' }
  | {
      readonly status: 'loaded';
      readonly progress: PersistedProgress;
      /** Version d'origine si une migration a été appliquée, sinon `null`. */
      readonly migratedFrom: number | null;
    }
  | {
      readonly status: 'corrupt';
      readonly error: ProgressError;
      /** Clé de sauvegarde brute créée avant récupération, si possible. */
      readonly backupKey: string | null;
    };

/**
 * Migration unitaire `v → v+1`.
 *
 * Contrat : `migrate` est pure, ne lit jamais le stockage, et renvoie la forme
 * complète attendue par `toVersion`. Une migration qui échoue doit lever une
 * erreur ; le décodeur la convertit en `missing-migration` ou `invalid-shape`.
 */
export interface Migration {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly description: string;
  migrate(input: unknown): unknown;
}

/** Registre des migrations, vide à la version 1. */
export const MIGRATIONS: readonly Migration[] = [];

/** Résultat du décodage d'une chaîne JSON. */
export type ProgressDecodeResult =
  | {
      readonly ok: true;
      readonly progress: PersistedProgress;
      readonly migratedFrom: number | null;
    }
  | { readonly ok: false; readonly error: ProgressError };

/** Enveloppe d'export/import JSON, distincte du format interne. */
export interface ExportEnvelope {
  readonly format: typeof EXPORT_FORMAT;
  readonly formatVersion: number;
  readonly exportedAt: IsoDateTime;
  readonly progress: PersistedProgress;
}

/** Résultat d'un import de fichier JSON. */
export type ProgressImportResult =
  | {
      readonly ok: true;
      readonly progress: PersistedProgress;
      readonly migratedFrom: number | null;
    }
  | { readonly ok: false; readonly error: ProgressError };

/** Codec pur : sérialisation, validation, migration. Aucun accès stockage. */
export interface ProgressCodec {
  /** Sérialise l'état complet en JSON stable (clés triées par l'implémentation). */
  encode(progress: PersistedProgress): string;
  /** Décode, valide et migre une chaîne interne ou un export. */
  decode(raw: string): ProgressDecodeResult;
  /** Construit l'enveloppe d'export à partir d'un état valide. */
  toExport(progress: PersistedProgress, now: EpochMs): ExportEnvelope;
  /** Valide une enveloppe d'export et renvoie l'état migré. */
  fromExport(raw: string): ProgressImportResult;
}
