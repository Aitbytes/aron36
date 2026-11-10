import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/ui/primitives';

describe('Button', () => {
  it('désactivé ne déclenche pas onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Valider
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'Valider' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('en chargement ne déclenche pas onClick et annonce aria-busy', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Enregistrer
      </Button>,
    );

    const button = screen.getByRole('button', { name: /Enregistrer/u });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();

    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });
});
