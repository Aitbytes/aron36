import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { UpdateBanner } from './UpdateBanner';
import type { SwUpdateSignal } from './updateSignal';

/**
 * Bannière « Nouvelle version disponible ».
 *
 * Elle est la **seule** interface ajoutée pour la PWA, donc elle est testée sur
 * trois points : invisible par défaut (aucune régression sur les écrans
 * existants), annoncée poliment quand un worker attend (`role="status"`), et
 * jamais de rechargement sans clic.
 */

interface ManualSignal {
  readonly signal: SwUpdateSignal;
  readonly applyUpdate: ReturnType<typeof vi.fn>;
  readonly publish: (ready: boolean) => void;
}

/** Signal piloté à la main : le composant ne dépend d'aucun navigateur. */
function createManualSignal(): ManualSignal {
  let ready = false;
  const listeners = new Set<() => void>();
  const applyUpdate = vi.fn();
  return {
    signal: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      isUpdateReady: () => ready,
      applyUpdate,
    },
    applyUpdate,
    publish: (next) => {
      ready = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

function renderBanner(signal: SwUpdateSignal) {
  return render(
    <I18nProvider locale="fr">
      <UpdateBanner signal={signal} />
    </I18nProvider>,
  );
}

describe('UpdateBanner', () => {
  it('ne rend rien tant qu’aucune mise à jour n’attend', () => {
    renderBanner(createManualSignal().signal);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('affiche « Nouvelle version disponible » et un bouton de rechargement', () => {
    const manual = createManualSignal();
    renderBanner(manual.signal);

    act(() => {
      manual.publish(true);
    });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Nouvelle version disponible');
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeInTheDocument();
    // Aucun rechargement automatique : la détection n'agit pas, l'utilisateur décide.
    expect(manual.applyUpdate).not.toHaveBeenCalled();
  });

  it('applique la mise à jour seulement au clic', async () => {
    const user = userEvent.setup();
    const manual = createManualSignal();
    renderBanner(manual.signal);

    act(() => {
      manual.publish(true);
    });
    await user.click(screen.getByRole('button', { name: 'Recharger' }));

    expect(manual.applyUpdate).toHaveBeenCalledTimes(1);
  });
});
