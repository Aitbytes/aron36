import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { makeDueCard, makeProgress } from '@/application/store/test-fixtures';
import { UseCaseRejection } from '@/application/usecases';
import type { UseCases } from '@/application/usecases';
import { sessionBuilder, sessionEngine } from '@/domain/session';
import { makeContext, makeRequest } from '@/domain/session/test-fixtures';
import type { SessionItem, SessionState, SessionSummary } from '@/domain/session/types';
import type { DrillDirection, ReviewGrade } from '@/domain/shared/types';
import { createUiHarness, TestProviders } from '@/test/uiHarness';
import type { UiHarness } from '@/test/uiHarness';

import { SessionSummaryView } from './SessionSummaryView';
import { TrainScreen } from './TrainScreen';

/** Instant de référence des sessions plantées (aucune horloge réelle). */
const FIXTURE_NOW = 1_000_000;

/** Monte l'écran de jeu avec la pile de fournisseurs réelle (sans `localStorage`). */
function renderTrain(harness: UiHarness, useCases?: UseCases) {
  return render(
    <TestProviders harness={harness} useCases={useCases}>
      <TrainScreen />
    </TestProviders>,
  );
}

/** Démarre une vraie session via les cas d'usage puis l'installe dans le store. */
function startSession(
  harness: UiHarness,
  input: Parameters<UseCases['startSession']['execute']>[0],
) {
  const started = harness.useCases.startSession.execute(input);
  harness.store.dispatch({ type: 'session/started', state: started.state });
  harness.store.dispatch({ type: 'ui/navigate', screen: 'train' });
  return started.state;
}

/** Session plantée d'une seule question, forcée sur une direction de drill. */
function directionState(direction: DrillDirection): SessionState {
  const built = sessionBuilder.build(
    makeRequest({
      sessionId: `dir-${direction}`,
      seed: `seed-${direction}`,
      now: FIXTURE_NOW,
      mode: 'learning',
      questionIds: [25],
      directions: [direction],
      maxItems: 1,
    }),
    makeContext(),
  );
  if (!built.ok) {
    throw new Error(`plan de fixture invalide : ${built.failure}`);
  }
  return sessionEngine.start(built.plan, FIXTURE_NOW);
}

function plantState(harness: UiHarness, state: SessionState): void {
  harness.store.dispatch({ type: 'session/started', state });
  harness.store.dispatch({ type: 'ui/navigate', screen: 'train' });
}

function firstItem(harness: UiHarness): SessionItem {
  const item = harness.store.getState().session?.plan.items[0];
  if (item === undefined) {
    throw new Error('item de session manquant');
  }
  return item;
}

const GRADES: readonly ReviewGrade[] = ['again', 'hard', 'good', 'easy'];

const GRADE_LABELS: Readonly<Record<ReviewGrade, string>> = {
  again: '1. Je ne savais pas',
  hard: '2. Difficile',
  good: '3. Bien',
  easy: '4. Facile',
};

describe('TrainScreen — rendu des directions de drill', () => {
  it('order : affiche acte et position, jamais le numéro de question', () => {
    const harness = createUiHarness();
    plantState(harness, directionState('order-to-question'));
    renderTrain(harness);

    expect(screen.getByText('Acte 3, position 1')).toBeInTheDocument();
    expect(screen.queryByText('Question 25')).toBeNull();
    expect(screen.getByLabelText('Votre réponse').tagName).toBe('TEXTAREA');
  });

  it('keyword : met en avant le mot-clé et propose la saisie libre', () => {
    const harness = createUiHarness();
    plantState(harness, directionState('keyword-to-question'));
    renderTrain(harness);

    expect(screen.getByText('Mot-clé')).toBeInTheDocument();
    expect(screen.getByText('mot-cle-25')).toBeInTheDocument();
    expect(screen.getByLabelText('Votre réponse').tagName).toBe('TEXTAREA');
  });

  it('image : présente l’image mentale et propose la saisie libre', () => {
    const harness = createUiHarness();
    plantState(harness, directionState('image-to-question'));
    renderTrain(harness);

    expect(screen.getByText('Image mentale')).toBeInTheDocument();
    expect(screen.getByText('image mentale 25')).toBeInTheDocument();
    expect(screen.getByLabelText('Votre réponse').tagName).toBe('TEXTAREA');
  });

  it('number : affiche « Question 25 » et propose la saisie libre', () => {
    const harness = createUiHarness();
    plantState(harness, directionState('number-to-question'));
    renderTrain(harness);

    expect(screen.getByText('Question 25')).toBeInTheDocument();
    expect(screen.getByLabelText('Votre réponse').tagName).toBe('TEXTAREA');
  });

  it('question : affiche l’énoncé, la consigne et un champ numérique', () => {
    const harness = createUiHarness();
    plantState(harness, directionState('question-to-number'));
    renderTrain(harness);

    expect(screen.getByText('Question numéro 25 ?')).toBeInTheDocument();
    expect(screen.getByText('Quel numéro ?')).toBeInTheDocument();
    expect(screen.getByLabelText('Numéro de la question')).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('Numéro de la question')).toHaveAttribute('inputmode', 'numeric');
  });
});

describe('TrainScreen — indices progressifs', () => {
  it('révèle les indices progressivement puis les plafonne', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    startSession(harness, { mode: 'learning', questionIds: [7], maxItems: 1 });
    renderTrain(harness);

    const hints = firstItem(harness).hints;
    expect(hints.length).toBeGreaterThan(1);

    const reveal = screen.getByRole('button', { name: 'Révéler un indice' });
    await user.click(reveal);
    expect(screen.getByText('Indices utilisés : 1')).toBeInTheDocument();

    for (let index = 1; index < hints.length; index += 1) {
      await user.click(reveal);
    }
    expect(screen.getByText(`Indices utilisés : ${hints.length}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Révéler un indice' })).toBeNull();
    expect(screen.getByText('Tous les indices sont révélés.')).toBeInTheDocument();
  });

  it('n’affiche aucun bouton quand l’item n’a pas d’indice', () => {
    const harness = createUiHarness({ progress: makeProgress() });
    startSession(harness, { mode: 'grand-oral', questionIds: [7], maxItems: 1 });
    renderTrain(harness);

    expect(firstItem(harness).hints).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Révéler un indice' })).toBeNull();
    expect(screen.getByText('Aucun indice pour cet item.')).toBeInTheDocument();
  });
});

describe('TrainScreen — confiance (L12)', () => {
  it('bloque la révélation sans confiance, puis l’autorise et transmet la note', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({
      progress: makeProgress({ cards: { '7': makeDueCard(7, 0) } }),
    });
    startSession(harness, { mode: 'review', questionIds: [7], maxItems: 1 });
    renderTrain(harness);

    const reveal = screen.getByRole('button', { name: 'Voir la réponse' });
    expect(reveal).toBeDisabled();
    expect(
      screen.getByText('Choisissez un niveau de confiance avant de pouvoir révéler la réponse.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '3 — moyen' }));
    expect(reveal).toBeEnabled();

    await user.click(reveal);
    expect(screen.getByRole('heading', { name: 'Réponse attendue' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: GRADE_LABELS.good }));
    expect(screen.getByRole('heading', { name: 'Correction' })).toBeInTheDocument();

    const logs = harness.store.getState().progress.reviewLogs;
    expect(logs.at(-1)?.confidence).toBe(3);
  });
});

describe('TrainScreen — notation (L12/L13)', () => {
  it.each(GRADES)('dispatche la note « %s » et affiche le feedback', async (grade) => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    startSession(harness, { mode: 'learning', questionIds: [7], maxItems: 1 });
    renderTrain(harness);

    await user.click(screen.getByRole('button', { name: 'Voir la réponse' }));
    await user.click(screen.getByRole('button', { name: GRADE_LABELS[grade] }));

    const logs = harness.store.getState().progress.reviewLogs;
    expect(logs.at(-1)?.grade).toBe(grade);
    expect(screen.getByRole('heading', { name: 'Correction' })).toBeInTheDocument();
  });

  it('affiche le feedback puis avance sur « Continuer »', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    startSession(harness, { mode: 'learning', questionIds: [7, 8], maxItems: 2 });
    renderTrain(harness);

    expect(
      screen.getByRole('progressbar', { name: 'Progression de la session : 0 sur 2' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voir la réponse' }));
    await user.click(screen.getByRole('button', { name: GRADE_LABELS.good }));

    expect(screen.getByRole('heading', { name: 'Correction' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuer' }));

    expect(screen.queryByRole('heading', { name: 'Correction' })).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Progression de la session : 1 sur 2' }),
    ).toBeInTheDocument();
  });
});

describe('TrainScreen — prétest (L18)', () => {
  it('affiche une devinette sans feedback correctif', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: makeProgress() });
    startSession(harness, { mode: 'discovery', questionIds: [7], maxItems: 1 });
    renderTrain(harness);

    expect(firstItem(harness).isPretest).toBe(true);
    expect(screen.getByText('Devine, puis on verra')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voir la réponse' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Valider ma devinette' }));

    expect(
      screen.getByText('Devinette enregistrée. La correction arrivera à la prochaine tentative.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Correction' })).toBeNull();
    expect(screen.queryByText('Réponse attendue')).toBeNull();
  });
});

describe('TrainScreen — abandon', () => {
  it('confirme l’abandon puis ramène à l’accueil', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    startSession(harness, { mode: 'learning', questionIds: [7], maxItems: 1 });
    renderTrain(harness);

    await user.click(screen.getByRole('button', { name: 'Abandonner' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Oui, abandonner' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.store.getState().session).toBeNull();
    expect(harness.store.getState().ui.screen).toBe('home');
  });
});

describe('TrainScreen — refus', () => {
  it('affiche un message traduit et laisse la session utilisable', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    startSession(harness, { mode: 'learning', questionIds: [7], maxItems: 1 });

    const failing: UseCases = {
      ...harness.useCases,
      submitAnswer: {
        execute: () => {
          throw new UseCaseRejection(
            'session-submission-refused',
            { kind: 'submission', failure: 'wrong-phase' },
            'refus de test',
          );
        },
      },
    };
    renderTrain(harness, failing);

    await user.click(screen.getByRole('button', { name: 'Voir la réponse' }));
    await user.click(screen.getByRole('button', { name: GRADE_LABELS.good }));

    expect(
      screen.getAllByText('La réponse a été refusée par le moteur de session.').length,
    ).toBeGreaterThan(0);
    // La notation reste disponible : la session n’est pas cassée.
    expect(screen.getByRole('button', { name: GRADE_LABELS.hard })).toBeEnabled();
  });
});

describe('TrainScreen — fin de session', () => {
  it('affiche le bilan avec les valeurs du résumé, sans recalcul', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness();
    startSession(harness, { mode: 'learning', questionIds: [7], maxItems: 1 });

    const capture: { summary: SessionSummary | null } = { summary: null };
    const capturing: UseCases = {
      ...harness.useCases,
      submitAnswer: {
        execute: (input) => {
          const output = harness.useCases.submitAnswer.execute(input);
          capture.summary = output.summary;
          return output;
        },
      },
    };
    renderTrain(harness, capturing);

    await user.click(screen.getByRole('button', { name: 'Voir la réponse' }));
    await user.click(screen.getByRole('button', { name: GRADE_LABELS.good }));
    await user.click(screen.getByRole('button', { name: 'Continuer' }));

    expect(screen.getByRole('heading', { name: 'Session terminée' })).toBeInTheDocument();
    const summary = capture.summary;
    if (summary === null) {
      throw new Error('le résumé de session doit avoir été produit');
    }
    expect(screen.getByText(`${String(Math.round(summary.accuracy * 100))} %`)).toBeInTheDocument();
    expect(screen.getByText(`${String(summary.xpAwarded)} XP`)).toBeInTheDocument();
  });
});

describe('SessionSummaryView', () => {
  it('formate scrupuleusement les valeurs du résumé fourni', () => {
    const harness = createUiHarness();
    const summary: SessionSummary = {
      sessionId: 'session-bilan',
      mode: 'review',
      itemCount: 3,
      answeredCount: 3,
      correctCount: 2,
      accuracy: 0.5,
      durationMs: 125_000,
      xpAwarded: 42,
      spokenCount: 1,
      window: 'evening',
      byDirection: {
        'order-to-question': { attempts: 2, correct: 1 },
        'keyword-to-question': { attempts: 1, correct: 1 },
        'image-to-question': { attempts: 0, correct: 0 },
        'number-to-question': { attempts: 0, correct: 0 },
        'question-to-number': { attempts: 0, correct: 0 },
      },
    };
    render(
      <TestProviders harness={harness}>
        <SessionSummaryView summary={summary} onReplay={() => undefined} onHome={() => undefined} />
      </TestProviders>,
    );

    expect(screen.getByRole('heading', { name: 'Session terminée' })).toBeInTheDocument();
    expect(screen.getByText('50 %')).toBeInTheDocument();
    expect(screen.getByText('2 / 3 bonnes réponses')).toBeInTheDocument();
    expect(screen.getByText('42 XP')).toBeInTheDocument();
    expect(screen.getByText('2 min 5 s')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getAllByText('Rang → question').length).toBeGreaterThan(0);
    expect(screen.getByText('2 essais · 1 réussis')).toBeInTheDocument();
  });
});

describe('TrainScreen — état sans session', () => {
  it('annonce l’absence de session sans casser l’écran', () => {
    const harness = createUiHarness();
    renderTrain(harness);

    expect(screen.getByText('Aucune session active.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entraînement' })).toBeInTheDocument();
  });
});
