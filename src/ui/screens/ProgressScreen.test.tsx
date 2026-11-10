import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { REFERENCE_TIME } from '@/application/progress/testState';
import { makeDueCard, makeProgress } from '@/application/store/test-fixtures';
import type { UseCases, StartSessionInput } from '@/application/usecases';
import type { PersistedProgress } from '@/domain/progress/types';
import { QUESTION_CATALOG } from '@/domain/questions';
import { DAY_MS } from '@/domain/shared/types';
import type { DrillDirection } from '@/domain/shared/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';
import { TestProviders, createUiHarness } from '@/test/uiHarness';
import { ProgressScreen } from '@/ui/screens/ProgressScreen';

const DIRECTIONS: readonly DrillDirection[] = [
  'order-to-question',
  'keyword-to-question',
  'image-to-question',
];

/**
 * Progression de test couvrant les cinq états de nœud dans l'acte I, tout en
 * laissant l'acte II verrouillé (une seule question maîtrisée sur douze).
 */
function buildProgressWithFiveStates(): PersistedProgress {
  const reviewLogs: ReviewLog[] = [];
  for (const direction of DIRECTIONS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      reviewLogs.push({
        id: `q1-${direction}-${String(attempt)}`,
        sessionId: 'session-q1',
        questionId: 1,
        direction,
        exerciseKind: 'production',
        grade: 'good',
        reviewedAt: REFERENCE_TIME - (10 - attempt) * 3_600_000,
        previousDueAt: 0,
        nextDueAt: REFERENCE_TIME + DAY_MS,
        intervalDays: 30,
        elapsedDays: 10,
        responseTimeMs: 5_000,
        hintsUsed: 0,
        confidence: null,
      });
    }
  }

  const cards: Record<string, CardState> = {
    // Maîtrisé : intervalle ≥ 21 j + série de notes de qualité dans 3 directions.
    '1': {
      ...makeDueCard(1, REFERENCE_TIME + DAY_MS),
      intervalDays: 30,
      stabilityDays: 30,
      reps: 6,
      lastReviewedAt: REFERENCE_TIME - 3_600_000,
    },
    // Dû : échéance dépassée.
    '2': makeDueCard(2, REFERENCE_TIME - DAY_MS),
    // En apprentissage : palier au futur.
    '3': {
      ...makeDueCard(3, REFERENCE_TIME + DAY_MS),
      phase: 'learning',
      intervalDays: 10 / 1440,
      stabilityDays: 0.2,
      lastReviewedAt: REFERENCE_TIME - 600_000,
      lastGrade: 'good',
    },
    // Disponible : révision planifiée plus tard.
    '4': makeDueCard(4, REFERENCE_TIME + DAY_MS),
  };

  return makeProgress({ cards, reviewLogs });
}

function renderProgress(progress: PersistedProgress) {
  const harness = createUiHarness({ progress });
  const startSession = vi.fn((input: StartSessionInput) =>
    harness.useCases.startSession.execute(input),
  );
  const useCases: UseCases = {
    ...harness.useCases,
    startSession: { execute: startSession },
  };
  render(
    <TestProviders harness={harness} useCases={useCases}>
      <ProgressScreen />
    </TestProviders>,
  );
  return { harness, startSession };
}

describe('carte de progression', () => {
  it('rend les cinq états de nœud avec un libellé accessible distinct', () => {
    renderProgress(buildProgressWithFiveStates());

    const expectedStates = [
      'Maîtrisé',
      'Dû aujourd’hui',
      'En apprentissage',
      'Disponible',
      'Verrouillé',
    ];
    for (const state of expectedStates) {
      const nodes = screen.getAllByRole('button', {
        name: new RegExp(`— ${state}$`, 'u'),
      });
      expect(nodes.length).toBeGreaterThan(0);
    }
  });

  it('explique le verrouillage d’un acte et n’appelle pas startSession', async () => {
    const user = userEvent.setup();
    const { startSession } = renderProgress(buildProgressWithFiveStates());

    // L'acte II est verrouillé : sa raison est lisible.
    expect(screen.getByText(/pour ouvrir l’acte 2\./u)).toBeInTheDocument();

    const actButtons = screen.getAllByRole('button', { name: 'Réviser cet acte' });
    const lockedButton = actButtons[1];
    if (lockedButton === undefined) {
      throw new Error('le bouton de l’acte II doit exister');
    }
    expect(lockedButton).toBeDisabled();

    await user.click(lockedButton);
    fireEvent.click(lockedButton);

    expect(startSession).not.toHaveBeenCalled();
  });

  it('ouvre le détail d’un nœud avec le bon texte de question', async () => {
    const user = userEvent.setup();
    renderProgress(buildProgressWithFiveStates());
    const question = QUESTION_CATALOG.byId.get(1);
    if (question === undefined) {
      throw new Error('la question 1 doit exister dans le catalogue');
    }

    await user.click(screen.getByRole('button', { name: /^Question 1 —/u }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(question.prompt.fr)).toBeInTheDocument();
    expect(within(dialog).getByText(question.mentalImage.fr)).toBeInTheDocument();
  });

  it('« Réviser cet acte » démarre une session avec actIds', async () => {
    const user = userEvent.setup();
    const { startSession } = renderProgress(buildProgressWithFiveStates());

    const actButtons = screen.getAllByRole('button', { name: 'Réviser cet acte' });
    const firstActButton = actButtons[0];
    if (firstActButton === undefined) {
      throw new Error('le bouton de l’acte I doit exister');
    }

    await user.click(firstActButton);

    expect(startSession).toHaveBeenCalledWith({ mode: 'review', actIds: [1] });
  });
});
