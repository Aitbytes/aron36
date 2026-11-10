import { afterEach, describe, expect, it, vi } from 'vitest';

import { NullSpeechPort } from './NullSpeechPort';
import { WebSpeechPort } from './WebSpeechPort';
import { createSpeechPort } from '@/infrastructure';

/** Voix factices conformes à l'interface `SpeechSynthesisVoice`. */
function fakeVoice(
  voiceURI: string,
  name: string,
  lang: string,
  isDefault = false,
): SpeechSynthesisVoice {
  return {
    voiceURI,
    name,
    lang,
    default: isDefault,
    localService: true,
    eventCharIndex: 0,
  } as SpeechSynthesisVoice;
}

/** Utterance factice : conserve les réglages, expose les gestionnaires. */
class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

interface FakeSynth {
  voices: SpeechSynthesisVoice[];
  spoken: FakeUtterance[];
  cancel: ReturnType<typeof vi.fn>;
  getVoices: () => SpeechSynthesisVoice[];
  speak: (utterance: FakeUtterance) => void;
}

function installFakeSynth(
  options: { voices?: SpeechSynthesisVoice[]; finishWith?: 'end' | 'error' | 'cancel' } = {},
): FakeSynth {
  const synth: FakeSynth = {
    voices: options.voices ?? [],
    spoken: [],
    cancel: vi.fn(),
    getVoices: () => synth.voices,
    speak: (utterance) => {
      synth.spoken.push(utterance);
      queueMicrotask(() => {
        if (options.finishWith === 'error') {
          utterance.onerror?.({ error: 'not-allowed' });
        } else if (options.finishWith === 'cancel') {
          utterance.onerror?.({ error: 'canceled' });
        } else {
          utterance.onend?.();
        }
      });
    },
  };
  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return synth;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebSpeechPort', () => {
  it('est indisponible et neutre sans speechSynthesis (comportement jsdom par défaut)', async () => {
    const port = new WebSpeechPort();
    expect(port.isAvailable()).toBe(false);
    expect(port.voices('fr')).toEqual([]);
    await expect(port.speak({ text: 'Question un', locale: 'fr' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
      message: expect.any(String),
    });
    expect(() => port.cancel()).not.toThrow();
  });

  it('lit le texte et résout à la fin de la lecture', async () => {
    const synth = installFakeSynth({ finishWith: 'end' });
    const port = new WebSpeechPort();
    const result = await port.speak({ text: 'Question numéro trois', locale: 'fr' });
    expect(result).toEqual({ ok: true });
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]?.text).toBe('Question numéro trois');
    expect(synth.spoken[0]?.lang).toBe('fr-FR');
  });

  it('borne le débit, la hauteur et le volume reçus', async () => {
    const synth = installFakeSynth();
    const port = new WebSpeechPort();
    await port.speak({ text: 'x', locale: 'en', rate: 9, pitch: -3, volume: 42 });
    const utterance = synth.spoken[0];
    expect(utterance?.rate).toBe(2);
    expect(utterance?.pitch).toBe(0);
    expect(utterance?.volume).toBe(1);
  });

  it('signale une erreur de synthèse comme résultat typé', async () => {
    installFakeSynth({ finishWith: 'error' });
    const port = new WebSpeechPort();
    await expect(port.speak({ text: 'x', locale: 'fr' })).resolves.toEqual({
      ok: false,
      reason: 'error',
      message: 'not-allowed',
    });
  });

  it('signale une annulation par la raison dédiée', async () => {
    installFakeSynth({ finishWith: 'cancel' });
    const port = new WebSpeechPort();
    await expect(port.speak({ text: 'x', locale: 'fr' })).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
      message: expect.any(String),
    });
  });

  it('filtre les voix par locale et place la voix par défaut en premier', () => {
    installFakeSynth({
      voices: [
        fakeVoice('fr-ca', 'Voix Canada', 'fr-CA'),
        fakeVoice('fr-fr', 'Voix France', 'fr-FR', true),
        fakeVoice('en-us', 'Voix US', 'en-US'),
      ],
    });
    const port = new WebSpeechPort();
    const frVoices = port.voices('fr');
    expect(frVoices.map((voice) => voice.id)).toEqual(['fr-fr', 'fr-ca']);
    expect(frVoices[0]?.isDefault).toBe(true);
    expect(port.voices('en')).toHaveLength(1);
  });

  it('annule la lecture en cours sans lever', () => {
    const synth = installFakeSynth();
    const port = new WebSpeechPort();
    port.cancel();
    expect(synth.cancel).toHaveBeenCalledOnce();
  });
});

describe('NullSpeechPort', () => {
  it('offre un comportement neutre explicite, jamais bloquant', async () => {
    const port = new NullSpeechPort();
    expect(port.isAvailable()).toBe(false);
    expect(port.voices('en')).toEqual([]);
    await expect(port.speak({ text: 'x', locale: 'fr' })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
      message: null,
    });
    expect(() => port.cancel()).not.toThrow();
  });
});

describe('createSpeechPort', () => {
  it('choisit le port web quand le navigateur expose la synthèse', () => {
    installFakeSynth();
    expect(createSpeechPort()).toBeInstanceOf(WebSpeechPort);
  });

  it('choisit le port neutre sinon', () => {
    expect(createSpeechPort()).toBeInstanceOf(NullSpeechPort);
  });
});
