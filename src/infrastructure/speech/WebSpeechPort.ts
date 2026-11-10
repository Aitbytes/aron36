import type {
  SpeechPort,
  SpeechRequest,
  SpeechResult,
  SpeechVoice,
} from '@/application/ports/SpeechPort';
import type { LocaleCode } from '@/domain/shared/types';

/**
 * `SpeechPort` au-dessus de la Web Speech API (L8).
 *
 * - activé **uniquement** si `speechSynthesis` existe dans le navigateur ;
 * - aucune donnée ne quitte l'appareil : la synthèse est locale ;
 * - aucune exception ne traverse la frontière : API absente, `utterance` non
 *   constructible ou événement d'erreur sont des résultats typés ;
 * - la promesse se résout toujours (jamais de rejet) : une voix manquante ou
 *   une lecture annulée ne doit jamais bloquer la session.
 */
export class WebSpeechPort implements SpeechPort {
  isAvailable(): boolean {
    return typeof globalThis.speechSynthesis !== 'undefined' && globalThis.speechSynthesis !== null;
  }

  voices(locale: LocaleCode): readonly SpeechVoice[] {
    if (!this.isAvailable()) {
      return [];
    }
    try {
      const wanted = locale.toLowerCase();
      const matching = globalThis.speechSynthesis
        .getVoices()
        .filter((voice) => voice.lang.toLowerCase().startsWith(wanted))
        .map((voice) => ({
          id: voice.voiceURI,
          name: voice.name,
          locale: voice.lang,
          isDefault: voice.default === true,
        }));
      // Tri de pertinence : voix par défaut d'abord, correspondance de langue
      // exacte ensuite (`fr-FR` avant `fr-CA` pour la locale `fr`).
      return matching.sort((a, b) => rankVoice(a, wanted) - rankVoice(b, wanted));
    } catch {
      return [];
    }
  }

  async speak(request: SpeechRequest): Promise<SpeechResult> {
    if (!this.isAvailable()) {
      return unsupportedResult();
    }
    try {
      const utterance = new SpeechSynthesisUtterance(request.text);
      utterance.lang = localeToTag(request.locale);
      utterance.rate = clamp(request.rate ?? 1, 0.5, 2);
      utterance.pitch = clamp(request.pitch ?? 1, 0, 2);
      utterance.volume = clamp(request.volume ?? 1, 0, 1);
      const voice = this.voices(request.locale)[0];
      if (voice !== undefined) {
        utterance.voice = findNativeVoice(voice.id) ?? null;
      }
      return await new Promise<SpeechResult>((resolve) => {
        utterance.onend = () => resolve({ ok: true });
        utterance.onerror = (event) => {
          resolve(
            event.error === 'canceled' || event.error === 'interrupted'
              ? { ok: false, reason: 'cancelled', message: 'lecture annulée' }
              : { ok: false, reason: 'error', message: event.error },
          );
        };
        globalThis.speechSynthesis.speak(utterance);
      });
    } catch (error) {
      return { ok: false, reason: 'error', message: messageOf(error) };
    }
  }

  cancel(): void {
    try {
      if (this.isAvailable()) {
        globalThis.speechSynthesis.cancel();
      }
    } catch {
      // Annuler ne doit jamais lever : absence de voix acceptée (L8).
    }
  }
}

function unsupportedResult(): SpeechResult {
  return {
    ok: false,
    reason: 'unsupported',
    message: 'synthèse vocale indisponible dans ce navigateur',
  };
}

/** Rang de pertinence croissant : défaut (0) < langue exacte (1) < préfixe (2). */
function rankVoice(voice: SpeechVoice, wantedLocale: string): number {
  if (voice.isDefault) {
    return 0;
  }
  return voice.locale.toLowerCase() === wantedLocale ? 1 : 2;
}

function localeToTag(locale: LocaleCode): string {
  return locale === 'en' ? 'en-US' : 'fr-FR';
}

function findNativeVoice(voiceId: string): SpeechSynthesisVoice | null {
  try {
    return (
      globalThis.speechSynthesis.getVoices().find((voice) => voice.voiceURI === voiceId) ?? null
    );
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
