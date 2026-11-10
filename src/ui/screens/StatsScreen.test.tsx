import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildFullProgress, REFERENCE_TIME } from '@/application/progress/testState';
import { DAY_MS } from '@/domain/shared/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { TestProviders } from '@/test/uiHarness';
import { createUiHarness } from '@/test/uiHarness';

import { StatsScreen } from './StatsScreen';

/** Fixture sans aucun jugement de confiance : `calibrationGap` vaut `null`. */
function progressWithoutConfidence(): PersistedProgress {
  const base = buildFullProgress();
  return {
    ...base,
    reviewLogs: base.reviewLogs.map((log) => ({ ...log, confidence: null })),
  };
}

function renderStats(progress?: PersistedProgress) {
  const harness = createUiHarness(progress === undefined ? {} : { progress });
  return render(
    <TestProviders harness={harness}>
      <StatsScreen />
    </TestProviders>,
  );
}

describe('tableau de bord', () => {
  it('affiche un message dédié quand la calibration est indéterminée (jamais « 0 »)', () => {
    renderStats(progressWithoutConfidence());

    expect(screen.getByText('Pas encore assez de jugements de confiance.')).toBeInTheDocument();
    expect(screen.queryByText(/Écart de calibration/u)).toBeNull();
  });

  it('affiche la progression d’un badge verrouillé et la date d’un badge débloqué', () => {
    const { container } = renderStats();

    // `serie-7` est verrouillé dans la fixture : progression `6 / 7`.
    expect(screen.getByText('6 / 7')).toBeInTheDocument();

    // `premier-pas` est débloqué : la date est portée par un élément `time`.
    const unlockedAt = REFERENCE_TIME - 30 * DAY_MS;
    const time = container.querySelector(`time[datetime="${new Date(unlockedAt).toISOString()}"]`);
    expect(time).not.toBeNull();
    expect(time?.textContent).toContain('Débloqué le');
  });

  it('ne révèle pas le nom d’un badge secret verrouillé', () => {
    renderStats();

    expect(screen.queryByText('Retour')).toBeNull();
    expect(screen.getAllByText('Badge secret').length).toBeGreaterThan(0);
  });

  it('affiche les statistiques par direction avec leurs chiffres exacts', () => {
    renderStats();

    for (const label of [
      'Ordre → question',
      'Mot-clé → question',
      'Image → question',
      'Numéro → question',
      'Question → numéro',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Une production par direction dans la fixture.
    expect(screen.getAllByText('1 tentative')).toHaveLength(5);
    expect(screen.getByText('Précision : 50 %')).toBeInTheDocument();
    expect(screen.getByText('Temps moyen : 2,7 s')).toBeInTheDocument();
  });
});
