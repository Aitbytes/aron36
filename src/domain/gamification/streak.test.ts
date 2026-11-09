import { describe, expect, it } from 'vitest';

import type { DayKey } from '@/domain/shared/types';
import { streakUpdater } from './streak';
import type { StreakState, StreakUpdateInput } from './types';
import { STREAK_RULES } from './types';

/**
 * Anti-objectif « pas de punition » (docs/ARCHITECTURE.md § 8.7) : un gel évite
 * la rupture sans perte ; une rupture non couverte repart de 1 mais conserve
 * `longest`, les gels restants et l’historique des jours gelés.
 */

function state(overrides: Partial<StreakState> = {}): StreakState {
  return { current: 0, longest: 0, lastActiveDay: null, freezes: 0, frozenDays: [], ...overrides };
}

function input(overrides: Partial<StreakUpdateInput> = {}): StreakUpdateInput {
  return {
    state: state(),
    today: '2024-03-10',
    qualifyingProductionsToday: 1,
    daysSinceLastActive: null,
    rules: STREAK_RULES,
    ...overrides,
  };
}

describe('streak — validation d’une journée', () => {
  it('démarre la série à 1 à la première journée validée', () => {
    const result = streakUpdater.update(input());
    expect(result.extended).toBe(true);
    expect(result.broken).toBe(false);
    expect(result.state).toEqual({
      current: 1,
      longest: 1,
      lastActiveDay: '2024-03-10',
      freezes: 0,
      frozenDays: [],
    });
  });

  it('ne valide pas une journée sans production suffisante', () => {
    const result = streakUpdater.update(
      input({
        state: state({ current: 4, longest: 4, lastActiveDay: '2024-03-09' }),
        qualifyingProductionsToday: 0,
      }),
    );
    expect(result).toEqual({
      state: state({ current: 4, longest: 4, lastActiveDay: '2024-03-09' }),
      extended: false,
      frozenDays: [],
      broken: false,
    });
  });

  it('est idempotente le même jour', () => {
    const first = streakUpdater.update(
      input({ state: state({ current: 3, longest: 3, lastActiveDay: '2024-03-09' }) }),
    );
    expect(first.state.current).toBe(4);
    const second = streakUpdater.update(
      input({
        state: first.state,
        today: '2024-03-10',
        daysSinceLastActive: 0,
        qualifyingProductionsToday: 5,
      }),
    );
    expect(second.extended).toBe(false);
    expect(second.state).toEqual(first.state);
  });

  it('prolonge la série sur des jours consécutifs', () => {
    const result = streakUpdater.update(
      input({
        state: state({ current: 6, longest: 6, lastActiveDay: '2024-03-09' }),
        daysSinceLastActive: 1,
      }),
    );
    expect(result.state.current).toBe(7);
    expect(result.state.longest).toBe(7);
    expect(result.broken).toBe(false);
  });

  it('ignore un écart incohérent de zéro jour', () => {
    const result = streakUpdater.update(
      input({
        state: state({ current: 2, longest: 2, lastActiveDay: '2024-03-01' }),
        daysSinceLastActive: 0,
      }),
    );
    expect(result.state.current).toBe(3);
    expect(result.frozenDays).toEqual([]);
  });

  it('n’accepte pas de compteur négatif comme validation', () => {
    const result = streakUpdater.update(input({ qualifyingProductionsToday: -1 }));
    expect(result.extended).toBe(false);
  });
});

describe('streak — gel', () => {
  it('gagne un gel tous les 7 jours, plafonné à 2', () => {
    const seventh = streakUpdater.update(
      input({
        state: state({ current: 6, longest: 6, lastActiveDay: '2024-03-09' }),
        daysSinceLastActive: 1,
      }),
    );
    expect(seventh.state).toMatchObject({ current: 7, freezes: 1 });

    const fourteenth = streakUpdater.update(
      input({
        state: state({ current: 13, longest: 13, lastActiveDay: '2024-03-16', freezes: 1 }),
        today: '2024-03-17',
        daysSinceLastActive: 1,
      }),
    );
    expect(fourteenth.state).toMatchObject({ current: 14, freezes: 2 });

    const capped = streakUpdater.update(
      input({
        state: state({ current: 20, longest: 20, lastActiveDay: '2024-03-23', freezes: 2 }),
        today: '2024-03-24',
        daysSinceLastActive: 1,
      }),
    );
    expect(capped.state).toMatchObject({ current: 21, freezes: 2 });
  });

  it('ne gagne pas de gel si la période est nulle', () => {
    const result = streakUpdater.update(
      input({
        state: state({ current: 6, longest: 6, lastActiveDay: '2024-03-09' }),
        daysSinceLastActive: 1,
        rules: { ...STREAK_RULES, freezeEarnedEveryDays: 0 },
      }),
    );
    expect(result.state.freezes).toBe(0);
  });

  it('couvre automatiquement les jours manqués avec les gels disponibles', () => {
    const result = streakUpdater.update(
      input({
        state: state({
          current: 5,
          longest: 5,
          lastActiveDay: '2024-03-05',
          freezes: 4,
          frozenDays: ['2024-01-01'],
        }),
        today: '2024-03-09',
        daysSinceLastActive: 4,
      }),
    );
    expect(result.extended).toBe(true);
    expect(result.broken).toBe(false);
    expect(result.frozenDays).toEqual(['2024-03-06', '2024-03-07', '2024-03-08']);
    expect(result.state.current).toBe(6);
    expect(result.state.freezes).toBe(1);
    expect(result.state.frozenDays).toEqual([
      '2024-01-01',
      '2024-03-06',
      '2024-03-07',
      '2024-03-08',
    ]);
  });

  it('calcule les jours gelés à travers un changement de mois et d’année', () => {
    const monthBoundary = streakUpdater.update(
      input({
        state: state({ current: 2, longest: 2, lastActiveDay: '2024-02-28', freezes: 2 }),
        today: '2024-03-02',
        daysSinceLastActive: 3,
      }),
    );
    expect(monthBoundary.frozenDays).toEqual(['2024-02-29', '2024-03-01']);

    const yearBoundary = streakUpdater.update(
      input({
        state: state({ current: 2, longest: 2, lastActiveDay: '2024-12-30', freezes: 2 }),
        today: '2025-01-02',
        daysSinceLastActive: 3,
      }),
    );
    expect(yearBoundary.frozenDays).toEqual(['2024-12-31', '2025-01-01']);
  });

  it('ne consomme pas de gel quand l’option est désactivée', () => {
    const result = streakUpdater.update(
      input({
        state: state({ current: 5, longest: 5, lastActiveDay: '2024-03-05', freezes: 2 }),
        today: '2024-03-09',
        daysSinceLastActive: 4,
        rules: { ...STREAK_RULES, autoConsumeFreeze: false },
      }),
    );
    expect(result.broken).toBe(true);
    expect(result.state.freezes).toBe(2);
    expect(result.frozenDays).toEqual([]);
  });
});

describe('streak — rupture sans punition', () => {
  it('repart de 1, conserve longest et les gels quand la couverture est insuffisante', () => {
    const result = streakUpdater.update(
      input({
        state: state({
          current: 12,
          longest: 30,
          lastActiveDay: '2024-03-01',
          freezes: 1,
          frozenDays: ['2024-02-01'],
        }),
        today: '2024-03-10',
        daysSinceLastActive: 9,
      }),
    );
    expect(result.broken).toBe(true);
    expect(result.extended).toBe(true);
    expect(result.state.current).toBe(1);
    expect(result.state.longest).toBe(30);
    expect(result.state.freezes).toBe(1);
    expect(result.state.frozenDays).toEqual(['2024-02-01']);
    expect(result.frozenDays).toEqual([]);
  });

  it('n’expose jamais un compteur négatif', () => {
    const result = streakUpdater.update(
      input({ state: state({ current: -5, longest: -5, lastActiveDay: '2024-03-01' }) }),
    );
    expect(result.state.current).toBeGreaterThanOrEqual(0);
    expect(result.state.longest).toBeGreaterThanOrEqual(0);
  });

  it('gère un jour unique isolé et un grand écart', () => {
    const single = streakUpdater.update(
      input({ state: state(), today: '2024-02-29', qualifyingProductionsToday: 3 }),
    );
    expect(single.state.lastActiveDay).toBe('2024-02-29');

    const wide = streakUpdater.update(
      input({
        state: state({ current: 3, longest: 3, lastActiveDay: '2020-01-01', freezes: 2 }),
        today: '2024-03-01',
        daysSinceLastActive: 1521,
      }),
    );
    expect(wide.broken).toBe(true);
    expect(wide.state.current).toBe(1);
  });

  it('accepte n’importe quelle chaîne de jour fournie par ClockPort', () => {
    const today: DayKey = '2030-12-31';
    const result = streakUpdater.update(input({ today }));
    expect(result.state.lastActiveDay).toBe(today);
  });
});
