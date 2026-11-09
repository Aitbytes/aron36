import type { LocaleCode } from '@/domain/shared/types';

/**
 * Port de synthèse vocale (L8, récitation orale).
 *
 * Aucun son n'est enregistré ni envoyé : le navigateur lit le texte localement.
 * L'absence de voix n'est jamais bloquante ; l'apprenant peut toujours déclarer
 * sa production à l'oral.
 */

/** Voix disponible dans le navigateur. */
export interface SpeechVoice {
  readonly id: string;
  readonly name: string;
  readonly locale: string;
  readonly isDefault: boolean;
}

/** Demande de lecture. */
export interface SpeechRequest {
  /** Texte à lire, déjà localisé. */
  readonly text: string;
  readonly locale: LocaleCode;
  /** Vitesse relative, 0.5..2 (1 = normale). */
  readonly rate?: number;
  /** Hauteur relative, 0..2 (1 = normale). */
  readonly pitch?: number;
  /** Volume, 0..1. */
  readonly volume?: number;
}

/** Résultat d'une lecture. */
export type SpeechResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'unsupported' | 'cancelled' | 'error';
      readonly message: string | null;
    };

/** Contrat du port vocal. */
export interface SpeechPort {
  isAvailable(): boolean;
  /** Voix installées pour une locale, triées par pertinence. */
  voices(locale: LocaleCode): readonly SpeechVoice[];
  /** Lit le texte ; la promesse se résout à la fin ou à l'annulation. */
  speak(request: SpeechRequest): Promise<SpeechResult>;
  /** Annule la lecture en cours, sans erreur. */
  cancel(): void;
}
