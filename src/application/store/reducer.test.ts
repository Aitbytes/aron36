import { describe, expect, expectTypeOf, it } from 'vitest';

import type { XpAward } from '@/domain/gamification/types';
import type { PersonalHook } from '@/domain/memory/types';
import { MAX_SESSION_LOG_ENTRIES } from '@/domain/progress/types';
import type { ProgressError } from '@/domain/progress/types';
import type {
  AnswerFeedback,
  SessionLog,
  SessionState,
  SessionSummary,
} from '@/domain/session/types';
import type { ReviewLog } from '@/domain/srs/types';

import { createInitialAppState } from './initialState';
import { reduce } from './reducer';
import {
  answerCurrentItem,
  deepFreeze,
  makeHook,
  makeProgress,
  makeState,
  NOW,
  startReviewSession,
} from './test-fixtures';
import type { AppAction, AppState } from './types';

/** XP factice de fixture : la provenance réelle est le cas d'usage. */
function makeXp(amount: number, questionId: number | null = null): XpAward {
  return {
    amount,
    reason: 'production-answer',
    breakdown: null,
    questionId,
    at: NOW,
  };
}

/** Erreur de persistance factice. */
function makeError(code: ProgressError['code'] = 'write-failed'): ProgressError {
  return { code, message: 'échec technique de test', details: null };
}

/**
 * Journal de révision factice porté par l'action (Phase 3-C) : le réducteur
 * l'utilise **tel quel** — l'id vient de `IdPort` côté cas d'usage, jamais de
 * `SessionAnswer.itemId`.
 */
function makeReviewLog(overrides: Partial<ReviewLog> = {}): ReviewLog {
  return {
    id: 'review-log-de-test',
    sessionId: 'session-de-test',
    questionId: 1,
    direction: 'keyword-to-question',
    exerciseKind: 'production',
    grade: 'good',
    reviewedAt: NOW,
    previousDueAt: null,
    nextDueAt: NOW + 86_400_000,
    intervalDays: 1,
    elapsedDays: 0,
    responseTimeMs: 5_000,
    hintsUsed: 0,
    confidence: null,
    ...overrides,
  };
}

/** Journal de session factice porté par `session/completed`. */
function makeSessionLog(overrides: Partial<SessionLog> = {}): SessionLog {
  return {
    sessionId: 'session-de-test',
    mode: 'review',
    planSeed: 'seed-de-test',
    startedAt: NOW,
    endedAt: NOW + 60_000,
    durationMs: 60_000,
    window: 'morning',
    itemCount: 1,
    productionCount: 1,
    discriminationCount: 0,
    spokenCount: 0,
    correctCount: 1,
    accuracy: 1,
    xpAwarded: 12,
    ...overrides,
  };
}

describe('createInitialAppState — état initial', () => {
  it('présente une application prête, à domicile, sans session ni erreur', () => {
    const state = createInitialAppState(makeProgress());

    expect(state.ready).toBe(true);
    expect(state.session).toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.ui).toEqual({
      screen: 'home',
      locale: 'fr',
      activeActId: null,
      activeSessionId: null,
      feedback: null,
      busy: false,
    });
    expect(state.progress.player.totalXp).toBe(0);
  });

  it('recopie la locale persistée, sauf locale explicite', () => {
    expect(createInitialAppState(makeProgress()).ui.locale).toBe('fr');
    expect(createInitialAppState(makeProgress(), 'en').ui.locale).toBe('en');
  });

  it('ne fabrique aucune date et reste déterministe', () => {
    // Deux appels successifs produisent la même structure : la fonction est
    // pure, aucune horloge ni aléa n'interviennent.
    expect(createInitialAppState(makeProgress())).toEqual(createInitialAppState(makeProgress()));
    expect(createInitialAppState(makeProgress()).progress.savedAt).toBe(NOW);
  });
});

describe('réducteur — pureté', () => {
  it("appliquée deux fois, la même action donne le même résultat sans muter l'entrée", () => {
    const session = startReviewSession(2);
    const submission = answerCurrentItem(session);
    const action: AppAction = {
      type: 'session/answered',
      session: submission.state,
      answer: submission.answer,
      feedback: submission.feedback ?? feedbackPlaceholder(),
      xp: makeXp(12, submission.answer.questionId),
      progress: makeProgress({
        reviewLogs: [makeReviewLog({ sessionId: session.plan.id })],
        player: { ...makeProgress().player, totalXp: 12 },
      }),
    };

    const frozen = deepFreeze({
      ...makeState(),
      session,
      ui: { ...makeState().ui, activeSessionId: session.plan.id },
    });
    const actionFrozen = deepFreeze(action);

    const first = reduce(frozen, actionFrozen);
    const second = reduce(frozen, actionFrozen);

    expect(first).toEqual(second);
    // L'état d'entrée n'a pas bougé (il est gelé : une mutation lèverait).
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.session).toBe(session);
    expect(frozen.progress.reviewLogs).toHaveLength(0);
    // Toujours un nouvel objet racine, jamais l'entrée elle-même.
    expect(first).not.toBe(frozen);
  });

  it('ne mute jamais la progression gelée (cartes, journaux, joueur)', () => {
    const progress = deepFreeze(
      makeProgress({
        cards: {
          '3': {
            questionId: 3,
            phase: 'review',
            dueAt: 0,
            intervalDays: 10,
            stabilityDays: 10,
            learningStep: 0,
            difficulty: 5,
            reps: 3,
            lapses: 0,
            consecutiveSuccesses: 2,
            lastReviewedAt: 0,
            lastGrade: 'good',
          },
        },
        player: { ...makeProgress().player, totalXp: 50 },
      }),
    );
    const state = deepFreeze(createInitialAppState(progress));
    const next = reduce(state, { type: 'progress/saved', savedAt: NOW + 1 });

    expect(state.progress.savedAt).toBe(NOW);
    expect(next.progress.savedAt).toBe(NOW + 1);
    expect(next.progress.player.totalXp).toBe(50);
    expect(next).not.toBe(state);
  });
});

describe('réducteur — une action, un état', () => {
  it('progress/hydrated remplace la progression et passe ready à true', () => {
    const state = makeState({ player: { ...makeProgress().player, totalXp: 0 } });
    const hydrated = makeProgress({ player: { ...makeProgress().player, totalXp: 420 } });

    const next = reduce(state, { type: 'progress/hydrated', progress: hydrated });

    expect(next.ready).toBe(true);
    expect(next.progress).toBe(hydrated);
    expect(next.progress.player.totalXp).toBe(420);
    expect(next.ui).toEqual(state.ui);
  });

  it('progress/replaced remplace la progression et purge la dernière erreur', () => {
    const state = { ...makeState(), lastError: makeError('invalid-json') };
    const imported = makeProgress({ player: { ...makeProgress().player, totalXp: 99 } });

    const next = reduce(state, { type: 'progress/replaced', progress: imported });

    expect(next.progress).toBe(imported);
    expect(next.lastError).toBeNull();
  });

  it('progress/saved avance uniquement savedAt', () => {
    const state = makeState();

    const next = reduce(state, { type: 'progress/saved', savedAt: NOW + 250 });

    expect(next.progress.savedAt).toBe(NOW + 250);
    expect(state.progress.savedAt).toBe(NOW);
    expect(next.progress.player).toEqual(state.progress.player);
    expect(next.progress.cards).toEqual(state.progress.cards);
  });

  it("progress/error renseigne lastError sans détruire l'état courant", () => {
    const session = startReviewSession(1);
    const state = { ...makeState(), session };
    const error = makeError('quota-exceeded');

    const next = reduce(state, { type: 'progress/error', error });

    expect(next.lastError).toEqual(error);
    expect(next.session).toBe(session);
    expect(next.progress).toEqual(state.progress);
    expect(next.ui).toEqual(state.ui);
  });

  it('progress/reset réinitialise la progression et retire la session en cours', () => {
    const session = startReviewSession(1);
    const state = {
      ...makeState({ player: { ...makeProgress().player, totalXp: 700 } }),
      session,
      lastError: makeError('invalid-shape'),
    };
    const fresh = makeProgress();

    const next = reduce(state, { type: 'progress/reset', progress: fresh });

    expect(next.progress).toBe(fresh);
    expect(next.progress.player.totalXp).toBe(0);
    expect(next.session).toBeNull();
    expect(next.ui.activeSessionId).toBeNull();
    expect(next.ui.feedback).toBeNull();
    expect(next.lastError).toBeNull();
  });

  it("session/started installe la session et duplique son identifiant dans l'UI", () => {
    const session = startReviewSession(2);
    const state = { ...makeState(), ui: { ...makeState().ui, feedback: feedbackPlaceholderUi() } };

    const next = reduce(state, { type: 'session/started', state: session });

    expect(next.session).toBe(session);
    expect(next.ui.activeSessionId).toBe(session.plan.id);
    expect(next.ui.feedback).toBeNull();
    expect(next.ui.screen).toBe('home');
  });

  it("session/hint-revealed remplace l'état de session par celui du moteur", () => {
    const session = startReviewSession(1);
    const state = { ...makeState(), session };
    const revealed = { ...session, revealedHints: session.revealedHints + 1 };

    const next = reduce(state, { type: 'session/hint-revealed', state: revealed });

    expect(next.session).toBe(revealed);
    expect(next.session?.revealedHints).toBe(1);
    expect(next.ui).toEqual(state.ui);
    expect(next.progress).toEqual(state.progress);
  });

  it("session/answered installe la progression du cas d'usage à l'identique, avec session et feedback", () => {
    const session = startReviewSession(1);
    const cardBefore = {
      questionId: 1,
      phase: 'review',
      dueAt: 0,
      intervalDays: 10,
      stabilityDays: 10,
      learningStep: 0,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      consecutiveSuccesses: 2,
      lastReviewedAt: 0,
      lastGrade: 'good',
    } as const;
    const state = {
      ...makeState({
        cards: { '1': cardBefore },
        player: { ...makeProgress().player, totalXp: 10 },
      }),
      session,
      ui: { ...makeState().ui, activeSessionId: session.plan.id },
    };
    const submission = answerCurrentItem(session);
    // La progression portée par l'action est celle du **cas d'usage** : XP,
    // carte SRS suivante et journal de révision déjà appliqués et persistés
    // côté dépôt. Le réducteur n'a plus rien à dériver.
    const fromUseCase = makeProgress({
      cards: {
        '1': { ...cardBefore, dueAt: NOW + 86_400_000, intervalDays: 12, reps: 4 },
      },
      reviewLogs: [
        makeReviewLog({
          id: 'review-log-de-test',
          sessionId: session.plan.id,
          questionId: submission.answer.questionId,
        }),
      ],
      player: { ...makeProgress().player, totalXp: 22 },
    });

    const next = reduce(state, {
      type: 'session/answered',
      session: submission.state,
      answer: submission.answer,
      feedback: submission.feedback ?? feedbackPlaceholder(),
      xp: makeXp(12, submission.answer.questionId),
      progress: fromUseCase,
    });

    // Session remplacée par celle du moteur, feedback affiché.
    expect(next.session).toBe(submission.state);
    expect(next.ui.feedback).toEqual({
      answer: submission.answer,
      feedback: submission.feedback ?? feedbackPlaceholder(),
    });
    // Le réducteur n'invente rien : la progression installée est la référence
    // exacte portée par l'action (carte, journal et XP tels que produits).
    expect(next.progress).toBe(fromUseCase);
    expect(next.progress.player.totalXp).toBe(22);
    expect(next.progress.reviewLogs).toHaveLength(1);
    expect(next.progress.reviewLogs[0]).toBe(fromUseCase.reviewLogs[0]);
    expect(next.progress.reviewLogs[0]?.id).toBe('review-log-de-test');
    expect(next.progress.reviewLogs[0]?.id).not.toBe(submission.answer.itemId);
  });

  it('session/answered ne recalcule rien : quêtes, série, badges et collection portés par la progression reçue', () => {
    // Ancienne divergence (revue Phase 3) : le store affichait
    // {streak: 0, badges: [], questBoard: null} pendant que la progression
    // persistée portait {streak: 1, badges: ['premier-pas'], questBoard:
    // [3 quêtes]}. La progression ayant un seul propriétaire (le cas d'usage),
    // le réducteur installe l'état reçu sans recalcule — la divergence des
    // quatre champs est structurellement impossible.
    const session = startReviewSession(1);
    const state = { ...makeState(), session };
    const submission = answerCurrentItem(session);
    const fromUseCase = makeProgress({
      player: {
        ...makeProgress().player,
        totalXp: 12,
        streak: { current: 1, longest: 1, lastActiveDay: '2026-06-10', freezes: 0, frozenDays: [] },
        badges: [{ badgeId: 'premier-pas', unlockedAt: NOW, progress: 1, target: 1 }],
        questBoard: {
          dayKey: '2026-06-10',
          seed: 'seed-quetes',
          quests: [
            {
              questId: 'premiere-reponse',
              dayKey: '2026-06-10',
              progress: 1,
              target: 1,
              completedAt: NOW,
              attempts: 1,
              correct: 1,
              seenQuestionIds: [1],
            },
            {
              questId: 'precision-du-jour',
              dayKey: '2026-06-10',
              progress: 0,
              target: 5,
              completedAt: null,
              attempts: 0,
              correct: 0,
              seenQuestionIds: [],
            },
            {
              questId: 'sans-indice',
              dayKey: '2026-06-10',
              progress: 0,
              target: 3,
              completedAt: null,
              attempts: 0,
              correct: 0,
              seenQuestionIds: [],
            },
          ],
        },
        collection: {
          entries: [{ questionId: 1, rarity: 'common', obtainedAt: NOW, masteryTier: 1 }],
        },
      },
      reviewLogs: [makeReviewLog({ sessionId: session.plan.id })],
    });

    const next = reduce(state, {
      type: 'session/answered',
      session: submission.state,
      answer: submission.answer,
      feedback: submission.feedback ?? feedbackPlaceholder(),
      xp: makeXp(12, submission.answer.questionId),
      progress: fromUseCase,
    });

    expect(next.progress).toBe(fromUseCase);
    expect(next.progress.player.streak.current).toBe(1);
    expect(next.progress.player.badges.map((badge) => badge.badgeId)).toEqual(['premier-pas']);
    expect(next.progress.player.questBoard?.quests).toHaveLength(3);
    expect(next.progress.player.collection.entries).toHaveLength(1);
  });

  it("session/completed efface le feedback, ramène à l'accueil, garde la session pour le bilan et installe la progression de clôture", () => {
    const session = startReviewSession(1);
    const first = answerCurrentItem(session);
    const progressAfterAnswer = makeProgress({
      player: { ...makeProgress().player, totalXp: 12 },
      reviewLogs: [makeReviewLog({ sessionId: session.plan.id })],
    });
    const answered = reduce(
      { ...makeState(), session },
      {
        type: 'session/answered',
        session: first.state,
        answer: first.answer,
        feedback: first.feedback ?? feedbackPlaceholder(),
        xp: makeXp(12, first.answer.questionId),
        progress: progressAfterAnswer,
      },
    );
    // Progression produite par `finishSession` : SessionLog (fenêtre L17) et
    // XP de clôture déjà écrits, troncatures comprises.
    const progressAfterFinish = makeProgress({
      player: { ...makeProgress().player, totalXp: 22 },
      reviewLogs: progressAfterAnswer.reviewLogs,
      sessionLogs: [makeSessionLog({ sessionId: session.plan.id })],
    });

    const next = reduce(answered, {
      type: 'session/completed',
      summary: makeSummary(session),
      xp: makeXp(10),
      progress: progressAfterFinish,
    });

    expect(next.ui.feedback).toBeNull();
    expect(next.ui.screen).toBe('home');
    // Choix documenté : la session (phase `completed`) reste disponible pour
    // l'écran de bilan ; elle sera remplacée par session/started ou purgée par
    // session/abandoned.
    expect(next.session).toBe(first.state);
    expect(next.session?.phase).toBe('completed');
    // Le réducteur n'invente rien : la progression est celle du cas d'usage.
    expect(next.progress).toBe(progressAfterFinish);
    expect(next.progress.sessionLogs).toHaveLength(1);
    expect(next.progress.sessionLogs[0]?.sessionId).toBe(session.plan.id);
    expect(next.progress.player.totalXp).toBe(22);
  });

  it("session/completed installe la progression reçue sans recalcule (troncature déjà faite par le cas d'usage)", () => {
    const session = startReviewSession(1);
    const saturatedLogs: SessionLog[] = Array.from(
      { length: MAX_SESSION_LOG_ENTRIES },
      (_unused, index) => makeSessionLog({ sessionId: `session-ancienne-${String(index)}` }),
    );
    // Le cas d'usage a déjà tronqué à la limite de persistance avant de
    // produire cette progression : le réducteur l'installe telle quelle.
    const fromUseCase = makeProgress({ sessionLogs: saturatedLogs });
    const state = {
      ...makeState(),
      session,
    };

    const next = reduce(state, {
      type: 'session/completed',
      summary: makeSummary(session),
      xp: makeXp(10),
      progress: fromUseCase,
    });

    // La limite est respectée sans que le réducteur ne re-tronque : la
    // progression est la référence exacte portée par l'action.
    expect(next.progress).toBe(fromUseCase);
    expect(next.progress.sessionLogs).toHaveLength(MAX_SESSION_LOG_ENTRIES);
    expect(next.progress.sessionLogs.at(-1)?.sessionId).toBe('session-ancienne-499');
    expect(next.progress.sessionLogs.some((log) => log.sessionId === 'session-ancienne-0')).toBe(
      true,
    );
  });

  it('session/abandoned vide la session, son identifiant UI et le feedback', () => {
    const session = startReviewSession(1);
    const state = {
      ...makeState(),
      session,
      ui: {
        ...makeState().ui,
        activeSessionId: session.plan.id,
        feedback: feedbackPlaceholderUi(),
      },
    };

    const next = reduce(state, { type: 'session/abandoned' });

    expect(next.session).toBeNull();
    expect(next.ui.activeSessionId).toBeNull();
    expect(next.ui.feedback).toBeNull();
    expect(next.progress).toEqual(state.progress);
  });

  it("ui/navigate change l'écran courant", () => {
    const next = reduce(makeState(), { type: 'ui/navigate', screen: 'stats' });
    expect(next.ui.screen).toBe('stats');
    expect(next.ui).toEqual({ ...makeState().ui, screen: 'stats' });
  });

  it("ui/navigate vers l'écran courant renvoie l'état à l'identique (pas de notification)", () => {
    const state = makeState();
    expect(reduce(state, { type: 'ui/navigate', screen: 'home' })).toBe(state);
  });

  it("ui/act-selected change l'acte actif", () => {
    const next = reduce(makeState(), { type: 'ui/act-selected', actId: 2 });
    expect(next.ui.activeActId).toBe(2);
    expect(reduce(next, { type: 'ui/act-selected', actId: 2 })).toBe(next);
  });

  it('ui/feedback-dismissed efface le feedback courant', () => {
    const session = startReviewSession(1);
    const submission = answerCurrentItem(session);
    const state = reduce(
      { ...makeState(), session },
      {
        type: 'session/answered',
        session: submission.state,
        answer: submission.answer,
        feedback: submission.feedback ?? feedbackPlaceholder(),
        xp: makeXp(12),
        progress: makeProgress({
          reviewLogs: [makeReviewLog({ sessionId: submission.state.plan.id })],
          player: { ...makeProgress().player, totalXp: 12 },
        }),
      },
    );

    expect(state.ui.feedback).not.toBeNull();
    const dismissed = reduce(state, { type: 'ui/feedback-dismissed' });
    expect(dismissed.ui.feedback).toBeNull();
    // Idempotent par référence quand il n'y a rien à effacer.
    expect(reduce(dismissed, { type: 'ui/feedback-dismissed' })).toBe(dismissed);
  });

  it('ui/busy-changed bascule busy et reste référentiellement stable à valeur égale', () => {
    const state = makeState();
    const busy = reduce(state, { type: 'ui/busy-changed', busy: true });
    expect(busy.ui.busy).toBe(true);
    expect(reduce(busy, { type: 'ui/busy-changed', busy: true })).toBe(busy);
    expect(reduce(busy, { type: 'ui/busy-changed', busy: false }).ui.busy).toBe(false);
  });

  it("settings/updated installe la progression reçue (réglages déjà fusionnés et persistés par le cas d'usage)", () => {
    const state = makeState();
    // La fusion et la persistance appartiennent au cas d'usage : l'action
    // porte l'état complet, le réducteur ne modifie plus les réglages.
    const merged = makeProgress({
      player: {
        ...makeProgress().player,
        settings: {
          locale: 'fr',
          speechEnabled: false,
          reducedMotion: 'system',
          dailyGoalMinutes: 25,
          confidencePromptEnabled: true,
        },
      },
    });

    const next = reduce(state, { type: 'settings/updated', progress: merged });

    expect(next.progress).toBe(merged);
    expect(next.progress.player.settings).toEqual({
      locale: 'fr',
      speechEnabled: false,
      reducedMotion: 'system',
      dailyGoalMinutes: 25,
      confidencePromptEnabled: true,
    });
    expect(next.progress.player.totalXp).toBe(0);
    // Valeurs inchangées : aucun autre champ de l'UI n'est touché.
    expect(next.ui).toEqual(state.ui);
  });

  it("settings/updated reflète la locale de la progression reçue dans l'UI", () => {
    const state = makeState();
    const withEnglish = makeProgress({
      player: {
        ...makeProgress().player,
        settings: { ...makeProgress().player.settings, locale: 'en' },
      },
    });

    const next = reduce(state, { type: 'settings/updated', progress: withEnglish });

    expect(next.progress).toBe(withEnglish);
    expect(next.progress.player.settings.locale).toBe('en');
    expect(next.ui.locale).toBe('en');
  });

  it("hooks/saved insère puis remplace l'accroche d'une question", () => {
    const state = makeState();
    const hook: PersonalHook = makeHook(5, 'le mot de passe est mer');

    const inserted = reduce(state, { type: 'hooks/saved', hook });
    expect(inserted.progress.hooks.hooks).toHaveLength(1);
    expect(inserted.progress.hooks.hooks[0]?.questionId).toBe(5);
    expect(inserted.progress.hooks.updatedAt).toBe(NOW);

    const replaced = reduce(inserted, { type: 'hooks/saved', hook: makeHook(5, 'autre image') });
    expect(replaced.progress.hooks.hooks).toHaveLength(1);
    expect(replaced.progress.hooks.hooks[0]?.text).toBe('autre image');

    // Une deuxième question coexiste avec la première (au plus une PAR question).
    const second = reduce(replaced, { type: 'hooks/saved', hook: makeHook(6) });
    expect(second.progress.hooks.hooks.map((entry) => entry.questionId).sort()).toEqual([5, 6]);
  });
});

/**
 * Exhaustivité du réducteur.
 *
 * La table `ACTION_SAMPLES` est typée `{ [T in AppAction['type']]: … }` : si
 * une variante est ajoutée à `AppAction`, la table ne compile plus et ce test
 * force son traitement. À l'exécution, chaque échantillon passe par `reduce`
 * sans lever ni retourner l'état d'entrée à l'identique (sauf actions
 * volontairement sans effet, listées).
 */
describe('réducteur — exhaustivité des actions', () => {
  const session = startReviewSession(1);
  const submission = answerCurrentItem(session);
  const answeredAction: AppAction = {
    type: 'session/answered',
    session: submission.state,
    answer: submission.answer,
    feedback: submission.feedback ?? feedbackPlaceholder(),
    xp: makeXp(12),
    progress: makeProgress({
      reviewLogs: [makeReviewLog({ sessionId: submission.state.plan.id })],
      player: { ...makeProgress().player, totalXp: 12 },
    }),
  };

  const ACTION_SAMPLES: { [T in AppAction['type']]: (state: AppState) => AppAction } = {
    'progress/hydrated': (state) => ({ type: 'progress/hydrated', progress: state.progress }),
    'progress/replaced': (state) => ({ type: 'progress/replaced', progress: state.progress }),
    'progress/saved': () => ({ type: 'progress/saved', savedAt: NOW + 1 }),
    'progress/error': () => ({ type: 'progress/error', error: makeError() }),
    'progress/reset': (state) => ({ type: 'progress/reset', progress: state.progress }),
    'session/started': () => ({ type: 'session/started', state: session }),
    'session/hint-revealed': (_state) => ({
      type: 'session/hint-revealed',
      state: { ...session, revealedHints: 1 },
    }),
    'session/answered': () => answeredAction,
    'session/completed': () => ({
      type: 'session/completed',
      summary: makeSummary(session),
      xp: makeXp(10),
      progress: makeProgress({ sessionLogs: [makeSessionLog({ sessionId: session.plan.id })] }),
    }),
    'session/abandoned': () => ({ type: 'session/abandoned' }),
    'ui/navigate': () => ({ type: 'ui/navigate', screen: 'train' }),
    'ui/act-selected': () => ({ type: 'ui/act-selected', actId: 3 }),
    'ui/feedback-dismissed': () => ({ type: 'ui/feedback-dismissed' }),
    'ui/busy-changed': () => ({ type: 'ui/busy-changed', busy: true }),
    'settings/updated': () => ({ type: 'settings/updated', progress: makeProgress() }),
    'hooks/saved': () => ({ type: 'hooks/saved', hook: makeHook(1) }),
  };

  it("couvre toutes les variantes d'AppAction, sans oubli possible", () => {
    const variants = Object.keys(ACTION_SAMPLES) as (keyof typeof ACTION_SAMPLES)[];
    const expectedVariants = [
      'progress/hydrated',
      'progress/replaced',
      'progress/saved',
      'progress/error',
      'progress/reset',
      'session/started',
      'session/hint-revealed',
      'session/answered',
      'session/completed',
      'session/abandoned',
      'ui/navigate',
      'ui/act-selected',
      'ui/feedback-dismissed',
      'ui/busy-changed',
      'settings/updated',
      'hooks/saved',
    ] as const satisfies readonly (keyof typeof ACTION_SAMPLES)[];

    expect(variants).toHaveLength(expectedVariants.length);
    expect([...variants].sort()).toEqual([...expectedVariants].sort());
  });

  it('applique chaque variante sans lever et produit un nouvel état', () => {
    // État de base avec un feedback affiché : aucune variante (y compris
    // `ui/feedback-dismissed`) n'est alors sans effet.
    const base: AppState = {
      ...makeState(),
      ui: { ...makeState().ui, feedback: feedbackPlaceholderUi() },
    };
    for (const [variant, build] of Object.entries(ACTION_SAMPLES)) {
      const state: AppState = { ...base, ui: { ...base.ui } };
      const action = build(state);
      expect(action.type).toBe(variant);

      let next: AppState | undefined;
      expect(() => {
        next = reduce(deepFreeze(state), deepFreeze(action));
      }, `La variante ${variant} doit être traitée sans lever`).not.toThrow();

      expect(next, `La variante ${variant} doit produire un état`).toBeDefined();
      expect(next).not.toBe(state);
    }
  });

  it('refuse au typage un action inconnu (le default est inatteignable)', () => {
    // Garde de compilation : AppAction est une union fermée, `reduce` n'accepte
    // rien d'autre. L'exécution lèverait via assertNeverAction.
    expectTypeOf<Parameters<typeof reduce>[1]>().toEqualTypeOf<AppAction>();
  });
});

/* ── Aides locales de fixture ─────────────────────────────────────────────── */

function feedbackPlaceholder(): AnswerFeedback {
  return {
    correct: true,
    expectedAnswer: { kind: 'question', text: { fr: 'Question ?' } },
    mentalImage: { fr: 'image' },
    errorSignal: 'none',
    messageKey: 'feedback.correct',
  };
}

function feedbackPlaceholderUi() {
  const session = startReviewSession(1);
  const submission = answerCurrentItem(session);
  return { answer: submission.answer, feedback: submission.feedback ?? feedbackPlaceholder() };
}

function makeSummary(session: SessionState): SessionSummary {
  const correct = session.answers.filter((answer) => answer.isCorrect).length;
  const byDirection = (direction: string) => ({
    attempts: session.answers.filter((answer) => answer.direction === direction).length,
    correct: session.answers.filter((answer) => answer.direction === direction && answer.isCorrect)
      .length,
  });
  return {
    sessionId: session.plan.id,
    mode: session.plan.mode,
    itemCount: session.plan.items.length,
    answeredCount: session.answers.length,
    correctCount: correct,
    accuracy: session.answers.length === 0 ? 0 : correct / session.answers.length,
    durationMs: 5_000,
    xpAwarded: 12,
    byDirection: {
      'order-to-question': byDirection('order-to-question'),
      'keyword-to-question': byDirection('keyword-to-question'),
      'image-to-question': byDirection('image-to-question'),
      'number-to-question': byDirection('number-to-question'),
      'question-to-number': byDirection('question-to-number'),
    },
  };
}
