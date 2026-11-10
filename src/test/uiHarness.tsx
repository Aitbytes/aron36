/* eslint-disable react-refresh/only-export-components -- utilitaire de test, jamais chargé par Vite en développement. */
import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { App } from '@/App';
import { createAppServices } from '@/application/bootstrap';
import { progressCodec } from '@/application/progress';
import { buildFullProgress, REFERENCE_TIME } from '@/application/progress/testState';
import { createInitialAppState, createStore } from '@/application/store';
import type { AppState, AppStore } from '@/application/store';
import {
  createSeedFactory,
  createSequentialIds,
  FixedClock,
  HARNESS_OFFSET_MINUTES,
  HARNESS_TIME_ZONE,
  silentSpeech,
} from '@/application/usecases/test-doubles';
import { createUseCases } from '@/application/usecases';
import type { AppServices, UseCases } from '@/application/usecases';
import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress, ProgressError } from '@/domain/progress/types';
import type { EpochMs, RandomSeed } from '@/domain/shared/types';
import { createTranslator, I18nProvider } from '@/i18n';
import { MemoryStorageAdapter } from '@/infrastructure';
import { ToastProvider } from '@/ui/primitives';
import { ActionsProvider, ClockProvider, StoreProvider } from '@/ui/store';

/**
 * Harnais d'interface pour les tests (aucun `localStorage`, aucune horloge
 * réelle, aucun aléa non maîtrisé) :
 * - `MemoryStorageAdapter` (contrat réel de l'infrastructure) ;
 * - `FixedClock` (décalage UTC constant) ;
 * - identifiants séquentiels et graine fixe.
 *
 * Le stockage est amorcé avec la progression de la fixture **encodée par le
 * vrai codec**, de sorte que les cas d'usage et le store partagent le même état —
 * exactement comme en production après `hydrate`.
 */
export interface UiHarnessOptions {
  readonly progress?: PersistedProgress | undefined;
  readonly now?: EpochMs | undefined;
  readonly offsetMinutes?: number | undefined;
  readonly timeZone?: string | undefined;
  readonly seed?: RandomSeed | undefined;
  /** Erreur de persistance à afficher (`bandeau de récupération`), sinon `null`. */
  readonly lastError?: ProgressError | null | undefined;
  /** `false` simule une progression non encore hydratée (écran de chargement). */
  readonly ready?: boolean | undefined;
}

export interface UiHarness {
  readonly store: AppStore;
  readonly clock: FixedClock;
  readonly services: AppServices;
  readonly useCases: UseCases;
  readonly storage: MemoryStorageAdapter;
  readonly progress: PersistedProgress;
}

export function createUiHarness(options: UiHarnessOptions = {}): UiHarness {
  const clock = new FixedClock(
    options.now ?? REFERENCE_TIME,
    options.offsetMinutes ?? HARNESS_OFFSET_MINUTES,
    options.timeZone ?? HARNESS_TIME_ZONE,
  );
  const storage = new MemoryStorageAdapter();
  const services = createAppServices({
    storage,
    clock,
    ids: createSequentialIds(),
    speech: silentSpeech,
    newSeed: createSeedFactory(options.seed ?? 'ui-harness-seed'),
  });
  const progress = options.progress ?? buildFullProgress();
  storage.write(STORAGE_KEY, progressCodec.encode(progress));

  const initial: AppState = {
    ...createInitialAppState(progress),
    ready: options.ready ?? true,
    lastError: options.lastError ?? null,
  };

  return {
    store: createStore(initial),
    clock,
    services,
    useCases: createUseCases(services),
    storage,
    progress,
  };
}

/** Monte l'application complète (composition réelle de `App`). */
export function renderApp(harness: UiHarness, useCases: UseCases = harness.useCases): RenderResult {
  return render(<App store={harness.store} clock={harness.clock} useCases={useCases} />);
}

export interface TestProvidersProps {
  readonly harness: UiHarness;
  readonly useCases?: UseCases | undefined;
  readonly children: ReactNode;
}

/** Même pile de fournisseurs que `App`, avec des cas d'usage remplaçables. */
export function TestProviders({ harness, useCases, children }: TestProvidersProps) {
  const locale = harness.store.getState().ui.locale;
  const t = createTranslator(locale);
  return (
    <StoreProvider store={harness.store}>
      <ClockProvider clock={harness.clock}>
        <I18nProvider locale={locale}>
          <ToastProvider label={t('toast.regionLabel')} closeLabel={t('toast.dismiss')}>
            <ActionsProvider useCases={useCases ?? harness.useCases}>{children}</ActionsProvider>
          </ToastProvider>
        </I18nProvider>
      </ClockProvider>
    </StoreProvider>
  );
}
