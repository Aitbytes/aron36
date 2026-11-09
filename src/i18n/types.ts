import type { LocalizedText, LocaleCode } from '@/domain/shared/types';

/**
 * Internationalisation (Phase 3-4).
 *
 * Le français est la locale par défaut et de repli. Les chaînes d'interface
 * vivent dans des catalogues typés ; le contenu des questions porte ses propres
 * traductions (`LocalizedText`). Aucun texte visible n'est codé en dur dans un
 * composant.
 */

/** Locale par défaut. */
export const DEFAULT_LOCALE: LocaleCode = 'fr';

/** Locales supportées, dans l'ordre de préférence. */
export const SUPPORTED_LOCALES = ['fr', 'en'] as const satisfies readonly LocaleCode[];

/** Clé de message en dot.case, ex. `session.reveal`. */
export type MessageKey = string;

/** Paramètres d'interpolation (nombres déjà formatés ou valeurs brutes). */
export type MessageParams = Readonly<Record<string, string | number>>;

/** Catalogue complet d'une locale. */
export type MessageCatalog = Readonly<Record<MessageKey, string>>;

/** Catalogue chargé, avec son étiquette de sélection. */
export interface LocaleCatalog {
  readonly code: LocaleCode;
  /** Nom de la langue dans sa propre langue, ex. « Français ». */
  readonly label: LocalizedText;
  readonly messages: MessageCatalog;
}

/** Fonction de traduction ; interpolation `{param}` et repli sur le français. */
export type Translator = (key: MessageKey, params?: MessageParams) => string;

/** Contrat du service i18n consommé par l'UI. */
export interface I18n {
  readonly locale: LocaleCode;
  readonly availableLocales: readonly LocaleCode[];
  readonly t: Translator;
  /** Change la locale, la persiste via les settings et notifie l'UI. */
  setLocale(locale: LocaleCode): void;
}
