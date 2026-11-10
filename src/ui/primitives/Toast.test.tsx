import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button, ToastProvider, useToast } from '@/ui/primitives';

function Host() {
  const { show } = useToast();
  return (
    <>
      <Button onClick={() => show({ title: 'Sauvegarde impossible', tone: 'danger' })}>
        Erreur
      </Button>
      <Button onClick={() => show({ title: 'Import terminé', body: 'Détail' })}>Information</Button>
    </>
  );
}

function renderToastLayer() {
  return render(
    <ToastProvider label="Notifications" closeLabel="Fermer la notification">
      <Host />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  it('expose une région aria-live et un role status', async () => {
    const user = userEvent.setup();
    renderToastLayer();

    expect(screen.getByLabelText('Notifications')).toHaveAttribute('aria-live', 'polite');

    await user.click(screen.getByRole('button', { name: 'Information' }));

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Import terminé')).toBeInTheDocument();
  });

  it('annonce les erreurs en role alert', async () => {
    const user = userEvent.setup();
    renderToastLayer();

    await user.click(screen.getByRole('button', { name: 'Erreur' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('Sauvegarde impossible');
  });
});
