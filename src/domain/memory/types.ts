import type { ActId, EpochMs, LocalizedText, QuestionId } from '@/domain/shared/types';

/**
 * Imagerie mentale et films mentaux (L6, L7).
 *
 * Un film mental est la scène visuelle continue d'un acte : 12 images ordonnées,
 * reliées deux à deux par une transition narrative. L'apprenant déroule le film
 * pour retrouver l'ordre des questions, pas l'inverse.
 */
export interface FilmScene {
  /** Rang de la scène dans le film, 1..12 (identique à `positionInAct`). */
  readonly order: number;
  /** Question illustrée par cette scène. */
  readonly questionId: QuestionId;
  /** Description visuelle de la scène. */
  readonly image: LocalizedText;
  /**
   * Phrase de liaison vers la scène suivante (méthode des liens, L7).
   * `null` uniquement pour la dernière scène.
   */
  readonly transitionToNext: LocalizedText | null;
}

/** Film mental d'un acte. */
export interface MemoryFilm {
  readonly actId: ActId;
  /** Titre du film, ex. « Le Dîner ». */
  readonly title: LocalizedText;
  /** Pitch en une phrase qui installe le décor. */
  readonly pitch: LocalizedText;
  /** Exactement 12 scènes, ordonnées par `order` croissant. */
  readonly scenes: readonly FilmScene[];
}

/** Origine d'une accroche personnelle (effet de génération, L10). */
export type PersonalHookKind = 'keyword' | 'story' | 'autobiographical';

/**
 * Accroche écrite par l'apprenant pour une question (L10, L11).
 *
 * Le texte reste dans la langue de l'apprenant (pas de traduction) : il est
 * réinjecté tel quel comme indice de drill et ne quitte jamais l'appareil.
 */
export interface PersonalHook {
  readonly questionId: QuestionId;
  readonly kind: PersonalHookKind;
  /** Texte libre saisi par l'apprenant, 1..280 caractères. */
  readonly text: string;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
}

/** Bibliothèque d'accroches personnelles : au plus une par question. */
export interface HookLibrary {
  readonly hooks: readonly PersonalHook[];
  /** Date de dernière modification, utilisée pour l'export et les badges. */
  readonly updatedAt: EpochMs;
}
