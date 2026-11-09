import { describe, expect, it } from 'vitest';

import { DAY_MS, MINUTE_MS, type ReviewGrade } from '@/domain/shared/types';
import { scheduler } from '@/domain/srs/scheduler';
import { DEFAULT_SCHEDULER_CONFIG, type CardPhase, type CardState } from '@/domain/srs/types';

/**
 * Invariants de l'ordonnanceur, vérifiés par balayage **déterministe**.
 *
 * Ce fichier existe pour les états que les autres tests évitent : intervalles
 * au-delà de `maxIntervalDays`, cartes `new` non dues, réapprentissage sur
 * intervalle saturé. C'est précisément là que les garanties du contrat
 * (§ 6.3 de docs/ARCHITECTURE.md) cassaient.
 *
 * Aucun `Math.random` : le balayage rejoue exactement la même suite à chaque
 * exécution.
 */

const T0 = 1_700_000_000_000;
const MAX_INTERVAL_DAYS = DEFAULT_SCHEDULER_CONFIG.maxIntervalDays;
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
 * Générateur pseudo-aléatoire déterministe (mulberry32), dupliqué ici pour que
 * le fichier d'invariants soit autonome (aucun aléa implicite, même importé).
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

/** Choix déterministe dans une liste non vide. */
function pick<T>(values: readonly T[], random: () => number): T {
  const index = Math.floor(random() * values.length);
  return values[index] ?? values[0] ?? (undefined as unknown as T);
}

/**
 * Intervalles volontairement **hors invariants** : au-delà de `maxIntervalDays`,
 * paliers de minutes, valeurs fractionnaires corrompues.
 */
const INTERVAL_DAYS_SAMPLES: readonly number[] = [
  0,
  1 / 1440,
  10 / 1440,
  0.5,
  1,
  2,
  21,
  84,
  179,
  180,
  181,
  200,
  400,
];

/** Stabilités, y compris nulles et très supérieures au plafond. */
const STABILITY_DAYS_SAMPLES: readonly number[] = [0, 1 / 1440, 0.5, 1, 10, 84, 200, 400];

/** Degrés de retard, y compris « très en avance » (négatif) et saturation. */
const LATENESS_DAYS_SAMPLES: readonly number[] = [-400, -30, -1, 0, 1 / 24, 1, 7, 120, 365];

/**
 * Construit un état de balayage pour une phase, en tirant délibérément dans les
 * échantillons hors invariants.
 */
function buildState(phase: CardPhase, random: () => number): CardState {
  const intervalDays = pick(INTERVAL_DAYS_SAMPLES, random);
  const stabilityDays = pick(STABILITY_DAYS_SAMPLES, random);
  const lastReviewedAt = T0 - pick(INTERVAL_DAYS_SAMPLES, random) * DAY_MS;

  switch (phase) {
    case 'new':
      return makeCard({
        phase: 'new',
        // Carte neuve **non due** : `dueAt` dans le futur, cas explicitement
        // cité par la revue comme cassant `dueAt' > dueAt`.
        dueAt: T0 + pick([0, 1, 30, 400], random) * DAY_MS,
        intervalDays,
        stabilityDays,
        learningStep: 0,
        reps: 0,
        lapses: 0,
        consecutiveSuccesses: 0,
        lastReviewedAt: null,
        lastGrade: null,
      });
    case 'learning':
      return makeCard({
        phase: 'learning',
        dueAt: T0 + intervalDays * DAY_MS,
        intervalDays,
        stabilityDays,
        learningStep: Math.floor(random() * 3),
        reps: 1 + Math.floor(random() * 5),
        consecutiveSuccesses: Math.floor(random() * 4),
        lastReviewedAt,
        lastGrade: 'hard',
      });
    case 'relearning':
      return makeCard({
        phase: 'relearning',
        dueAt: T0 + intervalDays * DAY_MS,
        intervalDays,
        stabilityDays,
        learningStep: Math.floor(random() * 3),
        lapses: 1 + Math.floor(random() * 3),
        consecutiveSuccesses: 0,
        lastReviewedAt,
        lastGrade: 'again',
      });
    case 'review':
      return makeCard({
        phase: 'review',
        dueAt: T0 + intervalDays * DAY_MS,
        intervalDays,
        stabilityDays,
        learningStep: 0,
        reps: 3 + Math.floor(random() * 10),
        consecutiveSuccesses: 1 + Math.floor(random() * 5),
        lastReviewedAt,
        lastGrade: 'good',
      });
  }
}

describe('Invariants SRS — balayage déterministe d’états hors invariants', () => {
  it('borne et fait progresser l’intervalle et l’échéance pour hard/good/easy', () => {
    const random = mulberry32(0xc0ffee);
    let checked = 0;

    for (let iteration = 0; iteration < 1200; iteration += 1) {
      const phase = pick(PHASES, random);
      const card = buildState(phase, random);
      const latenessDays = pick(LATENESS_DAYS_SAMPLES, random);
      const now = card.dueAt + latenessDays * DAY_MS;
      // Référence de monotonie : l'intervalle d'entrée ramené dans les bornes.
      const reference = Math.min(card.intervalDays, MAX_INTERVAL_DAYS);

      for (const grade of PROGRESS_GRADES) {
        const result = scheduler.schedule(card, grade, now);

        // Plafond dur du contrat.
        expect(result.nextCard.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
        expect(result.nextCard.intervalDays).toBeGreaterThanOrEqual(reference);

        // Échéance strictement repoussée, y compris à saturation et sur une
        // carte importée très en avance.
        expect(result.nextCard.dueAt).toBeGreaterThan(card.dueAt);

        // Rétention toujours définie et bornée.
        expect(Number.isFinite(result.retrievabilityBefore)).toBe(true);
        expect(result.retrievabilityBefore).toBeGreaterThanOrEqual(0);
        expect(result.retrievabilityBefore).toBeLessThanOrEqual(1);

        // Champs dérivés cohérents.
        expect(result.intervalDeltaDays).toBeCloseTo(
          result.nextCard.intervalDays - card.intervalDays,
          12,
        );
        expect(result.nextCard.stabilityDays).toBeGreaterThanOrEqual(0);
        expect(result.nextCard.difficulty).toBeGreaterThanOrEqual(1);
        expect(result.nextCard.difficulty).toBeLessThanOrEqual(10);
        expect(result.nextCard.reps).toBe(card.reps + 1);

        checked += 1;
      }
    }

    expect(checked).toBe(3_600);
  });

  it('garde previewIntervals ordonné, y compris en réapprentissage saturé', () => {
    const random = mulberry32(0xbadc0de);
    let checked = 0;

    for (let iteration = 0; iteration < 1200; iteration += 1) {
      const phase = pick(PHASES, random);
      const card = buildState(phase, random);
      const preview = scheduler.previewIntervals(card, T0);

      expect(preview.again).toBeLessThanOrEqual(preview.hard);
      expect(preview.hard).toBeLessThanOrEqual(preview.good);
      expect(preview.good).toBeLessThanOrEqual(preview.easy);
      expect(preview.easy).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
      for (const grade of PROGRESS_GRADES) {
        expect(scheduler.schedule(card, grade, T0).nextCard.intervalDays).toBe(preview[grade]);
      }
      checked += 1;
    }

    expect(checked).toBe(1_200);
  });

  it('ne produit jamais preview.hard > preview.good sur un réapprentissage saturé', () => {
    // Cas exact signalé par la revue : I = 200 j en réapprentissage.
    const card = makeCard({
      phase: 'relearning',
      intervalDays: 200,
      stabilityDays: 200,
      learningStep: 0,
      lastReviewedAt: T0 - 200 * DAY_MS,
      dueAt: T0,
    });
    const preview = scheduler.previewIntervals(card, T0);
    expect(preview.hard).toBeLessThanOrEqual(preview.good);
    expect(preview.hard).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
    expect(preview.good).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
  });

  it('repousse strictement dueAt à saturation, même révisé très en avance', () => {
    const card = makeCard({
      phase: 'review',
      intervalDays: MAX_INTERVAL_DAYS,
      stabilityDays: MAX_INTERVAL_DAYS,
      dueAt: T0 + MAX_INTERVAL_DAYS * DAY_MS,
      lastReviewedAt: T0,
    });
    for (const grade of PROGRESS_GRADES) {
      // Révision au premier jour : sans garde-fou, `I' = 180` redonnait `dueAt`.
      const result = scheduler.schedule(card, grade, T0);
      expect(result.nextCard.intervalDays).toBe(MAX_INTERVAL_DAYS);
      expect(result.nextCard.dueAt).toBeGreaterThan(card.dueAt);
    }
  });

  it('repousse strictement dueAt pour une carte neuve non due', () => {
    const card = makeCard({
      phase: 'new',
      dueAt: T0 + 30 * DAY_MS,
      intervalDays: 0,
      stabilityDays: 0,
      reps: 0,
      consecutiveSuccesses: 0,
      lastReviewedAt: null,
      lastGrade: null,
    });
    for (const grade of PROGRESS_GRADES) {
      expect(scheduler.schedule(card, grade, T0).nextCard.dueAt).toBeGreaterThan(card.dueAt);
    }
  });

  it('again reste la seule exception : il peut avancer l’échéance', () => {
    const card = makeCard({
      phase: 'review',
      intervalDays: 40,
      stabilityDays: 40,
      dueAt: T0 + 40 * DAY_MS,
      lastReviewedAt: T0,
    });
    const result = scheduler.schedule(card, 'again', T0);
    expect(result.nextCard.dueAt).toBeLessThan(card.dueAt);
    expect(result.nextCard.intervalDays).toBeLessThan(card.intervalDays);
  });
});

describe('Invariants SRS — rétention', () => {
  it('reste dans [0, 1] et décroît strictement avec elapsedDays', () => {
    // Stabilités réelles (≥ `minimumStabilityDays` du défaut) : la décroissance
    // est stricte. Le cas dégénéré `S = 0` est traité juste après.
    const stabilities = [0.5, 1, 10, 84, 400];
    const elapsedDays = [0, 1 / 24, 0.5, 1, 7, 30, 180, 1000];

    for (const stabilityDays of stabilities) {
      const card = makeCard({
        phase: 'relearning',
        intervalDays: 10 / 1440,
        stabilityDays,
        lastReviewedAt: T0,
        dueAt: T0 + 10 * MINUTE_MS,
      });
      let previous = Number.POSITIVE_INFINITY;
      for (const elapsed of elapsedDays) {
        const result = scheduler.schedule(card, 'good', T0 + elapsed * DAY_MS);
        const retention = result.retrievabilityBefore;
        expect(Number.isFinite(retention)).toBe(true);
        expect(retention).toBeGreaterThanOrEqual(0);
        expect(retention).toBeLessThanOrEqual(1);
        expect(retention).toBeLessThan(previous);
        previous = retention;
      }
    }
  });

  it('reste définie et non croissante pour une stabilité nulle', () => {
    const card = makeCard({
      phase: 'review',
      intervalDays: 1,
      stabilityDays: 0,
      lastReviewedAt: T0,
      dueAt: T0 + DAY_MS,
    });
    let previous = Number.POSITIVE_INFINITY;
    for (const elapsed of [0, 1 / 24, 1, 7, 365]) {
      const retention = scheduler.schedule(
        card,
        'good',
        T0 + elapsed * DAY_MS,
      ).retrievabilityBefore;
      expect(Number.isFinite(retention)).toBe(true);
      expect(retention).toBeGreaterThanOrEqual(0);
      expect(retention).toBeLessThanOrEqual(1);
      expect(retention).toBeLessThanOrEqual(previous);
      previous = retention;
    }
  });

  it('ne s’effondre plus sur un palier de réapprentissage de 10 minutes', () => {
    // Carte mûre (84 j) tombée : S' = 29,4 j, échéance dans 10 min, revue 12 h après.
    const card = makeCard({
      phase: 'relearning',
      intervalDays: 10 / 1440,
      stabilityDays: 84 * DEFAULT_SCHEDULER_CONFIG.lapseStabilityFactor,
      lastReviewedAt: T0,
      dueAt: T0 + 10 * MINUTE_MS,
    });
    const result = scheduler.schedule(card, 'good', T0 + 12 * 60 * MINUTE_MS);
    expect(result.retrievabilityBefore).toBeGreaterThan(0.99);
  });

  it('vaut exactement targetRetention à l’échéance d’une carte consolidée', () => {
    const card = makeCard({
      phase: 'review',
      intervalDays: 20,
      stabilityDays: 20,
      lastReviewedAt: T0,
      dueAt: T0 + 20 * DAY_MS,
    });
    const result = scheduler.schedule(card, 'good', T0 + 20 * DAY_MS);
    expect(result.retrievabilityBefore).toBeCloseTo(DEFAULT_SCHEDULER_CONFIG.targetRetention, 12);
  });
});
