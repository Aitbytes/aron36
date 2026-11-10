import type { LocalizedText, LocaleCode } from '@/domain/shared/types';

import type { MessageKey } from './locales/fr';

/**
 * Internationalisation (Phase 4).
 *
 * Le français est la locale par défaut et de repli. Les chaînes d'interface
 * vivent dans des catalogues typés ; le contenu des questions porte ses propres
 * traductions (`LocalizedText`). Aucun texte visible n'est codé en dur dans un
 * composant.
 *
 * `MessageKey` est l'union **exacte** des clés de `locales/fr.ts` : une clé
 * absente ou surnuméraire dans `en.ts` casse la compilation.
 */

export type { MessageKey } from './locales/fr';

/** Locale par défaut. */
export const DEFAULT_LOCALE: LocaleCode = 'fr';

/** Locales supportées, dans l'ordre de préférence. */
export const SUPPORTED_LOCALES = ['fr', 'en'] as const satisfies readonly LocaleCode[];

/** Paramètres d'interpolation (nombres formatés via `Intl` par le traducteur). */
export type MessageParams = Readonly<Record<string, string | number>>;

/** Catalogue complet d'une locale : exactement les clés du français. */
export type MessageCatalog = Readonly<Record<MessageKey, string>>;

/** Catalogue chargé, avec son étiquette de sélection. */
export interface LocaleCatalog {
  readonly code: LocaleCode;
  /** Nom de la langue dans sa propre langue, ex. « Français ». */
  readonly label: LocalizedText;
  readonly messages: MessageCatalog;
}

/**
 * Fonction de traduction.
 *
 * - interpolation `{param}` (les nombres passent par `Intl.NumberFormat`) ;
 * - pluriel simple : si `params.count` est un nombre et que `key_one`/`key_other`
 *   existent, la forme correspondante est choisie ;
 * - repli déterministe : locale demandée → français.
 */
export type Translator = (key: MessageKey, params?: MessageParams) => string;

/** Contrat du service i18n consommé par l'UI. */
export interface I18n {
  readonly locale: LocaleCode;
  readonly availableLocales: readonly LocaleCode[];
  readonly t: Translator;
  /** Change la locale, la persiste via les settings et notifie l'UI. */
  setLocale(locale: LocaleCode): void;
}
