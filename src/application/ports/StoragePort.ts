import type { ProgressErrorCode } from '@/domain/progress/types';

/**
 * Port de stockage clé/valeur (localStorage en production, mémoire en test).
 *
 * Toutes les opérations renvoient un résultat explicite : aucune exception ne
 * traverse la frontière (quota dépassé, mode privé, stockage désactivé).
 */
export type StorageKey = string;

/**
 * Cause normalisée d'un échec de stockage.
 *
 * Sous-ensemble **extrait** de la taxonomie unique `ProgressErrorCode` : les deux
 * énumérations ne peuvent pas diverger, un code ajouté ici doit d'abord exister
 * côté progression (`'unavailable'` s'y nomme `'storage-unavailable'`).
 */
export type StorageFailureCode = Extract<
  ProgressErrorCode,
  'quota-exceeded' | 'read-failed' | 'write-failed' | 'storage-unavailable'
>;

/** Échec de stockage, sérialisable et affichable. */
export interface StorageFailure {
  readonly code: StorageFailureCode;
  /** Message technique en anglais, destiné aux logs. */
  readonly message: string;
}

/** Résultat d'une opération de stockage. */
export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: StorageFailure };

/**
 * Contrat de stockage.
 *
 * `read` renvoie `null` pour une clé absente (pas une erreur). `keys` ne renvoie
 * que les clés possédées par l'application (préfixe `aron36.`).
 */
export interface StoragePort {
  /** `true` si le stockage est utilisable dans le contexte courant. */
  isAvailable(): boolean;
  read(key: StorageKey): StorageResult<string | null>;
  write(key: StorageKey, value: string): StorageResult<void>;
  remove(key: StorageKey): StorageResult<void>;
  keys(): StorageResult<readonly StorageKey[]>;
}
