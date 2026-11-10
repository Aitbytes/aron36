import type {
  StorageFailure,
  StoragePort,
  StorageKey,
  StorageResult,
} from '@/application/ports/StoragePort';

/**
 * Adaptateur concret de `StoragePort` au-dessus de `localStorage`.
 *
 * Règles (ADR 0004) :
 * - l'adaptateur ne manipule **que** des clés préfixées `aron36.` : toute autre
 *   clé est refusée (les données de l'application restent identifiables dans
 *   les DevTools et `keys()` n'expose jamais les clés d'un tiers) ;
 * - aucune exception ne traverse la frontière : quota dépassé, mode privé,
 *   stockage désactivé et erreurs imprévues sont des **résultats** typés ;
 * - une clé absente est `null`, pas une erreur ;
 * - `isAvailable()` teste réellement le support (écriture + relecture d'une
 *   clé sonde), car `typeof localStorage !== 'undefined'` ne détecte pas le
 *   mode privé ni le stockage désactivé côté navigateur.
 */
const KEY_PREFIX = 'aron36.';

/** Clé sonde utilisée par `isAvailable()`, retirée immédiatement après test. */
const PROBE_KEY = 'aron36.probe.disponibilite';

/** Options de construction : injection du `Storage` réel (tests, SSR). */
export interface LocalStorageAdapterOptions {
  /** `undefined` = `globalThis.localStorage` ; `null` = forcer l'indisponibilité. */
  readonly storage?: Storage | null | undefined;
}

export class LocalStorageAdapter implements StoragePort {
  private readonly injected: Storage | null | undefined;

  constructor(options: LocalStorageAdapterOptions = {}) {
    this.injected = options.storage;
  }

  isAvailable(): boolean {
    const storage = this.resolveStorage();
    if (storage === null) {
      return false;
    }
    try {
      storage.setItem(PROBE_KEY, '1');
      const readable = storage.getItem(PROBE_KEY) === '1';
      storage.removeItem(PROBE_KEY);
      return readable;
    } catch {
      return false;
    }
  }

  read(key: StorageKey): StorageResult<string | null> {
    if (!this.isOwnedKey(key)) {
      return {
        ok: false,
        failure: readFailure(`clé refusée (préfixe « ${KEY_PREFIX} » requis) : ${key}`),
      };
    }
    const storage = this.resolveStorage();
    if (storage === null) {
      return unavailableFailure();
    }
    try {
      return { ok: true, value: storage.getItem(key) };
    } catch (error) {
      return { ok: false, failure: readFailure(messageOf(error)) };
    }
  }

  write(key: StorageKey, value: string): StorageResult<void> {
    if (!this.isOwnedKey(key)) {
      return {
        ok: false,
        failure: writeFailure(`clé refusée (préfixe « ${KEY_PREFIX} » requis) : ${key}`),
      };
    }
    const storage = this.resolveStorage();
    if (storage === null) {
      return unavailableFailure();
    }
    try {
      storage.setItem(key, value);
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, failure: classifyWriteError(error) };
    }
  }

  remove(key: StorageKey): StorageResult<void> {
    if (!this.isOwnedKey(key)) {
      return {
        ok: false,
        failure: writeFailure(`clé refusée (préfixe « ${KEY_PREFIX} » requis) : ${key}`),
      };
    }
    const storage = this.resolveStorage();
    if (storage === null) {
      return unavailableFailure();
    }
    try {
      storage.removeItem(key);
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, failure: writeFailure(messageOf(error)) };
    }
  }

  keys(): StorageResult<readonly StorageKey[]> {
    const storage = this.resolveStorage();
    if (storage === null) {
      return unavailableFailure();
    }
    try {
      const owned: StorageKey[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null && key.startsWith(KEY_PREFIX) && key !== PROBE_KEY) {
          owned.push(key);
        }
      }
      return { ok: true, value: owned };
    } catch (error) {
      return { ok: false, failure: readFailure(messageOf(error)) };
    }
  }

  private isOwnedKey(key: StorageKey): boolean {
    return key.startsWith(KEY_PREFIX);
  }

  private resolveStorage(): Storage | null {
    if (this.injected !== undefined) {
      return this.injected;
    }
    try {
      return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    } catch {
      // Certains navigateurs lèvent à l'accès même de `localStorage` (durcissement).
      return null;
    }
  }
}

function readFailure(message: string): StorageFailure {
  return { code: 'read-failed', message };
}

function writeFailure(message: string): StorageFailure {
  return { code: 'write-failed', message };
}

function unavailableFailure(): {
  ok: false;
  failure: { code: 'storage-unavailable'; message: string };
} {
  return {
    ok: false,
    failure: { code: 'storage-unavailable', message: 'stockage indisponible (mode privé ?)' },
  };
}

function classifyWriteError(error: unknown): {
  code: 'quota-exceeded' | 'write-failed';
  message: string;
} {
  if (isQuotaExceededError(error)) {
    return { code: 'quota-exceeded', message: 'quota de stockage dépassé' };
  }
  return { code: 'write-failed', message: messageOf(error) };
}

/**
 * Détecte un dépassement de quota sur tous les moteurs : `QuotaExceededError`
 * (standard), code DOM 22 (Chrome historique), 1014 (Firefox).
 */
function isQuotaExceededError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name === 'QuotaExceededError' || candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return true;
  }
  return candidate.code === 22 || candidate.code === 1014;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
