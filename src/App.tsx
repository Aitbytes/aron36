import { useEffect } from 'react';
import type { ReactNode } from 'react';

import type { ClockPort } from '@/application/ports/ClockPort';
import type { AppStore } from '@/application/store';
import type { UseCases } from '@/application/usecases';
import { I18nProvider, useT } from '@/i18n';
import { ToastProvider } from '@/ui/primitives';
import { AppShell } from '@/ui/shell';
import { ActionsProvider, ClockProvider, StoreProvider, useSelect } from '@/ui/store';

export interface AppProps {
  /** Store applicatif hydraté par la composition racine (`main.tsx`). */
  readonly store: AppStore;
  /** Horloge injectée : l'UI n'appelle jamais `Date.now()`. */
  readonly clock: ClockPort;
  /** Cas d'usage : consommés **uniquement** par `ActionsProvider`. */
  readonly useCases: UseCases;
}

/**
 * Point de composition de l'interface.
 *
 * Aucune logique métier : `App` branche les fournisseurs (store, horloge, i18n,
 * notifications, actions) puis délègue à `AppShell`. L'ordre des fournisseurs
 * suit leurs dépendances : la locale (`ui.locale`) est lue **avant** l'i18n, et
 * `ActionsProvider` a besoin des notifications **et** du traducteur.
 */
export function App({ store, clock, useCases }: AppProps) {
  return (
    <StoreProvider store={store}>
      <ClockProvider clock={clock}>
        <LocalizedTree useCases={useCases} />
      </ClockProvider>
    </StoreProvider>
  );
}

function LocalizedTree({ useCases }: { readonly useCases: UseCases }) {
  const locale = useSelect((state) => state.ui.locale);

  // `lang` doit suivre la langue de l'interface (WCAG 3.1.1) : la déclaration
  // statique d'`index.html` ne suffit plus dès que la locale est persistée.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <ToastLayer>
        <ActionsProvider useCases={useCases}>
          <AppShell />
        </ActionsProvider>
      </ToastLayer>
    </I18nProvider>
  );
}

/** Les libellés de la région de notifications sont traduits, donc fournis ici. */
function ToastLayer({ children }: { readonly children: ReactNode }) {
  const t = useT();
  return (
    <ToastProvider label={t('toast.regionLabel')} closeLabel={t('toast.dismiss')}>
      {children}
    </ToastProvider>
  );
}
