import type {
  StorageFailure,
  StorageFailureCode,
  StoragePort,
  StorageKey,
  StorageResult,
} from '@/application/ports/StoragePort';

/**
 * Faux stockage en mémoire, même contrat que `LocalStorageAdapter`.
 *
 * Sert aux tests et à la composition racine quand `localStorage` est absent.
 * Permet de **simuler** les pannes réelles du support sans navigateur :
 * - `available: false` → mode privé / stockage désactivé ;
 * - `capacityBytes` → dépassement de quota (`quota-exceeded`) ;
 * - `readFailure` / `writeFailure` → panne injectée arbitraire.
 *
 * Les valeurs sont recopiées : muter l'objet passé à `write` après coup ne
 * change pas le contenu stocké (même sémantique que localStorage).
 */
export interface MemoryStorageOptions {
  /** `false` simule un stockage indisponible (défaut : `true`). */
  readonly available?: boolean | undefined;
  /**
   * Budget total simulé, en caractères (clé + valeur cumulés). `null` = illimité.
   * Défaut : illimité.
   */
  readonly capacityBytes?: number | null | undefined;
  /** Panne renvoyée par `read` et `keys` si définie. */
  readonly readFailure?: StorageFailure | null | undefined;
  /** Panne renvoyée par `write` et `remove` si définie. */
  readonly writeFailure?: StorageFailure | null | undefined;
  /** Code de la panne de quota simulée par `capacityBytes` (défaut `quota-exceeded`). */
  readonly capacityFailureCode?: StorageFailureCode | undefined;
}

export class MemoryStorageAdapter implements StoragePort {
  private readonly entries = new Map<StorageKey, string>();

  private readonly available: boolean;

  private readonly capacityBytes: number | null;

  private readonly readFailure: StorageFailure | null;

  private readonly writeFailure: StorageFailure | null;

  private readonly capacityFailureCode: StorageFailureCode;

  constructor(options: MemoryStorageOptions = {}) {
    this.available = options.available ?? true;
    this.capacityBytes = options.capacityBytes ?? null;
    this.readFailure = options.readFailure ?? null;
    this.writeFailure = options.writeFailure ?? null;
    this.capacityFailureCode = options.capacityFailureCode ?? 'quota-exceeded';
  }

  isAvailable(): boolean {
    return this.available;
  }

  read(key: StorageKey): StorageResult<string | null> {
    if (!this.available) {
      return { ok: false, failure: unavailable() };
    }
    if (this.readFailure !== null) {
      return { ok: false, failure: this.readFailure };
    }
    const value = this.entries.get(key);
    return { ok: true, value: value === undefined ? null : value };
  }

  write(key: StorageKey, value: string): StorageResult<void> {
    if (!this.available) {
      return { ok: false, failure: unavailable() };
    }
    if (this.writeFailure !== null) {
      return { ok: false, failure: this.writeFailure };
    }
    if (this.capacityBytes !== null) {
      const others = this.usedBytes() - (this.entries.get(key)?.length ?? 0);
      const projected = others + key.length + value.length;
      if (projected > this.capacityBytes) {
        return {
          ok: false,
          failure: {
            code: this.capacityFailureCode,
            message: `quota simulé dépassé : ${projected} > ${this.capacityBytes} caractères`,
          },
        };
      }
    }
    this.entries.set(key, value);
    return { ok: true, value: undefined };
  }

  remove(key: StorageKey): StorageResult<void> {
    if (!this.available) {
      return { ok: false, failure: unavailable() };
    }
    if (this.writeFailure !== null) {
      return { ok: false, failure: this.writeFailure };
    }
    this.entries.delete(key);
    return { ok: true, value: undefined };
  }

  keys(): StorageResult<readonly StorageKey[]> {
    if (!this.available) {
      return { ok: false, failure: unavailable() };
    }
    if (this.readFailure !== null) {
      return { ok: false, failure: this.readFailure };
    }
    return { ok: true, value: [...this.entries.keys()].sort(compareStrings) };
  }

  /** État brut interne, pour l'audit et les tests. */
  dump(): ReadonlyMap<StorageKey, string> {
    return new Map(this.entries);
  }

  /** Somme des longueurs (clé + valeur) actuellement stockées. */
  private usedBytes(): number {
    let total = 0;
    for (const [key, value] of this.entries) {
      total += key.length + value.length;
    }
    return total;
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unavailable(): { code: 'storage-unavailable'; message: string } {
  return { code: 'storage-unavailable', message: 'stockage indisponible (mode privé ?)' };
}
