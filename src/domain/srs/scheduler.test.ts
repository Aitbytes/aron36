import { describe, expect, it } from 'vitest';

import { DAY_MS, MINUTE_MS, type ReviewGrade } from '@/domain/shared/types';
import { createScheduler, scheduler } from '@/domain/srs/scheduler';
import { DEFAULT_SCHEDULER_CONFIG, type CardPhase, type CardState } from '@/domain/srs/types';

const T0 = 1_700_000_000_000;
const at = (days: number): number => T0 + days * DAY_MS;
const minutes = (count: number): number => count * MINUTE_MS;

const GRADES: readonly ReviewGrade[] = ['again', 'hard', 'good', 'easy'];
const PROGRESS_GRADES: readonly ReviewGrade[] = ['hard', 'good', 'easy'];
const PHASES: readonly CardPhase[] = ['new', 'learning', 'review', 'relearning'];

/** Carte de test complètement spécifiée, surchargeable champ par champ. */
function makeCard(overrides: Partial<CardState> = {}): CardState {
  return {
    questionId: 1,
    phase: 'review',
    dueAt: T0,
    intervalDays: 10,
    stabilityDays: 10,
    learningStep: 0,
    difficulty: 5,
    reps: 5,
    lapses: 0,
    consecutiveSuccesses: 3,
    lastReviewedAt: T0 - 10 * DAY_MS,
    lastGrade: 'good',
    ...overrides,
  };
}

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32) : rejoue exactement la
 * même suite à chaque exécution, sans `Math.random`.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Construit un état de carte valide pour une phase, à partir du générateur. */
function buildStateForPhase(phase: CardPhase, random: () => number): CardState {
  switch (phase) {
    case 'new':
      return makeCard({
        phase: 'new',
        dueAt: T0,
        intervalDays: 0,
        stabilityDays: 0,
        learningStep: 0,
        reps: 0,
        lapses: 0,
        consecutiveSuccesses: 0,
        lastReviewedAt: null,
        lastGrade: null,
      });
    case 'learning': {
      const step = random() < 0.5 ? 0 : 1;
      const delay = DEFAULT_SCHEDULER_CONFIG.learningStepsMinutes[step] ?? 1;
      const intervalDays = delay / 1440;
      return makeCard({
        phase: 'learning',
        intervalDays,
        stabilityDays: 0,
        learningStep: step,
        reps: 1 + Math.floor(random() * 4),
        consecutiveSuccesses: Math.floor(random() * 4),
        dueAt: T0 + intervalDays * DAY_MS,
        lastReviewedAt: T0,
      });
    }
    case 'relearning': {
      const intervalDays = 10 / 1440;
      return makeCard({
        phase: 'relearning',
        intervalDays,
        stabilityDays: 0.5 + random() * 5,
        learningStep: 0,
        lapses: 1 + Math.floor(random() * 3),
        consecutiveSuccesses: 0,
        dueAt: T0 + intervalDays * DAY_MS,
        lastReviewedAt: T0,
      });
    }
    case 'review': {
      const intervalDays = 1 + Math.floor(random() * 180);
      return makeCard({
        phase: 'review',
        intervalDays,
        stabilityDays: intervalDays,
        learningStep: 0,
        reps: 3 + Math.floor(random() * 10),
        consecutiveSuccesses: 1 + Math.floor(random() * 5),
        dueAt: T0 + intervalDays * DAY_MS,
        lastReviewedAt: T0,
      });
    }
    default:
      return makeCard();
  }
}

describe('Scheduler — état initial et échéance', () => {
  it('crée une carte neuve due immédiatement, difficulté initiale', () => {
    const card = scheduler.initialState(7, T0);
    expect(card.questionId).toBe(7);
    expect(card.phase).toBe('new');
    expect(card.dueAt).toBe(T0);
    expect(card.intervalDays).toBe(0);
    expect(card.stabilityDays).toBe(0);
    expect(card.learningStep).toBe(0);
    expect(card.difficulty).toBe(DEFAULT_SCHEDULER_CONFIG.initialDifficulty);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.consecutiveSuccesses).toBe(0);
    expect(card.lastReviewedAt).toBeNull();
    expect(card.lastGrade).toBeNull();
  });

  it('isDue est vraie à la borne exacte dueAt === now', () => {
    const card = makeCard({ dueAt: T0 });
    expect(scheduler.isDue(card, T0)).toBe(true);
    expect(scheduler.isDue(card, T0 + 1)).toBe(true);
    expect(scheduler.isDue(card, T0 - 1)).toBe(false);
  });
});

describe('Scheduler — cycle new → learning → review', () => {
  it('progresse dans les paliers puis gradue à 1 jour', () => {
    const fresh = scheduler.initialState(1, T0);

    // new + good → palier suivant (10 min)
    const first = scheduler.schedule(fresh, 'good', T0);
    expect(first.nextCard.phase).toBe('learning');
    expect(first.nextCard.learningStep).toBe(1);
    expect(first.nextCard.intervalDays).toBeCloseTo(10 / 1440, 12);
    expect(first.nextCard.dueAt).toBe(T0 + minutes(10));

    // learning (dernier palier) + good → review à graduatingIntervalDays
    const second = scheduler.schedule(first.nextCard, 'good', first.nextCard.dueAt);
    expect(second.nextCard.phase).toBe('review');
    expect(second.nextCard.intervalDays).toBe(DEFAULT_SCHEDULER_CONFIG.graduatingIntervalDays);
    expect(second.nextCard.stabilityDays).toBe(second.nextCard.intervalDays);
    expect(second.nextCard.dueAt).toBe(first.nextCard.dueAt + DAY_MS);
  });

  it('new + easy gradue immédiatement à easyIntervalDays', () => {
    const fresh = scheduler.initialState(1, T0);
    const result = scheduler.schedule(fresh, 'easy', T0);
    expect(result.nextCard.phase).toBe('review');
    expect(result.nextCard.intervalDays).toBe(DEFAULT_SCHEDULER_CONFIG.easyIntervalDays);
  });

  it('new + again reste en apprentissage au premier palier, sans chute', () => {
    const fresh = scheduler.initialState(1, T0);
    const result = scheduler.schedule(fresh, 'again', T0);
    expect(result.isLapse).toBe(false);
    expect(result.nextCard.phase).toBe('learning');
    expect(result.nextCard.learningStep).toBe(0);
    expect(result.nextCard.lapses).toBe(0);
    expect(result.nextCard.dueAt).toBe(
      T0 + minutes(DEFAULT_SCHEDULER_CONFIG.learningStepsMinutes[0] ?? 1),
    );
  });

  it('new + hard reste au palier 0 avec le report hard', () => {
    const fresh = scheduler.initialState(1, T0);
    const result = scheduler.schedule(fresh, 'hard', T0);
    expect(result.nextCard.phase).toBe('learning');
    expect(result.nextCard.learningStep).toBe(0);
    expect(result.nextCard.dueAt).toBe(
      T0 + minutes(DEFAULT_SCHEDULER_CONFIG.hardLearningDelayMinutes),
    );
  });
});

describe('Scheduler — chute et réapprentissage', () => {
  it('review + again déclenche une chute sans perdre la carte', () => {
    const card = makeCard({
      intervalDays: 20,
      stabilityDays: 20,
      dueAt: at(20),
      lastReviewedAt: T0,
    });
    const result = scheduler.schedule(card, 'again', card.dueAt);

    expect(result.isLapse).toBe(true);
    expect(result.nextCard.phase).toBe('relearning');
    expect(result.nextCard.lapses).toBe(card.lapses + 1);
    expect(result.nextCard.consecutiveSuccesses).toBe(0);
    expect(result.nextCard.reps).toBe(card.reps + 1);
    expect(result.nextCard.stabilityDays).toBeCloseTo(
      20 * DEFAULT_SCHEDULER_CONFIG.lapseStabilityFactor,
      12,
    );
    expect(result.nextCard.questionId).toBe(card.questionId);
    // Noté tôt (à la dernière révision), `again` ramène l'échéance bien avant.
    const early = scheduler.schedule(card, 'again', card.lastReviewedAt ?? T0);
    expect(early.nextCard.dueAt).toBeLessThan(card.dueAt);
    expect(early.nextCard.intervalDays).toBeLessThan(card.intervalDays);
  });

  it('respecte le plancher minimumStabilityDays après une chute', () => {
    const card = makeCard({
      intervalDays: 1,
      stabilityDays: 1,
      dueAt: T0,
      lastReviewedAt: T0 - DAY_MS,
    });
    const result = scheduler.schedule(card, 'again', card.dueAt);
    expect(result.nextCard.stabilityDays).toBe(DEFAULT_SCHEDULER_CONFIG.minimumStabilityDays);
  });

  it('retour de réapprentissage : good remet en review avec au moins 1 jour', () => {
    const lapsed = makeCard({
      phase: 'relearning',
      intervalDays: 10 / 1440,
      stabilityDays: DEFAULT_SCHEDULER_CONFIG.minimumStabilityDays,
      learningStep: 0,
      dueAt: T0,
      lastReviewedAt: T0 - minutes(10),
    });
    const result = scheduler.schedule(lapsed, 'good', T0);
    expect(result.nextCard.phase).toBe('review');
    expect(result.nextCard.intervalDays).toBeGreaterThanOrEqual(
      DEFAULT_SCHEDULER_CONFIG.minimumReviewIntervalDays,
    );
  });

  it('retour de réapprentissage : easy remet en review avec au moins 2 jours', () => {
    const lapsed = makeCard({
      phase: 'relearning',
      intervalDays: 10 / 1440,
      stabilityDays: DEFAULT_SCHEDULER_CONFIG.minimumStabilityDays,
      learningStep: 0,
      dueAt: T0,
      lastReviewedAt: T0 - minutes(10),
    });
    const result = scheduler.schedule(lapsed, 'easy', T0);
    expect(result.nextCard.phase).toBe('review');
    expect(result.nextCard.intervalDays).toBeGreaterThanOrEqual(2);
  });
});

describe('Scheduler — rétention et retard', () => {
  it('la rétention décroît quand elapsedDays augmente', () => {
    const card = makeCard({ intervalDays: 10, stabilityDays: 10, dueAt: T0, lastReviewedAt: T0 });
    const onTime = scheduler.schedule(card, 'good', T0);
    const late = scheduler.schedule(card, 'good', T0 + 10 * DAY_MS);
    const veryLate = scheduler.schedule(card, 'good', T0 + 30 * DAY_MS);

    expect(onTime.retrievabilityBefore).toBeCloseTo(1, 12);
    expect(late.retrievabilityBefore).toBeCloseTo(0.9, 12);
    expect(veryLate.retrievabilityBefore).toBeLessThan(late.retrievabilityBefore);
    expect(late.retrievabilityBefore).toBeLessThan(onTime.retrievabilityBefore);
  });

  it('applique exactement targetRetention ^ (elapsed / interval)', () => {
    const card = makeCard({ intervalDays: 8, stabilityDays: 8, dueAt: T0, lastReviewedAt: T0 });
    const elapsed = 4;
    const result = scheduler.schedule(card, 'good', T0 + elapsed * DAY_MS);
    expect(result.retrievabilityBefore).toBeCloseTo(
      DEFAULT_SCHEDULER_CONFIG.targetRetention ** (elapsed / 8),
      12,
    );
    expect(result.elapsedDays).toBeCloseTo(elapsed, 12);
  });

  it('vaut 0 pour une carte neuve (intervalle nul)', () => {
    const fresh = scheduler.initialState(1, T0);
    const result = scheduler.schedule(fresh, 'good', T0);
    expect(result.retrievabilityBefore).toBe(0);
    expect(result.elapsedDays).toBe(0);
  });

  it('une révision en retard croît plus qu’une révision à l’heure', () => {
    const onTimeCard = makeCard({
      intervalDays: 10,
      stabilityDays: 10,
      dueAt: T0,
      lastReviewedAt: T0,
    });
    const lateCard = makeCard({
      intervalDays: 10,
      stabilityDays: 10,
      dueAt: T0,
      lastReviewedAt: T0,
    });
    const onTime = scheduler.schedule(onTimeCard, 'good', T0);
    const late = scheduler.schedule(lateCard, 'good', T0 + 15 * DAY_MS);
    expect(late.nextCard.intervalDays).toBeGreaterThan(onTime.nextCard.intervalDays);
  });
});

describe('Scheduler — difficulté bornée', () => {
  it('reste dans [1, 10] après de nombreuses notes extrêmes', () => {
    let card = scheduler.initialState(1, T0);
    for (let i = 0; i < 60; i += 1) {
      card = scheduler.schedule(card, 'again', T0 + i * DAY_MS).nextCard;
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }

    let easyCard = scheduler.initialState(36, T0);
    for (let i = 0; i < 60; i += 1) {
      easyCard = scheduler.schedule(easyCard, 'easy', T0 + i * DAY_MS).nextCard;
      expect(easyCard.difficulty).toBeGreaterThanOrEqual(1);
      expect(easyCard.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it('applique le rappel vers la moyenne sans dépasser 10', () => {
    const card = makeCard({ difficulty: 9.95 });
    const result = scheduler.schedule(card, 'again', T0);
    expect(result.nextCard.difficulty).toBeLessThanOrEqual(10);
  });
});

describe('Scheduler — previewIntervals', () => {
  it('est croissant en jours : again ≤ hard ≤ good ≤ easy', () => {
    for (const phase of PHASES) {
      const card = makeCard({
        phase,
        intervalDays: phase === 'new' ? 0 : phase === 'review' ? 12 : 10 / 1440,
        stabilityDays: phase === 'review' ? 12 : 1,
        learningStep: 0,
        dueAt: T0,
        lastReviewedAt: phase === 'new' ? null : T0 - DAY_MS,
      });
      const preview = scheduler.previewIntervals(card, T0);
      expect(preview.again).toBeLessThanOrEqual(preview.hard);
      expect(preview.hard).toBeLessThanOrEqual(preview.good);
      expect(preview.good).toBeLessThanOrEqual(preview.easy);
      for (const grade of GRADES) {
        expect(scheduler.schedule(card, grade, T0).nextCard.intervalDays).toBe(preview[grade]);
      }
    }
  });
});

describe('Scheduler — propriété de monotonie', () => {
  it('hard/good/easy ne reculent jamais l’échéance (balayage déterministe)', () => {
    const random = mulberry32(0x5eed);
    const latenessDays = [0, 1 / 24, 1, 7, 30, 120];
    let checked = 0;

    for (let iteration = 0; iteration < 4000; iteration += 1) {
      const phase = PHASES[Math.floor(random() * PHASES.length)] ?? 'review';
      const base = buildStateForPhase(phase, random);
      const lateness = latenessDays[Math.floor(random() * latenessDays.length)] ?? 0;
      const now = base.dueAt + lateness * DAY_MS;

      for (const grade of PROGRESS_GRADES) {
        const result = scheduler.schedule(base, grade, now);
        expect(result.nextCard.intervalDays).toBeGreaterThanOrEqual(base.intervalDays);
        expect(result.nextCard.dueAt).toBeGreaterThan(base.dueAt);
        expect(result.nextCard.difficulty).toBeGreaterThanOrEqual(1);
        expect(result.nextCard.difficulty).toBeLessThanOrEqual(10);
        expect(result.retrievabilityBefore).toBeGreaterThanOrEqual(0);
        expect(result.retrievabilityBefore).toBeLessThanOrEqual(1);
        expect(result.nextCard.stabilityDays).toBeGreaterThanOrEqual(0);
        expect(result.intervalDeltaDays).toBeCloseTo(
          result.nextCard.intervalDays - base.intervalDays,
          12,
        );
        checked += 1;
      }
    }
    expect(checked).toBe(12_000);
  });

  it('again est le seul à pouvoir avancer l’échéance', () => {
    const card = makeCard({
      phase: 'review',
      intervalDays: 40,
      stabilityDays: 40,
      dueAt: T0,
      lastReviewedAt: T0 - 40 * DAY_MS,
    });
    // Noté tôt (à la dernière révision), `again` ramène l'échéance bien avant.
    const result = scheduler.schedule(card, 'again', card.lastReviewedAt ?? T0);
    expect(result.nextCard.dueAt).toBeLessThan(card.dueAt);
    expect(result.nextCard.intervalDays).toBeLessThan(card.intervalDays);
  });

  it('tient la monotonie avec une configuration personnalisée', () => {
    const custom = createScheduler({
      ...DEFAULT_SCHEDULER_CONFIG,
      maxIntervalDays: 20,
      learningStepsMinutes: [2, 30],
      relearningStepsMinutes: [15],
      goodGrowthFactor: 1.1,
      easyGrowthFactor: 1.4,
    });
    const card = makeCard({ intervalDays: 20, stabilityDays: 20, dueAt: T0, lastReviewedAt: T0 });
    for (const grade of PROGRESS_GRADES) {
      const result = custom.schedule(card, grade, T0);
      expect(result.nextCard.intervalDays).toBeGreaterThanOrEqual(card.intervalDays);
      expect(result.nextCard.dueAt).toBeGreaterThan(card.dueAt);
    }
  });
});
