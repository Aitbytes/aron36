import type { PersonalHook } from '@/domain/memory/types';
import { SCHEMA_VERSION } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import type { PlayerState } from '@/domain/gamification/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';
import type { DrillDirection } from '@/domain/shared/types';
import type { AnswerChannel, SessionState } from '@/domain/session/types';
import type { EpochMs, QuestionId, ReviewGrade } from '@/domain/shared/types';
import { sessionBuilder, sessionEngine } from '@/domain/session';
import { makeContext, makeRequest } from '@/domain/session/test-fixtures';

import { createInitialAppState } from './initialState';
import type { AppState } from './types';

/**
 * Fabriques de test du store applicatif.
 *
 * Les sessions sont construites avec le **vrai** moteur du domaine
 * (`sessionBuilder` + `sessionEngine`) sur le catalogue synthétique du module
 * session : le store n'invente aucune géométrie de session, il consomme le
 * contrat réel.
 */

/** Instant de référence partagé par toutes les fixtures (aucun `Date`). */
export const NOW: EpochMs = 1_000_000;

export function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    profile: { id: 'player-1', displayName: 'Test', createdAt: 0 },
    totalXp: 0,
    streak: { current: 0, longest: 0, lastActiveDay: null, freezes: 0, frozenDays: [] },
    badges: [],
    questBoard: null,
    collection: { entries: [] },
    settings: {
      locale: 'fr',
      speechEnabled: true,
      reducedMotion: 'system',
      dailyGoalMinutes: 15,
      confidencePromptEnabled: true,
    },
    ...overrides,
  };
}

export function makeProgress(overrides: Partial<PersistedProgress> = {}): PersistedProgress {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: 'test',
    savedAt: NOW,
    player: makePlayer(),
    cards: {},
    hooks: { hooks: [], updatedAt: 0 },
    reviewLogs: [],
    sessionLogs: [],
    ...overrides,
  };
}

export function makeHook(questionId: QuestionId, text = `accroche ${questionId}`): PersonalHook {
  return { questionId, kind: 'keyword', text, createdAt: NOW, updatedAt: NOW };
}

/** État applicatif de départ, avant toute action. */
export function makeState(overrides: Partial<PersistedProgress> = {}): AppState {
  return createInitialAppState(makeProgress(overrides));
}

/**
 * Démarre une vraie session de révision (mode `review`, pas de prétest) sur
 * `itemCount` cartes dues, et renvoie l'état produit par le moteur.
 */
export function startReviewSession(itemCount: number, seed = 'seed-store'): SessionState {
  const dueQuestionIds: readonly QuestionId[] = Array.from(
    { length: itemCount },
    (_unused, index) => index + 1,
  );
  const cards = new Map(
    dueQuestionIds.map((questionId) => [
      questionId,
      {
        questionId,
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
      } satisfies CardState,
    ]),
  );
  const built = sessionBuilder.build(makeRequest({ mode: 'review', seed, maxItems: itemCount }), {
    ...makeContext(),
    cards,
  });
  if (!built.ok) {
    throw new Error(`Fixture de session invalide : ${built.failure}`);
  }
  return sessionEngine.start(built.plan, NOW);
}

/** Soumet une réponse graduée sur l'item courant via le vrai moteur (confiance → révélation → note). */
export function answerCurrentItem(
  state: SessionState,
  grade: ReviewGrade = 'good',
  channel: AnswerChannel = 'written',
) {
  const item = state.plan.items[state.currentIndex];
  if (item === undefined) {
    throw new Error('Aucun item courant dans la fixture de session');
  }
  let working = state;
  if (state.plan.config.requiresConfidence && working.confidence === null) {
    const confident = sessionEngine.setConfidence(working, 3);
    if (!confident.ok) {
      throw new Error(`Confiance refusée par le moteur : ${confident.failure}`);
    }
    working = confident.state;
  }
  const revealed = sessionEngine.revealAnswer(working);
  if (!revealed.ok) {
    throw new Error(`Révélation refusée par le moteur : ${revealed.failure}`);
  }
  const submitted = sessionEngine.submitAnswer(revealed.state, {
    itemId: item.id,
    grade,
    responseTimeMs: 5_000,
    hintsUsed: 0,
    channel,
    now: NOW + 5_000,
  });
  if (!submitted.ok) {
    throw new Error(`Soumission refusée par le moteur : ${submitted.failure}`);
  }
  return submitted.submission;
}

/** Cartes de révision fraîchement dues, pour `selectDueCount`. */
export function makeDueCard(questionId: QuestionId, dueAt: EpochMs): CardState {
  return {
    questionId,
    phase: 'review',
    dueAt,
    intervalDays: 10,
    stabilityDays: 10,
    learningStep: 0,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    consecutiveSuccesses: 2,
    lastReviewedAt: 0,
    lastGrade: 'good',
  };
}

const MASTERY_DIRECTIONS: readonly DrillDirection[] = [
  'order-to-question',
  'keyword-to-question',
  'image-to-question',
];

/**
 * Progression dont les 36 questions atteignent les critères de maîtrise du
 * domaine : carte en phase `review` au-delà de `minIntervalDays`, deux
 * productions réussies dans trois directions distinctes.
 */
export function makeMasteredProgress(): PersistedProgress {
  const cards: Record<string, CardState> = {};
  const reviewLogs: ReviewLog[] = [];
  for (let questionId = 1; questionId <= 36; questionId += 1) {
    cards[String(questionId)] = {
      ...makeDueCard(questionId, 0),
      intervalDays: 30,
      stabilityDays: 30,
      reps: 6,
      lastReviewedAt: NOW,
    };
    let reviewedAt = NOW - 86_400_000;
    for (const direction of MASTERY_DIRECTIONS) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        reviewLogs.push({
          id: `mastery-${questionId}-${direction}-${attempt}`,
          sessionId: 'session-mastery',
          questionId,
          direction,
          exerciseKind: 'production',
          grade: 'good',
          reviewedAt,
          previousDueAt: 0,
          nextDueAt: reviewedAt + 86_400_000,
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

/** Gel profond : le réducteur ne doit jamais tenter d'écrire dans l'état. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
  }
  return Object.freeze(value);
}
