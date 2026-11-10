import type { LocaleCode } from '@/domain/shared/types';

import { enMessages } from './locales/en';
import { frMessages } from './locales/fr';
import type { MessageCatalog, MessageKey, MessageParams, Translator } from './types';

/**
 * Traduction des messages d'interface (ADR 0005).
 *
 * Aucune requête, aucun chargement dynamique : les catalogues sont des modules
 * TypeScript, donc tree-shakables et hors ligne. `createTranslator` est pur et
 * mémoïsable par locale.
 */

const CATALOGS: Readonly<Record<LocaleCode, MessageCatalog>> = {
  fr: frMessages,
  en: enMessages,
};

/** Formats `Intl` mémoïsés par locale : instancier est coûteux, formater non. */
const NUMBER_FORMATS = new Map<LocaleCode, Intl.NumberFormat>();

/** Formate un nombre selon la locale (`Intl.NumberFormat`). */
export function formatNumber(value: number, locale: LocaleCode): string {
  let formatter = NUMBER_FORMATS.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale);
    NUMBER_FORMATS.set(locale, formatter);
  }
  return formatter.format(value);
}

/**
 * Sélectionne le texte localisé d'un contenu du domaine.
 * `fr` est toujours présent ; l'anglais est optionnel (repli français).
 */
export function pickLocalized(
  text: { readonly fr: string; readonly en?: string },
  locale: LocaleCode,
): string {
  if (locale === 'en') {
    return text.en ?? text.fr;
  }
  return text.fr;
}

/**
 * Choisit la forme plurielle d'une clé.
 *
 * Convention : une clé de base (forme neutre) peut être déclinée en `<clé>_one`
 * et `<clé>_other`. La règle est volontairement minimale (français et anglais :
 * singulier pour `count <= 1`) ; toute règle plus riche se teste ici.
 */
function selectPluralKey(catalog: MessageCatalog, key: MessageKey, count: unknown): MessageKey {
  if (typeof count !== 'number') {
    return key;
  }
  // Le motif `_one`/`_other` est une convention du catalogue, pas une garantie du
  // type : la vérification d'appartenance précède donc le cast, qui est borné à
  // l'union `MessageKey`.
  const candidate = `${key}${count > 1 ? '_other' : '_one'}` as MessageKey;
  return candidate in catalog ? candidate : key;
}

/** Remplace `{param}` par sa valeur ; un nombre est formaté via `Intl`. */
function interpolate(template: string, params: MessageParams | undefined, locale: LocaleCode) {
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      return match;
    }
    return typeof value === 'number' ? formatNumber(value, locale) : value;
  });
}

/**
 * Construit le traducteur d'une locale.
 *
 * Repli déterministe : locale demandée → français. Les clés brutes ne sont
 * jamais renvoyées en pratique : la complétude des catalogues est garantie par
 * le type `Record<MessageKey, string>`, donc `catalog[key]` existe toujours
 * pour une clé compilable.
 */
export function createTranslator(locale: LocaleCode): Translator {
  const catalog = CATALOGS[locale];
  return (key, params) => {
    const selected = selectPluralKey(catalog, key, params?.count);
    const template = catalog[selected] ?? catalog[key] ?? frMessages[key] ?? key;
    return interpolate(template, params, locale);
  };
}
