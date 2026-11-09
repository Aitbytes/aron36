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

/** Déclare la confiance (L12) si le plan l'exige, puis révèle l'item courant. */
function revealed(state: SessionState): SessionState {
  let current = state;
  if (current.plan.config.requiresConfidence) {
    const withConfidence = sessionEngine.setConfidence(current, 3);
    expect(withConfidence.ok).toBe(true);
    if (!withConfidence.ok) {
      throw new Error(`confiance refusée : ${withConfidence.failure}`);
    }
    current = withConfidence.state;
  }
  const result = sessionEngine.revealAnswer(current);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`révélation refusée : ${result.failure}`);
  }
  return result.state;
}

/** Avance jusqu'au premier item de la direction demandée. */
function reachDirection(state: SessionState, direction: DrillDirection): SessionState {
  let current = state;
  while (current.phase !== 'completed') {
    const item = current.plan.items[current.currentIndex];
    if (item !== undefined && item.direction === direction) {
      return current;
    }
    const result = sessionEngine.submitAnswer(revealed(current), answerInput(item!.id, 'good'));
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
    expect(state.confidence).toBeNull();
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
    const plan = buildPlan({ mode: 'learning', maxItems: 5 });
    const asking = sessionEngine.start(plan, 1_000);
    const revealedState = revealed(asking);
    expect(revealedState.phase).toBe('revealed');
    expect(revealedState.answers).toEqual([]);
    expect(sessionEngine.revealAnswer(revealedState)).toEqual({
      ok: false,
      failure: 'wrong-phase',
    });
  });

  it('n’avance plus les indices hors phase `asking`', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 5 });
    const revealedState = revealed(sessionEngine.start(plan, 1_000));
    expect(sessionEngine.revealNextHint(revealedState)).toBe(revealedState);
  });
});

describe('engine — métacognition L12', () => {
  it('confiance exigée avant révélation', () => {
    const plan = buildPlan({ mode: 'review', maxItems: 3 });
    const asking = sessionEngine.start(plan, 1_000);
    expect(plan.config.requiresConfidence).toBe(true);

    // Sans confiance, la révélation est refusée : L12 n'est pas décoratif.
    expect(sessionEngine.revealAnswer(asking)).toEqual({
      ok: false,
      failure: 'confidence-required',
    });

    const declared = sessionEngine.setConfidence(asking, 4);
    expect(declared.ok).toBe(true);
    if (!declared.ok) {
      return;
    }
    expect(declared.state.confidence).toBe(4);

    const revealedResult = sessionEngine.revealAnswer(declared.state);
    expect(revealedResult.ok).toBe(true);
    if (!revealedResult.ok) {
      return;
    }
    expect(revealedResult.state.phase).toBe('revealed');

    // La confiance jugée avant révélation est recopiée dans la réponse.
    const submitted = sessionEngine.submitAnswer(
      revealedResult.state,
      answerInput(currentItemId(asking), 'good'),
    );
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.submission.answer.confidence).toBe(4);
    }
  });

  it('submit sans confiance rejeté', () => {
    const plan = buildPlan({ mode: 'review', maxItems: 3 });
    const confirmed = revealed(sessionEngine.start(plan, 1_000));
    // État incohérent forcé : phase `revealed` sans jugement de confiance.
    const inconsistent: SessionState = { ...confirmed, confidence: null };
    expect(
      sessionEngine.submitAnswer(inconsistent, answerInput(currentItemId(inconsistent), 'good')),
    ).toEqual({ ok: false, failure: 'wrong-phase' });
  });

  it('révélation hors phase rejetée', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const asking = sessionEngine.start(plan, 1_000);
    const revealedState = revealed(asking);

    // Double révélation et confiance rétroactive : refusées.
    expect(sessionEngine.revealAnswer(revealedState)).toEqual({
      ok: false,
      failure: 'wrong-phase',
    });
    expect(sessionEngine.setConfidence(revealedState, 2)).toEqual({
      ok: false,
      failure: 'wrong-phase',
    });

    // Session terminée : plus aucune transition `asking → revealed`.
    const single = buildPlan({ mode: 'learning', maxItems: 1 });
    const submitted = sessionEngine.submitAnswer(
      revealed(sessionEngine.start(single, 1_000)),
      answerInput(single.items[0]!.id, 'good'),
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    expect(submitted.submission.state.phase).toBe('completed');
    expect(sessionEngine.revealAnswer(submitted.submission.state)).toEqual({
      ok: false,
      failure: 'wrong-phase',
    });
  });
});

describe('engine — soumissions rejetées explicitement', () => {
  it('refuse une soumission hors phase `revealed`', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const state = sessionEngine.start(plan, 1_000);
    const result = sessionEngine.submitAnswer(state, answerInput(currentItemId(state), 'good'));
    expect(result).toEqual({ ok: false, failure: 'wrong-phase' });
  });

  it('refuse un item inconnu', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const state = revealed(sessionEngine.start(plan, 1_000));
    const result = sessionEngine.submitAnswer(state, answerInput('item-inexistant', 'good'));
    expect(result).toEqual({ ok: false, failure: 'unknown-item' });
  });

  it('refuse une double soumission du même item', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const start = sessionEngine.start(plan, 1_000);
    const firstItemId = currentItemId(start);
    const first = sessionEngine.submitAnswer(revealed(start), answerInput(firstItemId, 'good'));
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    // L'item précédent est déjà dans `answers` : sa soumission est rejetée.
    const second = sessionEngine.submitAnswer(
      revealed(first.submission.state),
      answerInput(firstItemId, 'good'),
    );
    expect(second).toEqual({ ok: false, failure: 'item-already-answered' });
  });

  it('refuse toute soumission après la fin de session', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 1 });
    const start = sessionEngine.start(plan, 1_000);
    const submitted = sessionEngine.submitAnswer(
      revealed(start),
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
    const result = sessionEngine.submitAnswer(
      revealed(start),
      answerInput(currentItemId(start), 'hard', {
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
    expect(answer.isPretest).toBe(item.isPretest);
    expect(answer.responseTimeMs).toBe(4_200);
    expect(answer.hintsUsed).toBe(2);
    expect(answer.channel).toBe('spoken');
    expect(answer.answeredAt).toBe(7_777);
    expect(feedback?.expectedAnswer).toEqual(item.expectedAnswer);
    expect(feedback?.mentalImage).toEqual(item.mentalImage);
    expect(feedback?.messageKey).toContain('session.feedback');
    expect(completed).toBe(false);
    expect(state.phase).toBe('asking');
    expect(state.currentIndex).toBe(1);
    expect(state.revealedHints).toBe(0);
    expect(state.confidence).toBeNull();
    expect(state.answers).toHaveLength(1);
  });

  it('`again` n’est jamais correct et `hard` est partiel', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 3 });
    const start = sessionEngine.start(plan, 1_000);
    const result = sessionEngine.submitAnswer(
      revealed(start),
      answerInput(currentItemId(start), 'again'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.submission.answer.isCorrect).toBe(false);
    expect(result.submission.feedback?.correct).toBe(false);
    expect(result.submission.feedback?.errorSignal).not.toBe('none');

    const hard = buildPlan({ mode: 'learning', maxItems: 3 });
    const hardStart = sessionEngine.start(hard, 1_000);
    const hardResult = sessionEngine.submitAnswer(
      revealed(hardStart),
      answerInput(currentItemId(hardStart), 'hard'),
    );
    expect(hardResult.ok).toBe(true);
    if (hardResult.ok) {
      expect(hardResult.submission.feedback?.errorSignal).toBe('partial-answer');
    }
  });

  it('déduit `number-confusion` pour `question-to-number` (L13)', () => {
    const plan = buildPlan({ maxItems: 12 });
    const state = reachDirection(sessionEngine.start(plan, 1_000), 'question-to-number');
    const result = sessionEngine.submitAnswer(
      revealed(state),
      answerInput(currentItemId(state), 'again', { responseTimeMs: 5_000 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submission.feedback?.errorSignal).toBe('number-confusion');
      expect(result.submission.feedback?.messageKey).toBe('session.feedback.numberConfusion');
    }
  });

  it('déduit `keyword-confusion` et `wrong-question` selon la direction', () => {
    const keywordPlan = buildPlan({ maxItems: 12 });
    const keywordState = reachDirection(
      sessionEngine.start(keywordPlan, 1_000),
      'keyword-to-question',
    );
    const keyword = sessionEngine.submitAnswer(
      revealed(keywordState),
      answerInput(currentItemId(keywordState), 'again'),
    );
    expect(keyword.ok).toBe(true);
    if (keyword.ok) {
      expect(keyword.submission.feedback?.errorSignal).toBe('keyword-confusion');
    }

    const orderPlan = buildPlan({ maxItems: 12 });
    const orderState = reachDirection(sessionEngine.start(orderPlan, 1_000), 'order-to-question');
    const order = sessionEngine.submitAnswer(
      revealed(orderState),
      answerInput(currentItemId(orderState), 'again'),
    );
    expect(order.ok).toBe(true);
    if (order.ok) {
      expect(order.submission.feedback?.errorSignal).toBe('wrong-question');
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
      revealed(state),
      answerInput(currentItemId(state), 'again', { responseTimeMs: 0 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submission.feedback?.errorSignal).toBe('omission');
    }
  });

  it('conserve la confiance seulement si la session l’exige (L12)', () => {
    const reviewPlan = buildPlan({ mode: 'review', maxItems: 3 });
    const reviewState = sessionEngine.setConfidence(sessionEngine.start(reviewPlan, 1_000), 4);
    expect(reviewState.ok).toBe(true);
    if (!reviewState.ok) {
      return;
    }
    const revealedResult = sessionEngine.revealAnswer(reviewState.state);
    expect(revealedResult.ok).toBe(true);
    if (!revealedResult.ok) {
      return;
    }
    const reviewResult = sessionEngine.submitAnswer(
      revealedResult.state,
      answerInput(currentItemId(reviewState.state), 'good'),
    );
    expect(reviewResult.ok).toBe(true);
    if (reviewResult.ok) {
      expect(reviewResult.submission.answer.confidence).toBe(4);
    }

    // Hors exigence, `setConfidence` ne fuit pas dans la réponse normalisée.
    const learningPlan = buildPlan({ mode: 'learning', maxItems: 3 });
    const declared = sessionEngine.setConfidence(sessionEngine.start(learningPlan, 1_000), 4);
    expect(declared.ok).toBe(true);
    if (!declared.ok) {
      return;
    }
    const learningResult = sessionEngine.submitAnswer(
      revealed(declared.state),
      answerInput(currentItemId(declared.state), 'good'),
    );
    expect(learningResult.ok).toBe(true);
    if (learningResult.ok) {
      expect(learningResult.submission.answer.confidence).toBeNull();
    }
  });

  it('termine la session avec les index et l’instant fournis', () => {
    const plan = buildPlan({ mode: 'learning', maxItems: 1 });
    const start = sessionEngine.start(plan, 1_000);
    const result = sessionEngine.submitAnswer(
      revealed(start),
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
    const revealedState = revealed(start);
    const before = JSON.stringify(revealedState);
    const result = sessionEngine.submitAnswer(
      revealedState,
      answerInput(currentItemId(start), 'good'),
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(revealedState)).toBe(before);
    expect(revealedState.answers).toEqual([]);
    expect(revealedState.phase).toBe('revealed');
  });
});

describe('engine — prétest L18', () => {
  it('prétest sans feedback de correction', () => {
    // `discovery` marque chaque première exposition comme prétest (voir builder).
    const built = buildSession(
      makeRequest({ mode: 'discovery', maxItems: 3 }),
      makeContext({ cards: new Map() }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    const plan = built.plan;
    expect(plan.items.every((item) => item.isPretest)).toBe(true);

    const start = sessionEngine.start(plan, 1_000);
    const item = plan.items[0]!;
    const result = sessionEngine.submitAnswer(
      revealed(start),
      answerInput(currentItemId(start), 'again'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // La devinette n'est pas corrigée : aucun feedback ne révèle la réponse.
    expect(result.submission.feedback).toBeNull();
    expect(result.submission.answer.isPretest).toBe(true);
    expect(result.submission.answer.itemId).toBe(item.id);

    // Hors prétest, le même moteur émet bien un feedback correctif (L13).
    const gradedPlan = buildPlan({ mode: 'learning', maxItems: 1 });
    const graded = sessionEngine.submitAnswer(
      revealed(sessionEngine.start(gradedPlan, 1_000)),
      answerInput(gradedPlan.items[0]!.id, 'good'),
    );
    expect(graded.ok).toBe(true);
    if (graded.ok) {
      expect(graded.submission.answer.isPretest).toBe(false);
      expect(graded.submission.feedback).not.toBeNull();
    }
  });
});
