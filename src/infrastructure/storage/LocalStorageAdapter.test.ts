import { describe, expect, it } from 'vitest';

import type { StorageResult } from '@/application/ports/StoragePort';
import { LocalStorageAdapter } from './LocalStorageAdapter';

/** Désencapsule un résultat de stockage, ou échoue le test. */
function okValue<T>(result: StorageResult<T>): T {
  if (!result.ok) {
    throw new Error(`opération en échec inattendue : ${result.failure.code}`);
  }
  return result.value;
}

const KEY = 'aron36.progress';

/** Faux `Storage` dont chaque opération peut lever une erreur arbitraire. */
class FakeStorage implements Storage {
  readonly map = new Map<string, string>();

  errorOnSetItem: Error | null = null;
  errorOnGetItem: Error | null = null;

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    if (this.errorOnGetItem !== null) {
      throw this.errorOnGetItem;
    }
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.errorOnSetItem !== null) {
      throw this.errorOnSetItem;
    }
    this.map.set(key, value);
  }
}

describe('LocalStorageAdapter', () => {
  it('lit, écrit et supprime une clé préfixée aron36.', () => {
    const adapter = new LocalStorageAdapter({ storage: new FakeStorage() });
    expect(adapter.write(KEY, '{"a":1}').ok).toBe(true);
    expect(adapter.read(KEY)).toEqual({ ok: true, value: '{"a":1}' });
    expect(adapter.remove(KEY).ok).toBe(true);
    expect(adapter.read(KEY)).toEqual({ ok: true, value: null });
  });

  it('renvoie null pour une clé absente, jamais une erreur', () => {
    const adapter = new LocalStorageAdapter({ storage: new FakeStorage() });
    expect(adapter.read(KEY)).toEqual({ ok: true, value: null });
  });

  it('refuse toute clé hors préfixe aron36.', () => {
    const adapter = new LocalStorageAdapter({ storage: new FakeStorage() });
    expect(adapter.read('application.etrange')).toMatchObject({
      ok: false,
      failure: { code: 'read-failed' },
    });
    expect(adapter.write('application.etrange', 'x')).toMatchObject({
      ok: false,
      failure: { code: 'write-failed' },
    });
    expect(adapter.remove('application.etrange')).toMatchObject({
      ok: false,
      failure: { code: 'write-failed' },
    });
  });

  it('cartographie QuotaExceededError en quota-exceeded', () => {
    const backing = new FakeStorage();
    backing.errorOnSetItem = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const adapter = new LocalStorageAdapter({ storage: backing });
    const result = adapter.write(KEY, 'valeur');
    expect(result).toMatchObject({ ok: false, failure: { code: 'quota-exceeded' } });
    // Aucune exception n'a traversé : le résultat est typé.
  });

  it('cartographie une panne de lecture en read-failed', () => {
    const backing = new FakeStorage();
    backing.errorOnGetItem = Object.assign(new Error('illisible'), { name: 'TypeError' });
    const adapter = new LocalStorageAdapter({ storage: backing });
    expect(adapter.read(KEY)).toMatchObject({ ok: false, failure: { code: 'read-failed' } });
  });

  it('isAvailable sonde réellement le support (écriture + relecture)', () => {
    const healthy = new LocalStorageAdapter({ storage: new FakeStorage() });
    expect(healthy.isAvailable()).toBe(true);

    const broken = new FakeStorage();
    broken.errorOnSetItem = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    expect(new LocalStorageAdapter({ storage: broken }).isAvailable()).toBe(false);
    expect(new LocalStorageAdapter({ storage: null }).isAvailable()).toBe(false);
    // La sonde a été nettoyée : aucune trace résiduelle.
    expect(okValue(healthy.keys())).toEqual([]);
  });

  it('ne liste que les clés possédées par l’application', () => {
    const backing = new FakeStorage();
    backing.map.set(KEY, '1');
    backing.map.set('application.tiers', 'x');
    backing.map.set('aron36.progress.corrupt.42', 'brut');
    backing.map.set('aron36.probe.disponibilite', '1');
    const adapter = new LocalStorageAdapter({ storage: backing });
    expect(okValue(adapter.keys())).toEqual([KEY, 'aron36.progress.corrupt.42']);
  });

  it('signale un support absent sur toutes les opérations', () => {
    const adapter = new LocalStorageAdapter({ storage: null });
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.read(KEY)).toMatchObject({
      ok: false,
      failure: { code: 'storage-unavailable' },
    });
    expect(adapter.write(KEY, 'x')).toMatchObject({
      ok: false,
      failure: { code: 'storage-unavailable' },
    });
    expect(adapter.remove(KEY)).toMatchObject({
      ok: false,
      failure: { code: 'storage-unavailable' },
    });
    expect(adapter.keys()).toMatchObject({ ok: false, failure: { code: 'storage-unavailable' } });
  });
});
