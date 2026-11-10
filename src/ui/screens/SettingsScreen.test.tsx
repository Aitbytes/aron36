import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { UseCases } from '@/application/usecases';
import { progressCodec } from '@/application/progress';
import { createTranslator, I18nProvider } from '@/i18n';
import { ToastProvider } from '@/ui/primitives';
import { ActionsProvider, ClockProvider, StoreProvider, useSelect } from '@/ui/store';
import type { UiHarness } from '@/test/uiHarness';
import { createUiHarness } from '@/test/uiHarness';

import { SettingsScreen } from './SettingsScreen';

/**
 * Même pile de fournisseurs que `App`, mais **réactive à la locale** :
 * `LocalizedTree` lit `ui.locale` dans le store, ce qui permet de vérifier que
 * changer la langue recharge réellement le catalogue (et pas seulement le store).
 */
function ReactiveProviders({
  harness,
  useCases,
  children,
}: {
  readonly harness: UiHarness;
  readonly useCases: UseCases;
  readonly children: ReactNode;
}) {
  return (
    <StoreProvider store={harness.store}>
      <ClockProvider clock={harness.clock}>
        <LocalizedReactive useCases={useCases}>{children}</LocalizedReactive>
      </ClockProvider>
    </StoreProvider>
  );
}

/** Lit `ui.locale` dans le store : le catalogue se recharge au changement. */
function LocalizedReactive({
  useCases,
  children,
}: {
  readonly useCases: UseCases;
  readonly children: ReactNode;
}) {
  const locale = useSelect((state) => state.ui.locale);
  const t = createTranslator(locale);
  return (
    <I18nProvider locale={locale}>
      <ToastProvider label={t('toast.regionLabel')} closeLabel={t('toast.dismiss')}>
        <ActionsProvider useCases={useCases}>{children}</ActionsProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

function renderSettings(useCases: UseCases, harness: UiHarness) {
  return render(
    <ReactiveProviders harness={harness} useCases={useCases}>
      <SettingsScreen />
    </ReactiveProviders>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('écran de réglages', () => {
  it('change la langue, persiste le réglage et recharge le catalogue', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    const spy = vi.fn();
    const useCases: UseCases = {
      ...harness.useCases,
      updateSettings: {
        execute: (input) => {
          spy(input);
          return harness.useCases.updateSettings.execute(input);
        },
      },
    };
    renderSettings(useCases, harness);

    expect(screen.getByRole('heading', { level: 1, name: 'Réglages' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'English' }));

    expect(spy).toHaveBeenCalledWith({ settings: { locale: 'en' } });
    expect(harness.store.getState().ui.locale).toBe('en');
    expect(harness.store.getState().progress.player.settings.locale).toBe('en');
    // Le catalogue est rechargé par le fournisseur i18n.
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('exporte la progression dans un fichier JSON', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    const createObjectURL = vi.fn((_blob: Blob): string => 'blob:aron36');
    const revokeObjectURL = vi.fn((_url: string): void => undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation((): void => undefined);

    renderSettings(harness.useCases, harness);
    await user.click(screen.getByRole('button', { name: 'Exporter la progression' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.contexts.at(0);
    expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    if (!(anchor instanceof HTMLAnchorElement)) {
      throw new Error('l’export doit cliquer un lien de téléchargement');
    }
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls.at(0)?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('application/json');
    expect(anchor.download).toMatch(/^aron36-progress-.*\.json$/u);
    expect(anchor.href).toBe('blob:aron36');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:aron36');
  });

  it('importe une sauvegarde choisie par l’utilisateur', async () => {
    const harness = createUiHarness();
    const imported = harness.progress;
    const envelope = JSON.stringify(
      progressCodec.toExport(
        { ...imported, player: { ...imported.player, totalXp: 4_242 } },
        imported.savedAt,
      ),
    );
    renderSettings(harness.useCases, harness);

    const input = document.querySelector('input[type="file"]');
    if (input === null) {
      throw new Error('le champ d’import doit être présent');
    }
    fireEvent.change(input, {
      target: { files: [new File([envelope], 'sauvegarde.json', { type: 'application/json' })] },
    });

    await waitFor(() => {
      expect(harness.store.getState().progress.player.totalXp).toBe(4_242);
    });
  });

  it('exige la double confirmation avant de réinitialiser ; annuler n’appelle rien', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    const spy = vi.fn();
    const useCases: UseCases = {
      ...harness.useCases,
      resetProgress: {
        execute: () => {
          spy();
          return harness.useCases.resetProgress.execute();
        },
      },
    };
    renderSettings(useCases, harness);

    await user.click(screen.getByRole('button', { name: 'Réinitialiser la progression' }));
    let dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirmer la réinitialisation' });
    expect(confirm).toBeDisabled();

    // Le mot exact reste obligatoire : un mot approchant ne débloque rien.
    await user.type(within(dialog).getByRole('textbox'), 'effacer!');
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(spy).not.toHaveBeenCalled();

    // Deuxième essai, confirmé.
    await user.click(screen.getByRole('button', { name: 'Réinitialiser la progression' }));
    dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox'));
    await user.type(within(dialog).getByRole('textbox'), 'EFFACER');
    const enabled = within(dialog).getByRole('button', {
      name: 'Confirmer la réinitialisation',
    });
    expect(enabled).toBeEnabled();
    await user.click(enabled);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Progression réinitialisée')).toBeInTheDocument();
  });

  it('signale un échec d’écriture par un toast, sans planter', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    const useCases: UseCases = {
      ...harness.useCases,
      updateSettings: {
        execute: (input) => {
          const output = harness.useCases.updateSettings.execute(input);
          return {
            progress: output.progress,
            writeFailure: { code: 'quota-exceeded', message: 'stockage plein', details: null },
          };
        },
      },
    };
    renderSettings(useCases, harness);

    await user.click(screen.getByRole('radio', { name: 'English' }));

    expect(screen.getByText('Sauvegarde impossible')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });
});
