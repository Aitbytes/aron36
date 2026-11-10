import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '@/App';
import { createAppServices, hydrate } from '@/application/bootstrap';
import { createStore } from '@/application/store';
import { createUseCases } from '@/application/usecases';
import { createInfrastructure, MemoryStorageAdapter } from '@/infrastructure';

/**
 * Preuve de composition : reproduit l'ordre exact de `main.tsx`
 * (infrastructure → services → hydratation → store → cas d'usage → rendu) avec
 * un stockage mémoire, donc **sans `localStorage`**.
 */
describe('composition racine de l’application', () => {
  it('démarre sur un profil neuf, prêt, sans erreur de persistance', () => {
    const infrastructure = createInfrastructure({
      storagePort: new MemoryStorageAdapter(),
      timeZone: 'Europe/Paris',
    });
    const services = createAppServices({
      storage: infrastructure.storage,
      clock: infrastructure.clock,
      ids: infrastructure.ids,
      speech: infrastructure.speech,
      createRandom: infrastructure.createRandom,
      newSeed: () => 'graine-de-test',
    });

    const { state, status } = hydrate(services);
    expect(status).toBe('empty');
    expect(state.ready).toBe(true);
    expect(state.lastError).toBeNull();

    render(
      <App
        store={createStore(state)}
        clock={infrastructure.clock}
        useCases={createUseCases(services)}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Accueil' })).toBeInTheDocument();
    expect(screen.getByText(/cartes à réviser/u)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Progression protégée' })).toBeNull();
  });
});
