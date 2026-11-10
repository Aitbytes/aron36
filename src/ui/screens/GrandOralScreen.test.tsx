import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REFERENCE_TIME } from '@/application/progress/testState';
import { makeDueCard, makeProgress, NOW } from '@/application/store/test-fixtures';
import type { FinishSessionOutput, UseCases } from '@/application/usecases';
import type { PersistedProgress } from '@/domain/progress/types';
import type { AnswerChannel, SessionSummary } from '@/domain/session/types';
import type { DrillDirection, QuestionId } from '@/domain/shared/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';
import { createUiHarness, TestProviders } from '@/test/uiHarness';
import type { UiHarness } from '@/test/uiHarness';

import { GRAND_ORAL_ITEM_COUNT } from './grandOralCriteria';
import { GrandOralScreen } from './GrandOralScreen';

/** Monte l'écran du Grand Oral avec la pile de fournisseurs réelle. */
function renderOral(harness: UiHarness, useCases?: UseCases) {
  return render(
    <TestProviders harness={harness} useCases={useCases}>
      <GrandOralScreen />
    </TestProviders>,
  );
}

/** Démarre une vraie session `grand-oral` puis l'installe dans le store. */
function startExamSession(
  harness: UiHarness,
  input: { readonly questionIds?: readonly QuestionId[]; readonly maxItems?: number } = {},
) {
  const started = harness.useCases.startSession.execute({ mode: 'grand-oral', ...input });
  harness.store.dispatch({ type: 'session/started', state: started.state });
  harness.store.dispatch({ type: 'ui/navigate', screen: 'grand-oral' });
  return started.state;
}

const DAY_MS = 86_400_000;

/** Directions suffisantes pour satisfaire le critère de maîtrise (≥ 3). */
const MASTERY_DIRECTIONS: readonly DrillDirection[] = [
  'order-to-question',
  'keyword-to-question',
  'image-to-question',
];

/**
 * Progression dont les 36 questions atteignent les critères de maîtrise.
 *
 * Construite localement (et non via `makeMasteredProgress`, dont les instants
 * sont négatifs) parce que le harnais amorce le stockage **par le vrai codec**,
 * qui refuse tout `EpochMs` négatif.
 */
function masteredProgress(): PersistedProgress {
  const cards: Record<string, CardState> = {};
  const reviewLogs: ReviewLog[] = [];
  for (let questionId = 1; questionId <= 36; questionId += 1) {
    cards[String(questionId)] = {
      ...makeDueCard(questionId, REFERENCE_TIME + DAY_MS),
      intervalDays: 30,
      stabilityDays: 30,
      reps: 6,
      lastReviewedAt: REFERENCE_TIME - 3_600_000,
    };
    let reviewedAt = REFERENCE_TIME - 10 * DAY_MS;
    for (const direction of MASTERY_DIRECTIONS) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        reviewLogs.push({
          id: `mastery-${String(questionId)}-${direction}-${String(attempt)}`,
          sessionId: 'session-mastery',
          questionId,
          direction,
          exerciseKind: 'production',
          grade: 'good',
          reviewedAt,
          previousDueAt: 0,
          nextDueAt: reviewedAt + DAY_MS,
          intervalDays: 30,
          elapsedDays: 10,
          responseTimeMs: 5_000,
          hintsUsed: 0,
          confidence: null,
        });
        reviewedAt += 3_600_000;
      }
    }
  }
  return makeProgress({ cards, reviewLogs });
}

/** Progression dont seuls les actes I et (partiellement) II sont maîtrisés. */
function partialMasteryProgress(): PersistedProgress {
  const mastered = masteredProgress();
  const cards = Object.fromEntries(
    Object.entries(mastered.cards).filter(([id]) => Number(id) <= 18),
  );
  const reviewLogs = mastered.reviewLogs.filter((log) => log.questionId <= 18);
  return makeProgress({ cards, reviewLogs });
}

/** Résumé de Grand Oral, pour piloter le verdict sans simuler la session. */
function oralSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: 'session-oral',
    mode: 'grand-oral',
    itemCount: GRAND_ORAL_ITEM_COUNT,
    answeredCount: GRAND_ORAL_ITEM_COUNT,
    correctCount: GRAND_ORAL_ITEM_COUNT,
    accuracy: 1,
    durationMs: 300_000,
    xpAwarded: 0,
    spokenCount: GRAND_ORAL_ITEM_COUNT,
    window: 'evening',
    byDirection: {
      'order-to-question': { attempts: 0, correct: 0 },
      'keyword-to-question': { attempts: 0, correct: 0 },
      'image-to-question': { attempts: 0, correct: 0 },
      'number-to-question': { attempts: 0, correct: 0 },
      'question-to-number': { attempts: 0, correct: 0 },
    },
    ...overrides,
  };
}

/** Remplace `finishSession` par un verdict fourni : l'écran ne doit rien recalculer. */
function stubFinish(harness: UiHarness, summary: SessionSummary): UseCases {
  const finishSession = vi.fn((): FinishSessionOutput => ({
    summary,
    xp: { amount: 0, reason: 'session-complete', breakdown: null, questionId: null, at: NOW },
    updatedProgress: harness.progress,
    writeFailure: null,
  }));
  return { ...harness.useCases, finishSession: { execute: finishSession } };
}

/** Joue l'unique item d'une session plantée : confiance → révélation → note. */
async function playSingleItem(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '3 — moyen' }));
  await user.click(screen.getByRole('button', { name: 'Voir la réponse' }));
  await user.click(screen.getByRole('button', { name: '3. Bien' }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GrandOralScreen — conditions d’accès', () => {
  it('refuse l’examen tant que les trois actes ne sont pas maîtrisés, avec le compte exact', () => {
    renderOral(createUiHarness({ progress: partialMasteryProgress() }));

    expect(screen.getByRole('heading', { name: 'Examen encore verrouillé' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commencer l’examen' })).toBeNull();
    // Acte I complet, acte II à 6/12, acte III à 0/12 : le reste est chiffré.
    expect(screen.getByText('0 question restante')).toBeInTheDocument();
    expect(screen.getByText('6 questions restantes')).toBeInTheDocument();
    expect(screen.getByText('12 questions restantes')).toBeInTheDocument();
    expect(screen.getByText('Acte 1')).toBeInTheDocument();
    expect(screen.getByText('Acte 3')).toBeInTheDocument();
  });

  it('ouvre l’examen quand les trois actes sont maîtrisés', () => {
    renderOral(createUiHarness({ progress: masteredProgress() }));

    expect(screen.getByRole('button', { name: 'Commencer l’examen' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Examen encore verrouillé' })).toBeNull();
  });
});

describe('GrandOralScreen — examen', () => {
  it('affiche le temps écoulé mesuré par l’horloge injectée', () => {
    vi.useFakeTimers();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness);
    renderOral(harness);

    expect(screen.getByText('00:00')).toBeInTheDocument();

    act(() => {
      harness.clock.advance(90_000);
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('01:30')).toBeInTheDocument();
  });

  it('force le canal « spoken » et ne propose aucun choix de canal', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    const channels: AnswerChannel[] = [];
    const useCases: UseCases = {
      ...harness.useCases,
      submitAnswer: {
        execute: (input) => {
          channels.push(input.channel);
          return harness.useCases.submitAnswer.execute(input);
        },
      },
    };
    renderOral(harness, useCases);

    expect(screen.queryByRole('button', { name: 'À voix haute' })).toBeNull();
    await playSingleItem(user);

    expect(channels).toEqual(['spoken']);
    expect(harness.store.getState().session?.answers[0]?.channel).toBe('spoken');
  });

  it('ne rend aucun champ de saisie et confirme les indices désactivés', () => {
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    renderOral(harness);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(document.querySelector('input, textarea')).toBeNull();
    expect(harness.store.getState().session?.plan.config.hintPolicy).toBe('disabled');
    expect(screen.getByText('Aucun indice : c’est l’examen.')).toBeInTheDocument();
  });
});

describe('GrandOralScreen — bilan', () => {
  it('réussit à 5 min et 95 % : palier Diamant', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    const summary = oralSummary({ durationMs: 300_000, accuracy: 0.95, correctCount: 34 });
    renderOral(harness, stubFinish(harness, summary));

    await playSingleItem(user);

    expect(screen.getByRole('heading', { name: 'Bilan du Grand Oral' })).toBeInTheDocument();
    expect(screen.getByText('Palier Diamant')).toBeInTheDocument();
    expect(screen.getByText('05:00')).toBeInTheDocument();
    expect(screen.getByText('95 %')).toBeInTheDocument();
    expect(screen.getByText('36 / 36')).toBeInTheDocument();
    expect(screen.queryByText(/au lieu de/u)).toBeNull();
    expect(screen.getByRole('button', { name: 'Refaire' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retour à l’accueil' })).toBeInTheDocument();
  });

  it('échoue à 7 min et 95 % : cause durée, chiffrée', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    const summary = oralSummary({ durationMs: 420_000, accuracy: 0.95 });
    renderOral(harness, stubFinish(harness, summary));

    await playSingleItem(user);

    expect(screen.getByText('Palier Or')).toBeInTheDocument();
    expect(screen.getByText('Durée : 07:00 au lieu de 06:00.')).toBeInTheDocument();
    // La durée mesurée reste lisible au bilan, sans recalcul.
    expect(screen.getAllByText('07:00').length).toBeGreaterThan(0);
  });

  it('échoue à 5 min et 84 % : cause précision, chiffrée', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    const summary = oralSummary({ durationMs: 300_000, accuracy: 0.84, correctCount: 30 });
    renderOral(harness, stubFinish(harness, summary));

    await playSingleItem(user);

    expect(screen.getByText('Palier Argent')).toBeInTheDocument();
    expect(screen.getByText('Précision : 84 % au lieu de 90 %.')).toBeInTheDocument();
    expect(screen.getByText('84 %')).toBeInTheDocument();
  });
});

describe('GrandOralScreen — sortie du bilan', () => {
  it('« Refaire » relance un examen neuf', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    renderOral(harness, stubFinish(harness, oralSummary({ durationMs: 300_000, accuracy: 0.95 })));
    await playSingleItem(user);

    await user.click(screen.getByRole('button', { name: 'Refaire' }));

    expect(harness.store.getState().session?.plan.mode).toBe('grand-oral');
    expect(harness.store.getState().session?.phase).toBe('asking');
    expect(screen.queryByRole('heading', { name: 'Bilan du Grand Oral' })).toBeNull();
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('« Retour à l’accueil » quitte le bilan', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    renderOral(harness, stubFinish(harness, oralSummary({ durationMs: 300_000, accuracy: 0.95 })));
    await playSingleItem(user);

    await user.click(screen.getByRole('button', { name: 'Retour à l’accueil' }));

    expect(harness.store.getState().ui.screen).toBe('home');
  });
});

describe('GrandOralScreen — abandon', () => {
  it('confirme l’abandon puis ramène à l’accueil', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    renderOral(harness);

    await user.click(screen.getByRole('button', { name: 'Abandonner' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Oui, abandonner' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.store.getState().session).toBeNull();
    expect(harness.store.getState().ui.screen).toBe('home');
  });

  it('annule l’abandon et poursuit l’examen', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: masteredProgress() });
    startExamSession(harness, { questionIds: [7], maxItems: 1 });
    renderOral(harness);

    await user.click(screen.getByRole('button', { name: 'Abandonner' }));
    await user.click(screen.getByRole('button', { name: 'Continuer l’examen' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(harness.store.getState().session).not.toBeNull();
  });
});
