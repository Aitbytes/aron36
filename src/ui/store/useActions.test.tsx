import { act, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { answerCurrentItem, startReviewSession } from '@/application/store/test-fixtures';
import type { StartSessionOutput, SubmitAnswerOutput, UseCases } from '@/application/usecases';
import { createUiHarness, TestProviders } from '@/test/uiHarness';
import type { UiHarness } from '@/test/uiHarness';
import { useActions } from '@/ui/store';
import type { ActionResult } from '@/ui/store';

/** Double de `UseCases` : tout cas d'usage non doublé échoue le test. */
function useCasesDouble(overrides: Partial<UseCases>): UseCases {
  const notImplemented = (): never => {
    throw new Error('cas d’usage non doublé dans ce test');
  };
  return {
    startSession: { execute: notImplemented },
    submitAnswer: { execute: notImplemented },
    finishSession: { execute: notImplemented },
    abandonSession: { execute: notImplemented },
    revealHint: { execute: notImplemented },
    revealAnswer: { execute: notImplemented },
    saveHook: { execute: notImplemented },
    importProgress: { execute: notImplemented },
    exportProgress: { execute: notImplemented },
    resetProgress: { execute: notImplemented },
    updateSettings: { execute: notImplemented },
    evaluateMastery: { execute: notImplemented },
    speak: { execute: notImplemented },
    ...overrides,
  };
}

function renderActions(useCases: UseCases, harness: UiHarness) {
  return renderHook(() => useActions(), {
    wrapper: ({ children }) => (
      <TestProviders harness={harness} useCases={useCases}>
        {children}
      </TestProviders>
    ),
  });
}

describe('useActions — surface d’action', () => {
  it('startSession appelle le cas d’usage et dispatche session/started', () => {
    const session = startReviewSession(1);
    const execute = vi.fn(() => ({ plan: session.plan, state: session }));
    const useCases = useCasesDouble({ startSession: { execute } });
    const harness = createUiHarness();
    const dispatch = vi.spyOn(harness.store, 'dispatch');
    const { result } = renderActions(useCases, harness);
    const actions = result.current;

    act(() => {
      actions.startSession({ mode: 'review' });
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'session/started' }));
    expect(harness.store.getState().session?.plan.id).toBe(session.plan.id);
  });

  it('remonte un échec d’écriture par une notification sans perdre l’issue', () => {
    const session = startReviewSession(1);
    const submission = answerCurrentItem(session, 'good');
    if (submission.feedback === null) {
      throw new Error('la fixture de session doit produire un feedback');
    }
    const harness = createUiHarness();
    const output: SubmitAnswerOutput = {
      session: submission.state,
      answer: submission.answer,
      feedback: submission.feedback,
      scheduledReview: null,
      xp: { amount: 0, reason: 'production-answer', breakdown: null, questionId: 1, at: 0 },
      newlyUnlockedBadges: [],
      updatedProgress: harness.progress,
      summary: null,
      writeFailure: { code: 'quota-exceeded', message: 'quota simulé', details: null },
    };
    const execute = vi.fn(() => output);
    const useCases = useCasesDouble({ submitAnswer: { execute } });
    const dispatch = vi.spyOn(harness.store, 'dispatch');
    const { result } = renderActions(useCases, harness);
    const actions = result.current;

    const holder: { outcome: ActionResult<SubmitAnswerOutput> | null } = { outcome: null };
    act(() => {
      holder.outcome = actions.submitAnswer({
        sessionId: submission.state.plan.id,
        itemId: submission.answer.itemId,
        grade: 'good',
        confidence: null,
        responseTimeMs: 5_000,
        hintsUsed: 0,
        channel: 'written',
      });
    });

    const outcome = holder.outcome;
    expect(outcome).not.toBeNull();
    if (outcome === null) {
      throw new Error('issue absente');
    }
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.warning?.code).toBe('quota-exceeded');
    }
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'session/answered' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Sauvegarde impossible');
  });

  it('speak délègue au cas d’usage de synthèse vocale', () => {
    const execute = vi.fn(() => Promise.resolve({ ok: true } as const));
    const useCases = useCasesDouble({ speak: { execute } });
    const harness = createUiHarness();
    const { result } = renderActions(useCases, harness);

    act(() => {
      result.current.speak('Lis-moi');
    });

    expect(execute).toHaveBeenCalledWith({ text: 'Lis-moi' });
  });

  it('refuse une session inconnue et ne dispatche rien', () => {
    // L'erreur inattendue est journalisée par l'action : ce test la simule.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const useCases = useCasesDouble({});
    const harness = createUiHarness();
    const dispatch = vi.spyOn(harness.store, 'dispatch');
    const { result } = renderActions(useCases, harness);
    const actions = result.current;

    const holder: { outcome: ActionResult<StartSessionOutput> | null } = { outcome: null };
    act(() => {
      holder.outcome = actions.startSession({ mode: 'review' });
    });

    const outcome = holder.outcome;
    expect(outcome?.ok).toBe(false);
    if (outcome !== null && !outcome.ok) {
      expect(outcome.reason).toBe('unknown');
    }
    expect(dispatch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});
