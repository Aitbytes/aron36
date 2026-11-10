import { describe, expect, it } from 'vitest';

import { SystemClock } from './SystemClock';

/** Transitions 2026 pour l'Europe/Paris : été le 29/03 (01:00 UTC), hiver le 25/10 (01:00 UTC). */
const PARIS = 'Europe/Paris';

describe('SystemClock', () => {
  it('fournit l’instant courant depuis la source injectée', () => {
    const clock = new SystemClock({ now: () => 1_234_567 });
    expect(clock.now()).toBe(1_234_567);
  });

  it('donne le jour civil local, différent de la date UTC près de minuit', () => {
    const clock = new SystemClock({ timeZone: PARIS });
    // 23:30 UTC le 28/03 = 00:30 le 29/03 à Paris (UTC+1 avant le changement).
    expect(clock.dayKey(Date.parse('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
    // 23:30 UTC le 24/10 = 01:30 le 25/10 à Paris (UTC+2 avant le recul).
    expect(clock.dayKey(Date.parse('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    // Milieu de journée : jour identique en UTC et à Paris.
    expect(clock.dayKey(Date.parse('2026-06-15T12:00:00Z'))).toBe('2026-06-15');
  });

  it('situe le début du jour local aux deux changements d’heure (Europe/Paris)', () => {
    const clock = new SystemClock({ timeZone: PARIS });
    // Nuit d'été : minuit local = 23:00 UTC la veille (UTC+2 ensuite).
    expect(clock.startOfLocalDay('2026-03-29')).toBe(Date.parse('2026-03-28T23:00:00Z'));
    // Nuit d'hiver : minuit local = 22:00 UTC la veille (UTC+2 avant le recul).
    expect(clock.startOfLocalDay('2026-10-25')).toBe(Date.parse('2026-10-24T22:00:00Z'));
    // Jours sans transition : décalage constant d'une heure.
    expect(clock.startOfLocalDay('2026-01-15')).toBe(Date.parse('2026-01-14T23:00:00Z'));
    expect(clock.startOfLocalDay('2026-07-04')).toBe(Date.parse('2026-07-03T22:00:00Z'));
  });

  it('vérifie l’aller-retour dayKey ↔ startOfLocalDay autour des transitions', () => {
    const clock = new SystemClock({ timeZone: PARIS });
    for (const window of [springForward2026(), fallBack2026()]) {
      for (let at = window.from; at <= window.to; at += 15 * 60_000) {
        const dayKey = clock.dayKey(at);
        const start = clock.startOfLocalDay(dayKey);
        const nextDay = nextDayKey(dayKey);
        expect(at >= start, `${new Date(at).toISOString()} avant le début de ${dayKey}`).toBe(true);
        expect(
          at < clock.startOfLocalDay(nextDay),
          `${new Date(at).toISOString()} hors de ${dayKey}`,
        ).toBe(true);
      }
    }
  });

  it('donne l’heure civile locale exacte les deux jours de changement d’heure (Europe/Paris)', () => {
    const clock = new SystemClock({ timeZone: PARIS });
    // 25/10/2026 : retour à l'heure d'hiver. 17:30Z = 18:30 locale (UTC+1).
    expect(clock.localHourOfDay(Date.parse('2026-10-25T17:30:00Z'))).toBe(18);
    // 29/03/2026 : passage à l'heure d'été. 17:30Z = 19:30 locale (UTC+2).
    expect(clock.localHourOfDay(Date.parse('2026-03-29T17:30:00Z'))).toBe(19);
    // Bornes de journée : 04:59, 05:00, 12:00, 19:00, 23:00 locale (été, UTC+2).
    expect(clock.localHourOfDay(Date.parse('2026-06-10T02:59:00Z'))).toBe(4);
    expect(clock.localHourOfDay(Date.parse('2026-06-10T03:00:00Z'))).toBe(5);
    expect(clock.localHourOfDay(Date.parse('2026-06-10T10:00:00Z'))).toBe(12);
    expect(clock.localHourOfDay(Date.parse('2026-06-10T17:00:00Z'))).toBe(19);
    expect(clock.localHourOfDay(Date.parse('2026-06-10T21:00:00Z'))).toBe(23);
  });

  it('honore un fuseau configurable (UTC)', () => {
    const utc = new SystemClock({ timeZone: 'UTC' });
    expect(utc.timeZone).toBe('UTC');
    expect(utc.startOfLocalDay('2026-03-29')).toBe(Date.parse('2026-03-29T00:00:00Z'));
    expect(utc.dayKey(Date.parse('2026-03-29T23:00:00Z'))).toBe('2026-03-29');
    // Même instant, deux fuseaux, deux jours civils distincts.
    const paris = new SystemClock({ timeZone: PARIS });
    const instant = Date.parse('2026-03-29T23:00:00Z');
    expect(paris.dayKey(instant)).toBe('2026-03-30');
    expect(utc.dayKey(instant)).toBe('2026-03-29');
  });

  it('rejette un DayKey malformé par une erreur de programmation explicite', () => {
    const clock = new SystemClock({ timeZone: PARIS });
    expect(() => clock.startOfLocalDay('2026/03/29')).toThrow(RangeError);
    expect(() => clock.startOfLocalDay('n’importe quoi')).toThrow(RangeError);
  });
});

function springForward2026(): { from: number; to: number } {
  return {
    from: Date.parse('2026-03-28T20:00:00Z'),
    to: Date.parse('2026-03-30T06:00:00Z'),
  };
}

function fallBack2026(): { from: number; to: number } {
  return {
    from: Date.parse('2026-10-24T20:00:00Z'),
    to: Date.parse('2026-10-26T06:00:00Z'),
  };
}

function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map((part) => Number(part));
  if (year === undefined || month === undefined || day === undefined) {
    throw new RangeError(`DayKey invalide : ${dayKey}`);
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}
