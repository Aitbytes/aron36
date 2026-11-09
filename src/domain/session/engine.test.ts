import { describe, expect, it } from 'vitest';

import type { DrillDirection, ReviewGrade } from '@/domain/shared/types';

import { buildSession } from './builder';
import { sessionEngine } from './engine';
import type { SessionAnswerInput, SessionPlan, SessionState } from './types';
import { makeCardsFor, makeContext, makeRequest } from './test-fixtures';

const ALL_QUESTION_IDS = Array.from({ length: 36 }, (_unused, index) => index + 1);

function buildPlan(requestOverrides: Parameters<typeof makeRequest>[0] = {}): SessionPlan {
  const result = buildSession(
    makeRequest({ maxItems: 12, ...requestOverrides }),
    makeContext({ cards: makeCardsFor(ALL_QUESTION_IDS) }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`plan attendu : ${result.failure}`);
  }
  return result.plan;
}

function answerInput(
  itemId: string,
  grade: ReviewGrade,
  overrides: Partial<SessionAnswerInput> = {},
): SessionAnswerInput {
  return {
    itemId,
    grade,
    confidence: null,
    responseTimeMs: 5_000,
    hintsUsed: 0,
    channel: 'written',
    now: 2_000_000,
    ...overrides,
  };
}

function currentItemId(state: SessionState): string {
  const item = state.plan.items[state.currentIndex];
  if (item === undefined) {
    throw new Error('aucun item courant');
  }
  return item.id;
}

/** Avance jusqu'au premier item de la direction demandée. */
function reachDirection(state: SessionState, direction: DrillDirection): SessionState {
  let current = state;
  while (current.phase !== 'completed') {
    const item = current.plan.items[current.currentIndex];
    if (item !== undefined && item.direction === direction) {
      return current;
    }
    const revealed = sessionEngine.revealAnswer(current);
    const result = sessionEngine.submitAnswer(revealed, answerInput(item!.id, 'good'));
    if (!result.ok) {
      throw new Error(`soumission intermédiaire refusée : ${result.failure}`);
    }
    current = result.submission.state;
  }
  throw new Error(`direction introuvable : ${direction}`);
}

describe('engine — démarrage et machine à états', () => {
  it('démarre en phase `asking`, index 0, zéro indice révélé', () => {
    const plan = buildPlan();
    const state = sessionEngine.start(plan, 1_000);
    expect(state.phase).toBe('asking');
    expect(state.currentIndex).toBe(0);
    expect(state.revealedHints).toBe(0);
    expect(state.answers).toEqual([]);
    expect(state.startedAt).toBe(1_000);
    expect(state.completedAt).toBeNull();
  });

  it('révèle les indices un par un et plafonne au plan d’indices (L9)', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 5 });
    const hintCount = plan.items[0]?.hints.length ?? 0;
    expect(hintCount).toBeGreaterThan(0);

    let state = sessionEngine.start(plan, 1_000);
    for (let step = 1; step <= hintCount; step += 1) {
      state = sessionEngine.revealNextHint(state);
      expect(state.revealedHints).toBe(step);
    }
    const capped = sessionEngine.revealNextHint(state);
    expect(capped).toBe(state);
    expect(capped.revealedHints).toBe(hintCount);
  });

  it('révéler la réponse ne note pas (L1)', () => {
    const plan = buildPlan();
    const asking = sessionEngine.start(plan, 1_000);
    const revealed = sessionEngine.revealAnswer(asking);
    expect(revealed.phase).toBe('revealed');
    expect(revealed.answers).toEqual([]);
    expect(sessionEngine.revealAnswer(revealed)).toBe(revealed);
  });

  it('n’avance plus les indices hors phase `asking`', () => {
    const plan = buildPlan();
    const revealed = sessionEngine.revealAnswer(sessionEngine.start(plan, 1_000));
    expect(sessionEngine.revealNextHint(revealed)).toBe(revealed);
  });
});

describe('engine — soumissions rejetées explicitement', () => {
  it('refuse une soumission hors phase `revealed`', () => {
    const plan = buildPlan();
    const state = sessionEngine.start(plan, 1_000);
    const result = sessionEngine.submitAnswer(state, answerInput(currentItemId(state), 'good'));
    expect(result).toEqual({ ok: false, failure: 'wrong-phase' });
  });

  it('refuse un item inconnu', () => {
    const plan = buildPlan();
    const state = sessionEngine.revealAnswer(sessionEngine.start(plan, 1_000));
    const result = sessionEngine.submitAnswer(state, answerInput('item-inexistant', 'good'));
    expect(result).toEqual({ ok: false, failure: 'unknown-item' });
  });

  it('refuse une double soumission du même item', () => {
    const plan = buildPlan();
    const start = sessionEngine.start(plan, 1_000);
    const firstItemId = currentItemId(start);
    const first = sessionEngine.submitAnswer(
      sessionEngine.revealAnswer(start),
      answerInput(firstItemId, 'good'),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    // L'item précédent est déjà dans `answers` : sa soumission est rejetée.
    const nextRevealed = sessionEngine.revealAnswer(first.submission.state);
    const second = sessionEngine.submitAnswer(nextRevealed, answerInput(firstItemId, 'good'));
    expect(second).toEqual({ ok: false, failure: 'item-already-answered' });
  });

  it('refuse toute soumission après la fin de session', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 1 });
    const start = sessionEngine.start(plan, 1_000);
    const revealed = sessionEngine.revealAnswer(start);
    const submitted = sessionEngine.submitAnswer(
      revealed,
      answerInput(currentItemId(start), 'good'),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    const after = sessionEngine.submitAnswer(
      submitted.submission.state,
      answerInput('n-importe-quoi', 'good'),
    );
    expect(after).toEqual({ ok: false, failure: 'session-completed' });
  });
});

describe('engine — réponse, feedback et progression', () => {
  it('produit une réponse normalisée depuis la saisie', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const start = sessionEngine.start(plan, 1_000);
    const revealed = sessionEngine.revealAnswer(start);
    const result = sessionEngine.submitAnswer(
      revealed,
      answerInput(currentItemId(start), 'hard', {
        confidence: 3,
        responseTimeMs: 4_200,
        hintsUsed: 2,
        channel: 'spoken',
        now: 7_777,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const { answer, feedback, completed, state } = result.submission;
    const item = plan.items[0]!;
    expect(answer.itemId).toBe(item.id);
    expect(answer.questionId).toBe(item.questionId);
    expect(answer.direction).toBe(item.direction);
    expect(answer.exerciseKind).toBe(item.exerciseKind);
    expect(answer.grade).toBe('hard');
    expect(answer.isCorrect).toBe(true);
    expect(answer.confidence).toBeNull();
    expect(answer.responseTimeMs).toBe(4_200);
    expect(answer.hintsUsed).toBe(2);
    expect(answer.channel).toBe('spoken');
    expect(answer.answeredAt).toBe(7_777);
    expect(feedback.expectedAnswer).toEqual(item.expectedAnswer);
    expect(feedback.mentalImage).toEqual(item.mentalImage);
    expect(feedback.messageKey).toContain('session.feedback');
    expect(completed).toBe(false);
    expect(state.phase).toBe('asking');
    expect(state.currentIndex).toBe(1);
    expect(state.revealedHints).toBe(0);
    expect(state.answers).toHaveLength(1);
  });

  it('`again` n’est jamais correct et `hard` est partiel', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const start = sessionEngine.start(plan, 1_000);
    const revealed = sessionEngine.revealAnswer(start);
    const result = sessionEngine.submitAnswer(revealed, answerInput(currentItemId(start), 'again'));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.submission.answer.isCorrect).toBe(false);
    expect(result.submission.feedback.correct).toBe(false);
    expect(result.submission.feedback.errorSignal).not.toBe('none');

    const hard = buildPlan({ mode: 'learning', maxItems: 3 });
    const hardStart = sessionEngine.start(hard, 1_000);
    const hardResult = sessionEngine.submitAnswer(
      sessionEngine.revealAnswer(hardStart),
      answerInput(currentItemId(hardStart), 'hard'),
    );
    expect(hardResult.ok).toBe(true);
    if (hardResult.ok) {
      expect(hardResult.submission.feedback.errorSignal).toBe('partial-answer');
    }
  });

  it('déduit `number-confusion` pour `question-to-number` (L13)', () => {
    const plan = buildPlan({ maxItems: 12 });
    const state = reachDirection(sessionEngine.start(plan, 1_000), 'question-to-number');
    const result = sessionEngine.submitAnswer(
      sessionEngine.revealAnswer(state),
      answerInput(currentItemId(state), 'again', { responseTimeMs: 5_000 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submission.feedback.errorSignal).toBe('number-confusion');
      expect(result.submission.feedback.messageKey).toBe('session.feedback.numberConfusion');
    }
  });

  it('déduit `keyword-confusion` et `wrong-question` selon la direction', () => {
    const keywordPlan = buildPlan({ maxItems: 12 });
    const keywordState = reachDirection(
      sessionEngine.start(keywordPlan, 1_000),
      'keyword-to-question',
    );
    const keyword = sessionEngine.submitAnswer(
      sessionEngine.revealAnswer(keywordState),
      answerInput(currentItemId(keywordState), 'again'),
    );
    expect(keyword.ok).toBe(true);
    if (keyword.ok) {
      expect(keyword.submission.feedback.errorSignal).toBe('keyword-confusion');
    }

    const orderPlan = buildPlan({ maxItems: 12 });
    const orderState = reachDirection(sessionEngine.start(orderPlan, 1_000), 'order-to-question');
    const order = sessionEngine.submitAnswer(
      sessionEngine.revealAnswer(orderState),
      answerInput(currentItemId(orderState), 'again'),
    );
    expect(order.ok).toBe(true);
    if (order.ok) {
      expect(order.submission.feedback.errorSignal).toBe('wrong-question');
    }
  });

  it('démarre directement en `completed` sur un plan vide', () => {
    const emptyPlan: SessionPlan = { ...buildPlan(), items: [] };
    const state = sessionEngine.start(emptyPlan, 1_000);
    expect(state.phase).toBe('completed');
    expect(state.currentIndex).toBe(0);
    expect(state.completedAt).toBe(1_000);
  });

  it('déduit `omission` sur une réponse instantanée vide', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const state = sessionEngine.start(plan, 1_000);
    const result = sessionEngine.submitAnswer(
      sessionEngine.revealAnswer(state),
      answerInput(currentItemId(state), 'again', { responseTimeMs: 0 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submission.feedback.errorSignal).toBe('omission');
    }
  });

  it('conserve la confiance seulement si la session l’exige (L12)', () => {
    const reviewPlan = buildPlan({ mode: 'review', maxItems: 3 });
    const reviewState = sessionEngine.revealAnswer(sessionEngine.start(reviewPlan, 1_000));
    const reviewResult = sessionEngine.submitAnswer(
      reviewState,
      answerInput(currentItemId(reviewState), 'good', { confidence: 4 }),
    );
    expect(reviewResult.ok).toBe(true);
    if (reviewResult.ok) {
      expect(reviewResult.submission.answer.confidence).toBe(4);
    }

    const learningPlan = buildPlan({ mode: 'learning', maxItems: 3 });
    const learningState = sessionEngine.revealAnswer(sessionEngine.start(learningPlan, 1_000));
    const learningResult = sessionEngine.submitAnswer(
      learningState,
      answerInput(currentItemId(learningState), 'good', { confidence: 4 }),
    );
    expect(learningResult.ok).toBe(true);
    if (learningResult.ok) {
      expect(learningResult.submission.answer.confidence).toBeNull();
    }
  });

  it('termine la session avec les index et l’instant fournis', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 1 });
    const start = sessionEngine.start(plan, 1_000);
    const revealed = sessionEngine.revealAnswer(start);
    const result = sessionEngine.submitAnswer(
      revealed,
      answerInput(currentItemId(start), 'good', { now: 12_345 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.submission.completed).toBe(true);
    expect(result.submission.state.phase).toBe('completed');
    expect(result.submission.state.currentIndex).toBe(plan.items.length);
    expect(result.submission.state.completedAt).toBe(12_345);
  });

  it('ne mute jamais l’état d’entrée', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const start = sessionEngine.start(plan, 1_000);
    const revealed = sessionEngine.revealAnswer(start);
    const before = JSON.stringify(revealed);
    const result = sessionEngine.submitAnswer(revealed, answerInput(currentItemId(start), 'good'));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(revealed)).toBe(before);
    expect(revealed.answers).toEqual([]);
    expect(revealed.phase).toBe('revealed');
  });
});
