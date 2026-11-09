import { describe, expect, it } from 'vitest';

import type { StorageResult } from '@/application/ports/StoragePort';
import { MemoryStorageAdapter } from './MemoryStorageAdapter';

/** Désencapsule un résultat de stockage, ou échoue le test. */
function okValue<T>(result: StorageResult<T>): T {
  if (!result.ok) {
    throw new Error(`opération en échec inattendue : ${result.failure.code}`);
  }
  return result.value;
}

describe('MemoryStorageAdapter', () => {
  it('applique le même contrat que localStorage : lecture, écriture, suppression, clés', () => {
    const storage = new MemoryStorageAdapter();
    expect(storage.isAvailable()).toBe(true);
    expect(okValue(storage.read('aron36.absente'))).toBeNull();
    expect(storage.write('aron36.b', '2').ok).toBe(true);
    expect(storage.write('aron36.a', '1').ok).toBe(true);
    expect(okValue(storage.keys())).toEqual(['aron36.a', 'aron36.b']);
    expect(storage.remove('aron36.b').ok).toBe(true);
    expect(okValue(storage.read('aron36.b'))).toBeNull();
  });

  it('simule un stockage indisponible (mode privé)', () => {
    const storage = new MemoryStorageAdapter({ available: false });
    expect(storage.isAvailable()).toBe(false);
    expect(storage.read('aron36.x')).toMatchObject({
      ok: false,
      failure: { code: 'storage-unavailable' },
    });
    expect(storage.write('aron36.x', 'y')).toMatchObject({
      ok: false,
      failure: { code: 'storage-unavailable' },
    });
  });

  it('simule un dépassement de quota via une capacité limitée', () => {
    const storage = new MemoryStorageAdapter({ capacityBytes: 30 });
    expect(storage.write('aron36.petit', 'ok').ok).toBe(true);
    const result = storage.write('aron36.trop-long-pour-le-budget', 'donnée volumineuse');
    expect(result).toMatchObject({ ok: false, failure: { code: 'quota-exceeded' } });
    // L'entrée refusée n'existe pas : le contenu précédent est intact.
    expect(okValue(storage.read('aron36.petit'))).toBe('ok');
  });

  it('simule des pannes arbitraires de lecture et d’écriture', () => {
    const storage = new MemoryStorageAdapter({
      readFailure: { code: 'read-failed', message: 'panne lecture' },
      writeFailure: { code: 'write-failed', message: 'panne écriture' },
    });
    expect(storage.read('aron36.x')).toMatchObject({ ok: false, failure: { code: 'read-failed' } });
    expect(storage.keys()).toMatchObject({ ok: false, failure: { code: 'read-failed' } });
    expect(storage.write('aron36.x', 'y')).toMatchObject({
      ok: false,
      failure: { code: 'write-failed' },
    });
    expect(storage.remove('aron36.x')).toMatchObject({
      ok: false,
      failure: { code: 'write-failed' },
    });
  });
});
