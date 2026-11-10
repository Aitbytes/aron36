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

  it('borne une valeur hors bornes avant de l’annoncer', () => {
    render(<ProgressBar value={4} max={3} label="Progression bornée" />);

    const bar = screen.getByRole('progressbar', { name: 'Progression bornée' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
  });
});
