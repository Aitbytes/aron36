import { describe, expect, it } from 'vitest';

import { levelCalculator } from '@/domain/gamification';
import { LEVEL_CURVE } from '@/domain/gamification/types';
import { sessionEngine } from '@/domain/session';

import { createInitialAppState } from './initialState';
import {
  answerCurrentItem,
  makeDueCard,
  makeMasteredProgress,
  makeProgress,
  makeState,
  NOW,
  startReviewSession,
} from './test-fixtures';
import {
  selectActiveScreen,
  selectCanReveal,
  selectDueCount,
  selectFeedback,
  selectIsGrandOralAvailable,
  selectLevel,
  selectSessionProgress,
  selectStreak,
} from './selectors';
import { reduce } from './reducer';

describe('selectDueCount — horloge injectée', () => {
  it('compte les cartes dont dueAt <= now, et seulement elles', () => {
    const state = makeState({
      cards: {
        '1': makeDueCard(1, NOW - 1),
        '2': makeDueCard(2, NOW),
        '3': makeDueCard(3, NOW + 1),
        '4': makeDueCard(4, NOW - 86_400_000),
      },
    });

    expect(selectDueCount(state, NOW)).toBe(3);
    // Seule la carte échue depuis longtemps reste due deux ms avant `now`.
    expect(selectDueCount(state, NOW - 2)).toBe(1);
    expect(selectDueCount(state, NOW + 1)).toBe(4);
  });

  it('renvoie 0 sans aucune carte', () => {
    expect(selectDueCount(makeState(), NOW)).toBe(0);
  });
});

describe('selectLevel — délégation au LevelCalculator du domaine', () => {
  it("calcule le niveau depuis l'XP totale persistée", () => {
    const state = makeState({ player: { ...makeProgress().player, totalXp: 250 } });
    expect(selectLevel(state)).toEqual(levelCalculator.levelFor(250, LEVEL_CURVE));
    expect(selectLevel(state)).toMatchObject({ level: 2, xpIntoLevel: 150, xpToNextLevel: 50 });
  });

  it('place le niveau 1 à XP nulle', () => {
    expect(selectLevel(makeState())).toMatchObject({ level: 1, progressRatio: 0 });
  });
});

describe('selectStreak — projection de la série persistée', () => {
  it("renvoie la série telle qu'enregistrée, sans la recalculer", () => {
    const state = makeState({
      player: {
        ...makeProgress().player,
        streak: { current: 3, longest: 9, lastActiveDay: '2026-01-03', freezes: 1, frozenDays: [] },
      },
    });
    expect(selectStreak(state)).toEqual({
      current: 3,
      longest: 9,
      lastActiveDay: '2026-01-03',
      freezes: 1,
      frozenDays: [],
    });
  });
});

describe('selectSessionProgress — avancement 0 %, 50 %, 100 %', () => {
  it('renvoie null hors session', () => {
    expect(selectSessionProgress(makeState())).toBeNull();
  });

  it('mesure 0 % au premier item, 50 % après une réponse, 100 % à la fin', () => {
    const session = startReviewSession(2);
    const state = { ...makeState(), session };

    const atStart = selectSessionProgress(state);
    expect(atStart).toEqual({ index: 0, total: 2, ratio: 0 });

    const first = answerCurrentItem(session);
    const mid = reduce(state, { type: 'session/answered', ...toAnsweredAction(first) });
    expect(selectSessionProgress(mid)).toEqual({ index: 1, total: 2, ratio: 0.5 });

    const second = answerCurrentItem(first.state);
    const done = reduce(mid, { type: 'session/answered', ...toAnsweredAction(second) });
    expect(done.session?.phase).toBe('completed');
    expect(selectSessionProgress(done)).toEqual({ index: 2, total: 2, ratio: 1 });
  });
});

describe('selectCanReveal — confiance requise (L12)', () => {
  it('refuse la révélation quand le plan exige une confiance encore absente', () => {
    const session = startReviewSession(1);
    const state = { ...makeState(), session };
    expect(session.plan.config.requiresConfidence).toBe(true);
    expect(selectCanReveal(state)).toBe(false);
  });

  it('permet la révélation dès que la confiance est déclarée avant révélation', () => {
    const session = startReviewSession(1);
    const confident = sessionEngine.setConfidence(session, 4);
    if (!confident.ok) {
      throw new Error(confident.failure);
    }
    const state = { ...makeState(), session: confident.state };
    expect(selectCanReveal(state)).toBe(true);
  });

  it('renvoie false hors session', () => {
    expect(selectCanReveal(makeState())).toBe(false);
  });
});

describe('selectIsGrandOralAvailable — maîtrise des actes (L14, L15)', () => {
  it('reste fermé sans aucune donnée', () => {
    expect(selectIsGrandOralAvailable(makeState())).toBe(false);
  });

  it('reste fermé tant que les trois actes ne sont pas maîtrisés', () => {
    const mastered = makeMasteredProgress();
    const partial = makeProgress({
      cards: Object.fromEntries(Object.entries(mastered.cards).slice(0, 18)),
      reviewLogs: mastered.reviewLogs.filter((log) => log.questionId <= 18),
    });
    expect(selectIsGrandOralAvailable(createInitialAppState(partial))).toBe(false);
  });

  it("s'ouvre quand les 36 questions atteignent la maîtrise", () => {
    expect(selectIsGrandOralAvailable(createInitialAppState(makeMasteredProgress()))).toBe(true);
  });
});

describe("sélecteurs d'affichage — projections pures", () => {
  it('selectActiveScreen suit la navigation', () => {
    const state = reduce(makeState(), { type: 'ui/navigate', screen: 'grand-oral' });
    expect(selectActiveScreen(state)).toBe('grand-oral');
    expect(selectActiveScreen(makeState())).toBe('home');
  });

  it('selectFeedback renvoie le feedback courant puis null après acquittement', () => {
    const session = startReviewSession(1);
    const submission = answerCurrentItem(session);
    const answered = reduce(
      { ...makeState(), session },
      {
        type: 'session/answered',
        session: submission.state,
        answer: submission.answer,
        feedback: submission.feedback ?? {
          correct: true,
          expectedAnswer: { kind: 'question', text: { fr: 'Q ?' } },
          mentalImage: { fr: 'image' },
          errorSignal: 'none',
          messageKey: 'feedback.correct',
        },
        scheduledReview: null,
        xp: { amount: 12, reason: 'production-answer', breakdown: null, questionId: 1, at: NOW },
        reviewLog: null,
      },
    );

    expect(selectFeedback(answered)?.answer.itemId).toBe(submission.answer.itemId);
    const dismissed = reduce(answered, { type: 'ui/feedback-dismissed' });
    expect(selectFeedback(dismissed)).toBeNull();
    expect(selectFeedback(makeState())).toBeNull();
  });

  it("les sélecteurs ne mutent jamais l'état", () => {
    const state = createInitialAppState(makeMasteredProgress());
    const snapshot = JSON.stringify(state);
    selectDueCount(state, NOW);
    selectLevel(state);
    selectIsGrandOralAvailable(state);
    selectSessionProgress(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

/* ── Aide locale : action session/answered depuis une soumission du moteur ── */

function toAnsweredAction(submission: ReturnType<typeof answerCurrentItem>) {
  return {
    session: submission.state,
    answer: submission.answer,
    feedback: submission.feedback ?? {
      correct: true,
      expectedAnswer: { kind: 'question', text: { fr: 'Q ?' } } as const,
      mentalImage: { fr: 'image' },
      errorSignal: 'none' as const,
      messageKey: 'feedback.correct',
    },
    scheduledReview: null,
    xp: {
      amount: 12,
      reason: 'production-answer',
      breakdown: null,
      questionId: submission.answer.questionId,
      at: NOW,
    } as const,
    reviewLog: null,
  };
}
