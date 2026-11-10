import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createUiHarness, renderApp } from '@/test/uiHarness';

describe('composition racine', () => {
  it('monte l’application avec la progression hydratée et l’accueil', () => {
    renderApp(createUiHarness());

    expect(screen.getByRole('heading', { level: 1, name: 'Accueil' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('affiche le bandeau de récupération sans proposer d’action destructive sur une version future', () => {
    renderApp(
      createUiHarness({
        lastError: { code: 'future-version', message: 'version future', details: { version: '2' } },
      }),
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Progression protégée' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réinitialiser la progression' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Importer une sauvegarde' })).toBeNull();
  });

  it('affiche l’écran de chargement tant que la progression n’est pas hydratée', () => {
    renderApp(createUiHarness({ ready: false }));

    expect(screen.getByText('Chargement de votre progression…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Accueil' })).toBeNull();
  });
});
