import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from '@/ui/primitives';

describe('ProgressBar', () => {
  it('expose aria-valuenow, aria-valuemin et aria-valuemax', () => {
    render(<ProgressBar value={0.4} label="Progression du niveau" />);

    const bar = screen.getByRole('progressbar', { name: 'Progression du niveau' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '1');
    expect(bar).toHaveAttribute('aria-valuenow', '0.4');
  });

  it('remplit la barre proportionnellement à la valeur (régression « 0 % »)', () => {
    // Bug réel : `inlineSize: "0 %"` (espace avant le %) est une déclaration CSS
    // invalide. Elle était ignorée et le remplissage reprenait 100 % de largeur :
    // toutes les barres de l'application paraissaient pleines à 0.
    const { rerender } = render(<ProgressBar value={0} max={12} label="Progression vide" />);
    const fill = screen.getByRole('progressbar', { name: 'Progression vide' })
      .firstElementChild as HTMLElement;
    expect(fill.style.inlineSize).toBe('0%');

    rerender(<ProgressBar value={6} max={12} label="Progression vide" />);
    expect(fill.style.inlineSize).toBe('50%');

    rerender(<ProgressBar value={12} max={12} label="Progression vide" />);
    expect(fill.style.inlineSize).toBe('100%');
  });

  it('borne une valeur hors bornes avant de l’annoncer', () => {
    render(<ProgressBar value={4} max={3} label="Progression bornée" />);

    const bar = screen.getByRole('progressbar', { name: 'Progression bornée' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
  });
});
