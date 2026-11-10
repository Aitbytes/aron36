import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import globalCss from '@/styles/global.css?raw';
import { createUiHarness, renderApp } from '@/test/uiHarness';

describe('AppShell — coque et navigation', () => {
  it('affiche le niveau, la XP et la série du store', () => {
    renderApp(createUiHarness());

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();
    expect(screen.getAllByText('Niveau 5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Série de 6 jours').length).toBeGreaterThan(0);
  });

  it('navigue au clavier : Tab jusqu’à Collection puis Entrée change d’écran', async () => {
    const user = userEvent.setup();
    renderApp(createUiHarness());
    const target = screen.getByRole('button', { name: 'Collection' });

    for (let step = 0; step < 20 && document.activeElement !== target; step += 1) {
      await user.tab();
    }
    expect(target).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(screen.getByRole('heading', { level: 1, name: 'Collection' })).toBeInTheDocument();
    expect(target).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Accueil' })).not.toHaveAttribute('aria-current');
  });

  it('reflète la préférence de mouvement du joueur sur `<html>`', () => {
    renderApp(createUiHarness());

    expect(document.documentElement).toHaveAttribute('data-reduced-motion', 'system');
  });

  it('suit le changement de préférence de mouvement (réduire les animations)', async () => {
    const user = userEvent.setup();
    renderApp(createUiHarness());

    await user.click(screen.getByRole('button', { name: 'Réglages' }));
    await user.click(screen.getByRole('radio', { name: 'Réduire les animations' }));

    expect(document.documentElement).toHaveAttribute('data-reduced-motion', 'reduce');
  });

  it('la feuille globale neutralise les transitions sous data-reduced-motion', () => {
    expect(globalCss).toContain(":root[data-reduced-motion='reduce']");
    expect(globalCss).toContain('--motion-fast: 0ms');
    expect(globalCss).toContain('--motion-normal: 0ms');
  });

  it('expose un lien d’évitement vers le contenu principal', () => {
    renderApp(createUiHarness());

    expect(screen.getByRole('link', { name: 'Aller au contenu' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });
});
