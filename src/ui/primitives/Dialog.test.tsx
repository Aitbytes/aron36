import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button, Dialog } from '@/ui/primitives';

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ouvrir</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Confirmer" closeLabel="Fermer">
        <p>Contenu de la boîte</p>
        <Button variant="secondary">Action interne</Button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('Échap ferme la boîte et rend le focus au déclencheur', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Ouvrir' });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('piège le focus dans la boîte à la tabulation', async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Action interne' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus();
  });
});
