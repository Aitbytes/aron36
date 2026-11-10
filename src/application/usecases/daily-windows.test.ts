import { describe, expect, it } from 'vitest';

import { questGenerator, QUEST_DEFINITIONS } from '@/domain/gamification';
import type { DayKey, RandomSeed, ReviewGrade } from '@/domain/shared/types';
// Horloge réelle en test : c'est la seule à gérer les transitions d'heure via
// `Intl` (le double `FixedClock` a un décalage constant).
import { SystemClock } from '@/infrastructure';
import { resolveSessionWindow } from './session-window';
import { createHarness, NOW, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * L17 — consolidation par le sommeil : la fenêtre de journée est déduite de
 * l'heure locale (`ClockPort`), jamais du domaine ; la quête du soir ne
 * progresse que sur des réponses du soir.
 */

const EVENING_DELTA_MS = 13.5 * 3_600_000; // 8 h 00 → 21 h 30 (même jour civil).

/** Graine dont le tableau de quêtes contient la quête du soir (déterministe). */
function seedWithEveningQuest(dayKey: DayKey): RandomSeed {
  for (let index = 0; index < 500; index += 1) {
    const seed = `quete-soir-${String(index)}`;
    const board = questGenerator.boardFor({
      dayKey,
      seed,
      definitions: QUEST_DEFINITIONS,
      recentQuestIds: [],
    });
    if (board.quests.some((quest) => quest.questId === 'revision-du-soir')) {
      return seed;
    }
  }
  throw new Error('aucune graine ne tire la quête du soir');
}

/** Démarre une session, répond une fois, clôture — renvoie la fenêtre du journal. */
function runOneAnswer(harness: TestHarness, grade: ReviewGrade = 'good'): string {
  const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
  const item = started.plan.items[0];
  if (item === undefined) {
    throw new Error('item manquant');
  }
  const output = harness.useCases.submitAnswer.execute({
    sessionId: started.plan.id,
    itemId: item.id,
    grade,
    confidence: null,
    responseTimeMs: 1_000,
    hintsUsed: 0,
    channel: 'written',
  });
  const finished = harness.useCases.finishSession.execute({
    sessionId: started.plan.id,
  });
  return output.scheduledReview === null && finished.summary.itemCount === 1
    ? finished.summary.sessionId
    : finished.summary.sessionId;
}

describe('fenêtres de journée déduites de ClockPort (L17)', () => {
  it('clôture à 8 h 00 puis à 21 h 30 à Paris : morning puis evening', () => {
    const harness = createHarness({ seed: seedWithEveningQuest('2026-06-10') });
    seedFreshProgress(harness);

    // Session du matin : démarrage, réponse et clôture à 8 h 00 locales.
    void runOneAnswer(harness);
    const afterMorning = readLogs(harness);
    expect(afterMorning).toHaveLength(1);
    expect(afterMorning[0]?.window).toBe('morning');

    // Session du soir : même jour civil, 13 h 30 plus tard (21 h 30 locales).
    harness.clock.advance(EVENING_DELTA_MS);
    void runOneAnswer(harness);
    const afterEvening = readLogs(harness);
    expect(afterEvening).toHaveLength(2);
    expect(afterEvening[1]?.window).toBe('evening');
    expect((afterEvening[1]?.startedAt ?? 0) - (afterMorning[0]?.startedAt ?? 0)).toBe(
      EVENING_DELTA_MS,
    );
  });

  it('classe toutes les bornes : night, morning, day, evening, night', () => {
    const harness = createHarness();
    const clock = harness.clock;
    // 8 h 00 locales de référence.
    expect(resolveSessionWindow(clock, NOW)).toBe('morning');
    expect(resolveSessionWindow(clock, NOW + 4 * 3_600_000)).toBe('day'); // 12 h
    expect(resolveSessionWindow(clock, NOW + 11 * 3_600_000)).toBe('evening'); // 19 h
    expect(resolveSessionWindow(clock, NOW + 15 * 3_600_000)).toBe('night'); // 23 h
    expect(resolveSessionWindow(clock, NOW - 3 * 3_600_000)).toBe('morning'); // 5 h pile
    expect(resolveSessionWindow(clock, NOW - 4 * 3_600_000)).toBe('night'); // 4 h
  });

  it('classe correctement les deux jours de changement d’heure, sans décalage d’une heure (L17)', () => {
    const clock = new SystemClock({ timeZone: 'Europe/Paris', now: () => 0 });
    // 25/10/2026 (retour à l'heure d'hiver) : 17:30Z = 18:30 locale. L'ancien
    // calcul par écart à `startOfLocalDay` la classait `evening` : elle est
    // `day` (18:30 < 19:00).
    const fallBack = Date.parse('2026-10-25T17:30:00Z');
    expect(clock.localHourOfDay(fallBack)).toBe(18);
    expect(resolveSessionWindow(clock, fallBack)).toBe('day');
    // 29/03/2026 (passage à l'heure d'été) : 17:30Z = 19:30 locale. L'ancien
    // calcul la classait `day` : elle est `evening` (19:30 ≥ 19:00).
    const springForward = Date.parse('2026-03-29T17:30:00Z');
    expect(clock.localHourOfDay(springForward)).toBe(19);
    expect(resolveSessionWindow(clock, springForward)).toBe('evening');
  });

  it('conserve des bornes exactes (04:59 night, 05:00 morning, 12:00 day, 19:00 evening, 23:00 night)', () => {
    const clock = new SystemClock({ timeZone: 'Europe/Paris', now: () => 0 });
    const at = (hour: string, minute: string): number =>
      Date.parse(`2026-06-10T${hour}:${minute}:00+02:00`);
    expect(resolveSessionWindow(clock, at('04', '59'))).toBe('night');
    expect(resolveSessionWindow(clock, at('05', '00'))).toBe('morning');
    expect(resolveSessionWindow(clock, at('11', '59'))).toBe('morning');
    expect(resolveSessionWindow(clock, at('12', '00'))).toBe('day');
    expect(resolveSessionWindow(clock, at('18', '59'))).toBe('day');
    expect(resolveSessionWindow(clock, at('19', '00'))).toBe('evening');
    expect(resolveSessionWindow(clock, at('22', '59'))).toBe('evening');
    expect(resolveSessionWindow(clock, at('23', '00'))).toBe('night');
  });

  it('ne fait progresser la quête du soir que sur une réponse du soir', () => {
    const harness = createHarness({ seed: seedWithEveningQuest('2026-06-10') });
    seedFreshProgress(harness);

    // Réponse du matin : la quête du soir ne bouge pas.
    void runOneAnswer(harness);
    const morningQuest = readBoard(harness)?.quests.find(
      (quest) => quest.questId === 'revision-du-soir',
    );
    expect(morningQuest?.progress).toBe(0);

    // Réponse du soir, même jour : elle compte.
    harness.clock.advance(EVENING_DELTA_MS);
    void runOneAnswer(harness);
    const eveningQuest = readBoard(harness)?.quests.find(
      (quest) => quest.questId === 'revision-du-soir',
    );
    expect(eveningQuest?.progress).toBe(1);
  });
});

/* ── Lectures de l'état persisté (formes minimales) ──────────────────────── */

interface PersistedBoardShape {
  readonly player: {
    readonly questBoard: {
      readonly quests: readonly { readonly questId: string; readonly progress: number }[];
    } | null;
  };
  readonly sessionLogs: readonly { readonly window: string; readonly startedAt: number }[];
}

function readProgress(harness: TestHarness): PersistedBoardShape {
  const raw = harness.storage.read('aron36.progress');
  if (!raw.ok || raw.value === null) {
    throw new Error('progression absente du stockage');
  }
  return JSON.parse(raw.value) as PersistedBoardShape;
}

function readLogs(harness: TestHarness): PersistedBoardShape['sessionLogs'] {
  return readProgress(harness).sessionLogs;
}

function readBoard(harness: TestHarness): NonNullable<PersistedBoardShape['player']['questBoard']> {
  const board = readProgress(harness).player.questBoard;
  if (board === null) {
    throw new Error('tableau de quêtes absent');
  }
  return board;
}
