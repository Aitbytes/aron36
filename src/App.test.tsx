import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '@/App';

describe('socle React', () => {
  it('monte le composant racine et expose le titre du projet', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Aron 36' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Contrats gelés' })).toBeInTheDocument();
  });
});
