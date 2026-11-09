import type { PersonalHook } from '@/domain/memory/types';
import type { Act, QuestionCatalog, QuestionItem } from '@/domain/questions/types';
import type { ActId, DrillDirection, QuestionId } from '@/domain/shared/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';

import type { SessionBuildContext, SessionRequest } from './types';

/**
 * Fabriques de test du module session.
 *
 * Le dataset réel des 36 questions est livré par le lot P2-A ; ces fabriques
 * produisent un catalogue synthétique respectant les invariants du contrat
 * (`actId`/`positionInAct` déduits de `order`, 3 actes de 12 scènes).
 */

const ALL_ACTS: readonly ActId[] = [1, 2, 3];

export function makeQuestion(id: number): QuestionItem {
  const actId: ActId = id <= 12 ? 1 : id <= 24 ? 2 : 3;
  return {
    id,
    actId,
    order: id,
    positionInAct: ((id - 1) % 12) + 1,
    keyword: { fr: `mot-cle-${id}`, en: `keyword-${id}` },
    prompt: { fr: `Question numéro ${id} ?`, en: `Question number ${id}?` },
    mentalImage: { fr: `image mentale ${id}`, en: `mental image ${id}` },
    themeTags: [`theme-${id % 3}`],
  };
}

function makeAct(actId: ActId, questions: readonly QuestionItem[]): Act {
  const scenes = questions
    .filter((question) => question.actId === actId)
    .map((question) => ({
      order: question.positionInAct,
      questionId: question.id,
      image: question.mentalImage,
      transitionToNext: question.positionInAct === 12 ? null : { fr: `transition ${question.id}` },
    }));
  return {
    id: actId,
    order: actId,
    title: { fr: `Acte ${actId}` },
    film: {
      actId,
      title: { fr: `Film ${actId}` },
      pitch: { fr: `Pitch ${actId}` },
      scenes,
    },
  };
}

export function makeCatalog(count = 36): QuestionCatalog {
  const questions: QuestionItem[] = [];
  for (let id = 1; id <= count; id += 1) {
    questions.push(makeQuestion(id));
  }
  const byId = new Map<QuestionId, QuestionItem>(
    questions.map((question) => [question.id, question]),
  );
  const byKeyword = new Map<string, QuestionItem>(
    questions.map((question) => [question.keyword.fr, question]),
  );
  return {
    questions,
    acts: ALL_ACTS.map((actId) => makeAct(actId, questions)),
    byId,
    byKeyword,
  };
}

export function makeCard(questionId: number, overrides: Partial<CardState> = {}): CardState {
  return {
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
    ...overrides,
  };
}

export function makeLog(
  questionId: number,
  direction: DrillDirection,
  reviewedAt: number,
): ReviewLog {
  return {
    id: `log-${questionId}-${reviewedAt}`,
    sessionId: 'session-past',
    questionId,
    direction,
    exerciseKind: 'production',
    grade: 'good',
    reviewedAt,
    previousDueAt: 0,
    nextDueAt: reviewedAt + 86_400_000,
    intervalDays: 10,
    elapsedDays: 10,
    responseTimeMs: 5_000,
    hintsUsed: 0,
    confidence: null,
  };
}

export function makeHook(questionId: number, text = `accroche ${questionId}`): PersonalHook {
  return {
    questionId,
    kind: 'autobiographical',
    text,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function makeCardsFor(
  questionIds: readonly QuestionId[],
  overrides: Partial<CardState> = {},
): Map<QuestionId, CardState> {
  return new Map(questionIds.map((questionId) => [questionId, makeCard(questionId, overrides)]));
}

export function makeContext(overrides: Partial<SessionBuildContext> = {}): SessionBuildContext {
  return {
    catalog: makeCatalog(),
    cards: new Map<QuestionId, CardState>(),
    hooks: [],
    recentLogs: [],
    unlockedActIds: [...ALL_ACTS],
    ...overrides,
  };
}

export function makeRequest(overrides: Partial<SessionRequest> = {}): SessionRequest {
  return {
    mode: 'review',
    sessionId: 'session-1',
    seed: 'seed-1',
    now: 1_000_000,
    ...overrides,
  };
}
