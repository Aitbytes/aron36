import type { PlayerState } from '@/domain/gamification/types';
import type { HookLibrary } from '@/domain/memory/types';
import type { PersistedProgress } from '@/domain/progress/types';
import type { CardState, ReviewLog } from '@/domain/srs/types';
import type { SessionLog } from '@/domain/session/types';
import type { ConfidenceRating, DrillDirection, EpochMs, ReviewGrade } from '@/domain/shared/types';

/**
 * État de test réaliste et **valide** au sens du contrat `PersistedProgress` :
 * 36 cartes couvrant les quatre phases, accroches, journaux triés, quêtes,
 * badges et collection. Sert de base aux tests du codec, du chargement et de
 * la sauvegarde (les tests de rejet le mutent volontairement).
 */

export const REFERENCE_TIME: EpochMs = 1_762_700_000_000;

/** Construit un état complet, conforme à tous les invariants gelés. */
export function buildFullProgress(): PersistedProgress {
  const cards: Record<string, CardState> = {};
  for (let questionId = 1; questionId <= 36; questionId += 1) {
    cards[String(questionId)] = buildCard(questionId);
  }
  const state: PersistedProgress = {
    schemaVersion: 1,
    appVersion: '0.1.0-test',
    savedAt: REFERENCE_TIME,
    player: buildPlayer(),
    cards,
    hooks: buildHooks(),
    reviewLogs: buildReviewLogs(),
    sessionLogs: buildSessionLogs(),
  };
  return state;
}

function buildCard(questionId: number): CardState {
  if (questionId <= 24) {
    return {
      questionId,
      phase: 'review',
      dueAt: REFERENCE_TIME + questionId * 3_600_000,
      intervalDays: 21 + questionId,
      stabilityDays: 20 + questionId,
      learningStep: 0,
      difficulty: 4 + (questionId % 7) / 2,
      reps: 5,
      lapses: questionId % 5 === 0 ? 1 : 0,
      consecutiveSuccesses: questionId % 4,
      lastReviewedAt: REFERENCE_TIME - 86_400_000 - questionId * 60_000,
      lastGrade: questionId % 4 === 0 ? 'hard' : 'good',
    };
  }
  if (questionId <= 30) {
    return {
      questionId,
      phase: 'learning',
      dueAt: REFERENCE_TIME + 600_000,
      intervalDays: 10 / 1440,
      stabilityDays: 0.2,
      learningStep: 1,
      difficulty: 5.5,
      reps: 1,
      lapses: 0,
      consecutiveSuccesses: 1,
      lastReviewedAt: REFERENCE_TIME - 600_000,
      lastGrade: 'good',
    };
  }
  if (questionId <= 33) {
    return {
      questionId,
      phase: 'relearning',
      dueAt: REFERENCE_TIME + 600_000,
      intervalDays: 10 / 1440,
      stabilityDays: 1.2,
      learningStep: 0,
      difficulty: 7.25,
      reps: 4,
      lapses: 1,
      consecutiveSuccesses: 0,
      lastReviewedAt: REFERENCE_TIME - 300_000,
      lastGrade: 'again',
    };
  }
  return {
    questionId,
    phase: 'new',
    dueAt: 0,
    intervalDays: 0,
    stabilityDays: 0,
    learningStep: 0,
    difficulty: 5,
    reps: 0,
    lapses: 0,
    consecutiveSuccesses: 0,
    lastReviewedAt: null,
    lastGrade: null,
  };
}

function buildPlayer(): PlayerState {
  return {
    profile: {
      id: 'p_test-profil',
      displayName: 'Apprenante',
      createdAt: REFERENCE_TIME - 30 * 86_400_000,
    },
    totalXp: 1240,
    streak: {
      current: 6,
      longest: 12,
      lastActiveDay: '2026-11-08',
      freezes: 1,
      frozenDays: ['2026-11-04'],
    },
    badges: [
      {
        badgeId: 'premier-pas',
        unlockedAt: REFERENCE_TIME - 30 * 86_400_000,
        progress: 1,
        target: 1,
      },
      { badgeId: 'serie-7', unlockedAt: null, progress: 6, target: 7 },
    ],
    questBoard: {
      dayKey: '2026-11-08',
      seed: 'quest-seed-2026-11-08',
      quests: [
        {
          questId: 'reponses-du-jour',
          dayKey: '2026-11-08',
          progress: 4,
          target: 10,
          completedAt: null,
          attempts: 5,
          correct: 4,
          seenQuestionIds: [1, 5, 9],
        },
        {
          questId: 'sans-filet',
          dayKey: '2026-11-08',
          progress: 2,
          target: 3,
          completedAt: null,
          attempts: 3,
          correct: 3,
          seenQuestionIds: [12, 13],
        },
        {
          questId: 'rappel-du-soir',
          dayKey: '2026-11-08',
          progress: 3,
          target: 3,
          completedAt: REFERENCE_TIME - 3_600_000,
          attempts: 3,
          correct: 3,
          seenQuestionIds: [20, 21, 22],
        },
      ],
    },
    collection: {
      entries: [
        {
          questionId: 1,
          rarity: 'common',
          obtainedAt: REFERENCE_TIME - 20 * 86_400_000,
          masteryTier: 2,
        },
        {
          questionId: 13,
          rarity: 'rare',
          obtainedAt: REFERENCE_TIME - 10 * 86_400_000,
          masteryTier: 1,
        },
        {
          questionId: 25,
          rarity: 'epic',
          obtainedAt: REFERENCE_TIME - 5 * 86_400_000,
          masteryTier: 1,
        },
      ],
    },
    settings: {
      locale: 'fr',
      speechEnabled: true,
      reducedMotion: 'system',
      dailyGoalMinutes: 15,
      confidencePromptEnabled: true,
    },
  };
}

function buildHooks(): HookLibrary {
  return {
    updatedAt: REFERENCE_TIME - 86_400_000,
    hooks: [
      {
        questionId: 1,
        kind: 'keyword',
        text: 'Regard qui s’ouvre — le mot-clé est « regards ».',
        createdAt: REFERENCE_TIME - 29 * 86_400_000,
        updatedAt: REFERENCE_TIME - 10 * 86_400_000,
      },
      {
        questionId: 13,
        kind: 'story',
        text: 'Scène du dîner : la musique monte, la question 13 arrive juste après le rire.',
        createdAt: REFERENCE_TIME - 15 * 86_400_000,
        updatedAt: REFERENCE_TIME - 15 * 86_400_000,
      },
      {
        questionId: 25,
        kind: 'autobiographical',
        text: 'Rappelle le ferry de 2023 — l’image mentale est le pont au crépuscule.',
        createdAt: REFERENCE_TIME - 6 * 86_400_000,
        updatedAt: REFERENCE_TIME - 2 * 86_400_000,
      },
    ],
  };
}

function buildReviewLogs(): ReviewLog[] {
  const base: EpochMs = REFERENCE_TIME - 3 * 86_400_000;
  const logs: ReviewLog[] = [];
  const directions: readonly DrillDirection[] = [
    'order-to-question',
    'keyword-to-question',
    'image-to-question',
    'number-to-question',
    'question-to-number',
  ];
  const grades: readonly ReviewGrade[] = ['again', 'hard', 'good', 'easy'];
  for (let index = 0; index < 6; index += 1) {
    const questionId = index + 1;
    const grade = grades[index % grades.length] ?? 'good';
    logs.push({
      id: `r_log-${index}`,
      sessionId: `s_session-${index % 2}`,
      questionId,
      direction: directions[index % directions.length] ?? 'keyword-to-question',
      exerciseKind: index === 5 ? 'discrimination' : 'production',
      grade,
      reviewedAt: base + index * 900_000,
      previousDueAt: index === 0 ? null : base + (index - 1) * 86_400_000,
      nextDueAt: base + index * 900_000 + 86_400_000,
      intervalDays: grade === 'again' ? 10 / 1440 : 2 + index,
      elapsedDays: index === 0 ? 0 : index,
      responseTimeMs: 2_500 + index * 150,
      hintsUsed: index % 3,
      confidence: index === 2 ? null : (((index % 5) + 1) as ConfidenceRating),
    });
  }
  return logs;
}

function buildSessionLogs(): SessionLog[] {
  return [
    {
      sessionId: 's_session-0',
      mode: 'review',
      planSeed: 'seed-revue-001',
      startedAt: REFERENCE_TIME - 3 * 86_400_000,
      endedAt: REFERENCE_TIME - 3 * 86_400_000 + 420_000,
      durationMs: 420_000,
      window: 'evening',
      itemCount: 12,
      productionCount: 10,
      discriminationCount: 2,
      spokenCount: 0,
      correctCount: 10,
      accuracy: 10 / 12,
      xpAwarded: 86,
    },
    {
      sessionId: 's_session-1',
      mode: 'learning',
      planSeed: 'seed-apprentissage-002',
      startedAt: REFERENCE_TIME - 1 * 86_400_000,
      endedAt: REFERENCE_TIME - 1 * 86_400_000 + 300_000,
      durationMs: 300_000,
      window: 'morning',
      itemCount: 8,
      productionCount: 8,
      discriminationCount: 0,
      spokenCount: 3,
      correctCount: 7,
      accuracy: 7 / 8,
      xpAwarded: 64,
    },
  ];
}
