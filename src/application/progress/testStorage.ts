import type { StoragePort, StorageKey } from '@/application/ports/StoragePort';

/** Aides de lecture pour les tests : désencapsulent un `StorageResult`. */
export function storedRaw(storage: StoragePort, key: StorageKey): string | null {
  const result = storage.read(key);
  return result.ok ? result.value : null;
}

export function storedKeys(storage: StoragePort): readonly StorageKey[] {
  const result = storage.keys();
  return result.ok ? result.value : [];
}
