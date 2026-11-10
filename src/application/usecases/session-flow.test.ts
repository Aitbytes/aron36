import { describe, expect, it } from 'vitest';

import { XP_RULES } from '@/domain/gamification';
import type { ReviewGrade } from '@/domain/shared/types';
import type { AnswerChannel } from '@/domain/session/types';
import { QUESTION_CATALOG } from '@/domain/questions';
import { sessionBuilder } from '@/domain/session';
import { STORAGE_KEY, MAX_SESSION_LOG_ENTRIES } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import type { RandomSeed } from '@/domain/shared/types';
import type { CardState } from '@/domain/srs/types';
import { UseCaseRejection } from './errors';
import { createHarness, seedFreshProgress, NOW } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Parcours de bout en bout sans interface : démarrage, réponses, clôture —
 * état final cohérent côté moteur, côté progression persistée et côté
 * journal de session.
 */

/** Soumet l'item d'index donné avec les paramètres de test par défaut. */
function answerCurrent(
  harness: TestHarness,
  sessionId: string,
  index: number,
  grade: ReviewGrade = 'good',
  channel: AnswerChannel = 'written',
  hintsUsed = 0,
  responseTimeMs = 1_000,
): ReturnType<typeof harness.useCases.submitAnswer.execute> {
  const output = harness.useCases.submitAnswer.execute({
    sessionId,
    itemId: `${sessionId}:${String(index)}`,
    grade,
    confidence: null,
    responseTimeMs,
    hintsUsed,
    channel,
  });
  return output;
}

/** Démarre une session d'apprentissage de `maxItems` items et renvoie le plan. */
function startLearning(harness: TestHarness, maxItems: number): string {
  const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems });
  return started.plan.id;
}

describe('parcours complet — démarrer, répondre, clôturer', () => {
  it('conduit trois réponses jusqu\u2019à la clôture avec un état final cohérent', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    // Démarrage : sessionId et graine proviennent des ports injectés.
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 3 });
    expect(started.plan.id).toBe('session-1');
    expect(started.plan.seed).toBe('seed-1');
    expect(started.plan.createdAt).toBe(NOW);
    expect(started.state.phase).toBe('asking');

    // Trois réponses réussies : la session se termine à la troisième.
    let last = answerCurrent(harness, started.plan.id, 0);
    expect(last.summary).toBeNull();
    last = answerCurrent(harness, started.plan.id, 1);
    expect(last.summary).toBeNull();
    last = answerCurrent(harness, started.plan.id, 2);
    expect(last.summary).not.toBeNull();
    expect(last.session.phase).toBe('completed');
    expect(last.session.answers).toHaveLength(3);
    // Ordonnancement effectif : chaque production déplace sa carte SRS.
    expect(last.scheduledReview).not.toBeNull();
    expect(last.xp.amount).toBeGreaterThan(0);
    // La quête du jour a été créée à la première réponse.
    expect(last.updatedProgress.player.questBoard).not.toBeNull();

    // Clôture : journal complet, XP de fin, persistance.
    const finished = harness.useCases.finishSession.execute({
      sessionId: started.plan.id,
      now: harness.clock.now(),
      window: 'morning',
    });
    expect(finished.summary.itemCount).toBe(3);
    expect(finished.summary.answeredCount).toBe(3);
    expect(finished.xp.amount).toBe(XP_RULES.sessionCompletionXp);
    expect(finished.xp.reason).toBe('session-complete');

    // État persisté final : journaux, cartes, XP, sessionLog.
    const raw = harness.storage.read(STORAGE_KEY);
    expect(raw.ok).toBe(true);
    const stored = JSON.parse(raw.ok ? (raw.value ?? '') : '') as PersistedProgress;
    expect(stored.reviewLogs).toHaveLength(3);
    expect(stored.sessionLogs).toHaveLength(1);
    expect(stored.player.totalXp).toBe(last.updatedProgress.player.totalXp + finished.xp.amount);
    // Les trois cartes de la session ont été ordonnancées (reps 1).
    for (const answer of last.session.answers) {
      expect(stored.cards[String(answer.questionId)]?.reps).toBe(1);
    }
    expect(stored.player.streak.current).toBe(1);
  });

  it('calcule durée, précision et comptes exacts sur une session mixte', () => {
    const harness = createHarness();
    const seeded = seedFreshProgress(harness);
    // Cartes de l'acte I déjà rencontrées : un QCM devient éligible (20 % max).
    const withEncountered: PersistedProgress = {
      ...seeded,
      cards: encounterActOne(seeded.cards),
    };
    harness.storage.seedRaw(STORAGE_KEY, harness.codec.encode(withEncountered));

    const sessionId = startLearning(harness, 5);
    const grades: readonly ReviewGrade[] = ['good', 'again', 'good', 'good', 'good'];
    const channels: readonly AnswerChannel[] = [
      'written',
      'written',
      'written',
      'spoken',
      'written',
    ];
    let productionXp = 0;
    let spokenDeclarations = 0;
    for (let index = 0; index < 5; index += 1) {
      harness.clock.advance(5_000);
      const grade = grades[index] ?? 'good';
      const channel = channels[index] ?? 'written';
      const output = harness.useCases.submitAnswer.execute({
        sessionId,
        itemId: `${sessionId}:${String(index)}`,
        grade,
        confidence: null,
        responseTimeMs: 1_000,
        hintsUsed: 0,
        channel,
      });
      if (output.answer.exerciseKind === 'production') {
        productionXp += output.xp.amount;
        if (channel !== 'written') {
          spokenDeclarations += 1;
        }
      }
    }

    // Avance finale : endedAt = démarrage + 30 000 ms exactement.
    harness.clock.advance(5_000);
    const finished = harness.useCases.finishSession.execute({
      sessionId,
      now: harness.clock.now(),
      window: 'morning',
    });

    // durée exacte : 6 avances de 5 s depuis le démarrage (30 000 ms).
    expect(finished.summary.durationMs).toBe(30_000);
    // précision pondérée exacte : (1 + 0 + 1 + 1 + 1) / 5.
    expect(finished.summary.accuracy).toBeCloseTo(0.8, 10);
    expect(finished.summary.correctCount).toBe(4);
    // Session mixte : exactement un QCM (plafond 20 % de 5 items).
    expect(finished.summary.itemCount).toBe(5);
    const stored = readStored(harness);
    const log = stored.sessionLogs[0];
    expect(log?.productionCount).toBe(4);
    expect(log?.discriminationCount).toBe(1);
    expect(log?.spokenCount).toBe(spokenDeclarations);
    expect(log?.xpAwarded).toBe(productionXp);
    expect(log?.window).toBe('morning');
    expect(stored.sessionLogs).toHaveLength(1);
    expect(stored.sessionLogs.length).toBeLessThanOrEqual(MAX_SESSION_LOG_ENTRIES);
  });

  it('construit le contexte de maîtrise depuis les journaux (actes verrouillés)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    // Sans aucune donnée : seul l'acte I est débloqué (L14).
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 5 });
    for (const item of started.plan.items) {
      expect(item.actId).toBe(1);
    }
  });

  it('propage un échec de construction tel quel (drill de vitesse verrouillé)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    // L15 : le mode speed exige un acte maîtrisé — refus explicite du domaine.
    expect(() =>
      harness.useCases.startSession.execute({ mode: 'speed', maxItems: 3 }),
    ).toThrowError(UseCaseRejection);
    try {
      harness.useCases.startSession.execute({ mode: 'speed', maxItems: 3 });
    } catch (error) {
      expect(error).toBeInstanceOf(UseCaseRejection);
      expect((error as UseCaseRejection).reason).toBe('session-build-refused');
      expect((error as UseCaseRejection).detail).toEqual({
        kind: 'build',
        failure: 'mode-locked',
      });
    }
  });

  it('propage les refus du moteur : session inconnue, confiance manquante, hors phase', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    // Session inconnue.
    expect(() =>
      harness.useCases.submitAnswer.execute({
        sessionId: 'session-fantome',
        itemId: 'x:0',
        grade: 'good',
        confidence: null,
        responseTimeMs: 1_000,
        hintsUsed: 0,
        channel: 'written',
      }),
    ).toThrowError(UseCaseRejection);

    // Le mode révision exige un jugement de confiance avant révélation (L12).
    const started = harness.useCases.startSession.execute({ mode: 'review', maxItems: 1 });
    expect(() =>
      harness.useCases.submitAnswer.execute({
        sessionId: started.plan.id,
        itemId: started.plan.items[0]?.id ?? '',
        grade: 'good',
        confidence: null,
        responseTimeMs: 1_000,
        hintsUsed: 0,
        channel: 'written',
      }),
    ).toThrowError(UseCaseRejection);
    try {
      harness.useCases.submitAnswer.execute({
        sessionId: started.plan.id,
        itemId: started.plan.items[0]?.id ?? '',
        grade: 'good',
        confidence: null,
        responseTimeMs: 1_000,
        hintsUsed: 0,
        channel: 'written',
      });
    } catch (error) {
      expect((error as UseCaseRejection).reason).toBe('session-transition-refused');
      expect((error as UseCaseRejection).detail).toEqual({
        kind: 'transition',
        failure: 'confidence-required',
      });
    }
  });

  it('journalise la confiance fournie en mode learning (L12, majeur A5)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    // `learning` n'exige pas de confiance : le moteur ne la recopiera pas dans
    // `SessionAnswer`. Le cas d'usage ne doit pourtant pas l'ignorer.
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
    expect(started.plan.config.requiresConfidence).toBe(false);
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }

    const output = harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId: item.id,
      grade: 'good',
      confidence: 5,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });

    // Le moteur ne recopie pas la confiance hors `requiresConfidence`…
    expect(output.answer.confidence).toBeNull();
    // … mais le journal de révision porte bien la confiance **déclarée** :
    // le badge et la quête de calibration s'en nourrissent (L12).
    expect(output.updatedProgress.reviewLogs.at(-1)?.confidence).toBe(5);
    // Sans confiance fournie, rien n'est inventé.
    const started2 = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
    const item2 = started2.plan.items[0];
    const without = harness.useCases.submitAnswer.execute({
      sessionId: started2.plan.id,
      itemId: item2?.id ?? '',
      grade: 'good',
      confidence: null,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });
    expect(without.updatedProgress.reviewLogs.at(-1)?.confidence).toBeNull();
  });

  it('clôture avec confiance déclarée avant révélation (mode révision)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'review', maxItems: 1 });
    const itemId = started.plan.items[0]?.id ?? '';

    const output = harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId,
      grade: 'good',
      confidence: 4,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });

    // La confiance portée par la réponse est celle déclarée (L12).
    expect(output.answer.confidence).toBe(4);
    expect(output.answer.isCorrect).toBe(true);
    expect(output.summary).not.toBeNull();
  });
});

/** Cartes de l'acte I déjà rencontrées (éligibles au QCM plafonné). */
function encounterActOne(cards: PersistedProgress['cards']): PersistedProgress['cards'] {
  const next: Record<string, CardState> = { ...cards };
  for (let questionId = 1; questionId <= 12; questionId += 1) {
    const current = next[String(questionId)];
    if (current !== undefined) {
      next[String(questionId)] = { ...current, reps: 3, phase: 'review' };
    }
  }
  return next;
}

/** Lit et décode l'état persisté du harnais. */
function readStored(harness: TestHarness): PersistedProgress {
  const raw = harness.storage.read(STORAGE_KEY);
  expect(raw.ok).toBe(true);
  return JSON.parse(raw.ok ? (raw.value ?? '') : '') as PersistedProgress;
}

/** Graine produisant un premier item de discrimination (déterministe). */
export function findSeedStartingWithDiscrimination(): RandomSeed {
  const cards = new Map<number, CardState>();
  for (let questionId = 1; questionId <= 12; questionId += 1) {
    cards.set(questionId, {
      questionId,
      phase: 'review',
      dueAt: 0,
      intervalDays: 3,
      stabilityDays: 3,
      learningStep: 0,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      consecutiveSuccesses: 2,
      lastReviewedAt: 0,
      lastGrade: 'good',
    });
  }
  for (let index = 0; index < 800; index += 1) {
    const seed = `discrimination-${String(index)}`;
    const built = sessionBuilder.build(
      { mode: 'learning', sessionId: 'probe', seed, now: NOW, maxItems: 5 },
      {
        catalog: QUESTION_CATALOG,
        cards,
        hooks: [],
        recentLogs: [],
        unlockedActIds: [1],
        masteredActIds: [],
      },
    );
    if (built.ok && built.plan.items[0]?.exerciseKind === 'discrimination') {
      return seed;
    }
  }
  throw new Error('aucune graine de discrimination trouvée');
}
