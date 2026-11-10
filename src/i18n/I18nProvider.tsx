import { useMemo } from 'react';
import type { ReactNode } from 'react';

import type { LocaleCode } from '@/domain/shared/types';

import { I18nContext } from './I18nContext';
import type { I18nContextValue } from './I18nContext';
import { createTranslator } from './t';

/** Props du fournisseur i18n : la locale vient de l'état applicatif (`ui.locale`). */
export interface I18nProviderProps {
  readonly locale: LocaleCode;
  readonly children: ReactNode;
}

/**
 * Fournit le traducteur de la locale active.
 *
 * Le traducteur n'est recréé qu'au changement de locale : les composants qui
 * dépendent de `t` ne re-rendent pas à chaque rendu du parent.
 */
export function I18nProvider({ locale, children }: I18nProviderProps) {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: createTranslator(locale) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
