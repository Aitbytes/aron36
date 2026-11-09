import type {
  SpeechPort,
  SpeechRequest,
  SpeechResult,
  SpeechVoice,
} from '@/application/ports/SpeechPort';
import type { LocaleCode } from '@/domain/shared/types';

/** Port vocal **neutre** : comportement explicite quand aucune synthèse n'est
 * disponible (navigateur sans Web Speech, tests, préférences). Ne lève jamais,
 * ne télécharge rien, ne produit aucun son : l'apprenant garde la production
 * orale auto-déclarée (L8).
 */
export class NullSpeechPort implements SpeechPort {
  isAvailable(): boolean {
    return false;
  }

  voices(_locale: LocaleCode): readonly SpeechVoice[] {
    return [];
  }

  speak(_request: SpeechRequest): Promise<SpeechResult> {
    return Promise.resolve({
      ok: false,
      reason: 'unsupported',
      message: null,
    });
  }

  cancel(): void {
    // Aucune lecture en cours : opération neutre.
  }
}
