import { describe, expect, it } from 'vitest';

import { createAppServices } from '@/application/bootstrap';
import type { SpeechPort, SpeechRequest } from '@/application/ports/SpeechPort';
import { NullSpeechPort } from '@/infrastructure';

import { createUseCases } from './create-use-cases';
import {
  createSeedFactory,
  createSequentialIds,
  FixedClock,
  HARNESS_OFFSET_MINUTES,
  HARNESS_TIME_ZONE,
  MemoryStorage,
  NOW,
} from './test-doubles';
import type { AppServices } from './types';

/** Services montés sur des doubles mémoire, avec un port vocal fourni. */
function servicesWithSpeech(speech: SpeechPort): AppServices {
  return createAppServices({
    storage: new MemoryStorage(),
    clock: new FixedClock(NOW, HARNESS_OFFSET_MINUTES, HARNESS_TIME_ZONE),
    ids: createSequentialIds(),
    speech,
    newSeed: createSeedFactory('speak-seed'),
  });
}

/** Port vocal qui enregistre les demandes et réussit sans son. */
function recordingSpeech(calls: SpeechRequest[]): SpeechPort {
  return {
    isAvailable: () => true,
    voices: () => [],
    speak: (request) => {
      calls.push(request);
      return Promise.resolve({ ok: true });
    },
    cancel: () => undefined,
  };
}

describe('speak — synthèse vocale pilotée par le réglage (L8)', () => {
  it('lit le texte localisé avec la locale du joueur quand la voix est activée', async () => {
    const calls: SpeechRequest[] = [];
    const useCases = createUseCases(servicesWithSpeech(recordingSpeech(calls)));

    const result = await useCases.speak.execute({ text: 'Quelle est ta réponse ?' });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ text: 'Quelle est ta réponse ?', locale: 'fr' }]);
  });

  it('ne produit aucun son quand le réglage speechEnabled est décoché', async () => {
    const calls: SpeechRequest[] = [];
    const useCases = createUseCases(servicesWithSpeech(recordingSpeech(calls)));
    useCases.updateSettings.execute({ settings: { speechEnabled: false } });

    const result = await useCases.speak.execute({ text: 'silence' });

    expect(result).toEqual({ ok: false, reason: 'unsupported', message: null });
    expect(calls).toEqual([]);
  });

  it('reste neutre avec un port vocal absent (NullSpeechPort)', async () => {
    const useCases = createUseCases(servicesWithSpeech(new NullSpeechPort()));

    const result = await useCases.speak.execute({ text: 'Rien à lire' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported');
    }
  });
});
