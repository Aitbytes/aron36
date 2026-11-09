import { describe, expect, it } from 'vitest';

import { STORAGE_KEY } from '@/domain/progress/types';
// Faux stockage de test : consommé par le barrel d'infrastructure, en test
// uniquement (aucun code de production applicatif ne dépend de l'infrastructure).
import { MemoryStorageAdapter } from '@/infrastructure';
import { progressCodec } from './codec';
import { saveProgress } from './saveProgress';
import { createFixedClock } from './testClock';
import { buildFullProgress } from './testState';
import { storedRaw } from './testStorage';

describe('saveProgress', () => {
  it('écrit l’état encodé avec savedAt estampillé par l’horloge', () => {
    const storage = new MemoryStorageAdapter();
    const clock = createFixedClock(1_762_700_123_456);
    const state = buildFullProgress();

    const result = saveProgress({ storage, clock }, state);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.savedAt).toBe(1_762_700_123_456);
      expect(result.progress.savedAt).toBe(1_762_700_123_456);
    }
    const raw = storedRaw(storage, STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = progressCodec.decode(raw ?? '');
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.progress).toEqual({ ...state, savedAt: 1_762_700_123_456 });
    }
  });

  it('rapporte un dépassement de quota comme résultat, sans lever', () => {
    const state = buildFullProgress();
    const encoded = progressCodec.encode({ ...state, savedAt: 1 });
    const storage = new MemoryStorageAdapter({ capacityBytes: encoded.length - 1 });
    const clock = createFixedClock(1);

    const result = saveProgress({ storage, clock }, state);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('quota-exceeded');
    }
    expect(storedRaw(storage, STORAGE_KEY)).toBeNull();
  });

  it('rapporte une panne d’écriture injectée comme résultat', () => {
    const storage = new MemoryStorageAdapter({
      writeFailure: { code: 'write-failed', message: 'support verrouillé' },
    });
    const result = saveProgress({ storage, clock: createFixedClock(1) }, buildFullProgress());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('write-failed');
      expect(result.error.message).toBe('support verrouillé');
    }
  });

  it('rapporte un stockage indisponible comme résultat', () => {
    const storage = new MemoryStorageAdapter({ available: false });
    const result = saveProgress({ storage, clock: createFixedClock(1) }, buildFullProgress());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('storage-unavailable');
    }
  });
});
