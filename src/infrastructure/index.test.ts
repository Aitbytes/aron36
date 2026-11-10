import { describe, expect, it } from 'vitest';

import { createInfrastructure } from './index';
import { MemoryStorageAdapter } from './storage/MemoryStorageAdapter';

describe('createInfrastructure', () => {
  it('assemble tous les ports et honore la configuration', () => {
    const memory = new MemoryStorageAdapter();
    const infra = createInfrastructure({ storagePort: memory, timeZone: 'Europe/Paris' });
    expect(infra.storage.isAvailable()).toBe(true);
    expect(infra.clock.timeZone).toBe('Europe/Paris');
    expect(infra.ids.newSessionId().startsWith('s_')).toBe(true);
    expect(infra.speech.isAvailable()).toBe(false); // jsdom : pas de Web Speech
  });

  it('crée un aléa seedé reproductible via createRandom', () => {
    const infra = createInfrastructure();
    const first = infra.createRandom('seed-partagé');
    const second = infra.createRandom('seed-partagé');
    expect(first.nextFloat()).toBe(second.nextFloat());
    expect(infra.createRandom('autre-seed').nextFloat()).not.toBe(first.nextFloat());
  });

  it('enveloppe le Storage navigateur fourni et écrit réellement dedans', () => {
    const backing = new Map<string, string>();
    const domStorage: Storage = {
      get length() {
        return backing.size;
      },
      clear: () => backing.clear(),
      getItem: (key) => backing.get(key) ?? null,
      key: (index) => [...backing.keys()][index] ?? null,
      removeItem: (key) => void backing.delete(key),
      setItem: (key, value) => void backing.set(key, value),
    };
    const infra = createInfrastructure({ storage: domStorage });
    expect(infra.storage.write('aron36.sonde', '1').ok).toBe(true);
    expect(backing.get('aron36.sonde')).toBe('1');
  });

  it('sans configuration, utilise un adaptateur localStorage paresseux', () => {
    // jsdom de l'environnement de test n'expose pas toujours `localStorage` :
    // l'adaptateur doit se comporter proprement dans les deux cas.
    const infra = createInfrastructure();
    const read = infra.storage.read('aron36.inexistant');
    if (read.ok) {
      expect(read.value).toBeNull();
    } else {
      expect(read.failure.code).toBe('storage-unavailable');
    }
  });
});
