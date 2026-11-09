import { describe, expect, it } from 'vitest';

import { STORAGE_CORRUPT_BACKUP_PREFIX, STORAGE_KEY } from '@/domain/progress/types';
// Faux stockage de test : consommé par le barrel d'infrastructure, en test
// uniquement (aucun code de production applicatif ne dépend de l'infrastructure).
import { MemoryStorageAdapter } from '@/infrastructure';
import { loadProgress } from './loadProgress';
import { createFixedClock } from './testClock';
import { buildFullProgress } from './testState';
import { progressCodec } from './codec';
import { storedKeys, storedRaw } from './testStorage';

describe('loadProgress', () => {
  it('renvoie empty sur un stockage vierge, sans écrire quoi que ce soit', () => {
    const storage = new MemoryStorageAdapter();
    const clock = createFixedClock(1_000);
    expect(loadProgress({ storage, clock })).toEqual({ status: 'empty' });
    expect(storedKeys(storage)).toEqual([]);
  });

  it('charge un état valide sans le modifier', () => {
    const state = buildFullProgress();
    const storage = new MemoryStorageAdapter();
    storage.write(STORAGE_KEY, progressCodec.encode(state));
    const result = loadProgress({ storage, clock: createFixedClock(1_000) });
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') {
      expect(result.progress).toEqual(state);
      expect(result.migratedFrom).toBeNull();
    }
  });

  it('sauvegarde la donnée brute avant de déclarer une corruption', () => {
    const raw = '{"schemaVersion":1,"appVersion":"x","player":{"totalXp":"pas un nombre"}}';
    const storage = new MemoryStorageAdapter();
    storage.write(STORAGE_KEY, raw);
    const clock = createFixedClock(424_242);

    const result = loadProgress({ storage, clock });

    expect(result.status).toBe('corrupt');
    if (result.status === 'corrupt') {
      expect(result.error.code).toBe('invalid-shape');
      expect(result.backupKey).toBe(`${STORAGE_CORRUPT_BACKUP_PREFIX}424242`);
      expect(storedRaw(storage, result.backupKey ?? '')).toBe(raw);
      // La clé principale reste intacte : aucun écrasement silencieux.
      expect(storedRaw(storage, STORAGE_KEY)).toBe(raw);
    }
  });

  it('renvoie backupKey null si la sauvegarde elle-même échoue', () => {
    // Capacité calée sur la donnée existante : l'écriture de secours dépasse
    // le quota simulé et doit être rapportée, sans masquer la corruption.
    const raw = '%%%';
    const storage = new MemoryStorageAdapter({ capacityBytes: STORAGE_KEY.length + raw.length });
    storage.write(STORAGE_KEY, raw);
    const clock = createFixedClock(424_242);

    const result = loadProgress({ storage, clock });

    expect(result.status).toBe('corrupt');
    if (result.status === 'corrupt') {
      expect(result.error.code).toBe('invalid-json');
      expect(result.backupKey).toBeNull();
    }
    // La donnée corrompue d'origine est toujours là, intacte.
    expect(storedRaw(storage, STORAGE_KEY)).toBe(raw);
  });

  it('traite une version future sans aucune écriture ni sauvegarde', () => {
    const raw = JSON.stringify({ ...stripToMinimal(buildFullProgress()), schemaVersion: 2 });
    const storage = new MemoryStorageAdapter();
    storage.write(STORAGE_KEY, raw);
    const clock = createFixedClock(999_999);

    const result = loadProgress({ storage, clock });

    expect(result.status).toBe('future-version');
    if (result.status === 'future-version') {
      expect(result.version).toBe(2);
      expect(result.error.code).toBe('future-version');
    }
    // Rien n'a été écrit : ni backup, ni migration, ni réinitialisation.
    expect(storedKeys(storage)).toEqual([STORAGE_KEY]);
    expect(storedRaw(storage, STORAGE_KEY)).toBe(raw);
  });

  it('transmet un échec du support de stockage comme corruption non destructive', () => {
    const storage = new MemoryStorageAdapter({
      readFailure: { code: 'storage-unavailable', message: 'mode privé' },
    });
    const result = loadProgress({ storage, clock: createFixedClock(1) });
    expect(result.status).toBe('corrupt');
    if (result.status === 'corrupt') {
      expect(result.error.code).toBe('storage-unavailable');
      expect(result.backupKey).toBeNull();
    }
  });

  it('ignore une clé v0 au JSON illisible sans rien écrire', () => {
    const storage = new MemoryStorageAdapter();
    storage.write('aron36.srs', 'pas du json');
    expect(loadProgress({ storage, clock: createFixedClock(1) })).toEqual({ status: 'empty' });
    expect(storedKeys(storage)).toEqual(['aron36.srs']);
  });
});

/** État minimal mais conforme, pour les tests de version. */
function stripToMinimal(state: ReturnType<typeof buildFullProgress>) {
  return {
    ...state,
    player: { ...state.player, questBoard: null },
    cards: { '1': state.cards['1'] },
    reviewLogs: [],
    sessionLogs: [],
  };
}
