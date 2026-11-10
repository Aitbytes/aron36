import { createContext, useCallback, useContext } from 'react';

import type { LocalizedText, LocaleCode } from '@/domain/shared/types';

import { pickLocalized } from './t';
import type { Translator } from './types';

/** Valeur du contexte i18n : la locale active et son traducteur. */
export interface I18nContextValue {
  readonly locale: LocaleCode;
  readonly t: Translator;
}

/** Contexte nul par défaut : `useT` hors `I18nProvider` est une erreur de code. */
export const I18nContext = createContext<I18nContextValue | null>(null);

/** Valeur brute du contexte ; lève si le provider est absent. */
export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (value === null) {
    throw new Error('useI18n doit être utilisé sous <I18nProvider>.');
  }
  return value;
}

/** Traducteur de la locale active — surface principale des composants. */
export function useT(): Translator {
  return useI18n().t;
}

/** Locale active. */
export function useLocale(): LocaleCode {
  return useI18n().locale;
}

/** Raccourci `LocalizedText → string` pour le contenu du domaine (actes, quêtes). */
export function useLocalizedText(): (text: LocalizedText) => string {
  const locale = useLocale();
  return useCallback((text: LocalizedText) => pickLocalized(text, locale), [locale]);
}
