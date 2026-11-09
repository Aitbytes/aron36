import type { ClockPort } from '@/application/ports/ClockPort';
import type { DayKey, EpochMs } from '@/domain/shared/types';

/**
 * Horloge système réelle (ADR 0008).
 *
 * - `now()` lit l'horloge du moteur (injectable en test via `now`);
 * - `dayKey(at)` donne le jour civil **local** au fuseau configuré, via
 *   `Intl.DateTimeFormat` (les transitions d'heure été/hiver sont gérées par
 *   la base tz du moteur, pas par arithmétique naïve de 24 h) ;
 * - `startOfLocalDay(dayKey)` convertit un jour civil en instant epoch en
 *   résolvant l'offset du fuseau par itération : cela reste correct les jours
 *   de changement d'heure (voir les tests `Europe/Paris`).
 *
 * Aucune logique métier ici : cette classe est la **seule** frontière où `Date`
 * est autorisé (hors tests).
 */
export interface SystemClockOptions {
  /** Fuseau IANA (ex. `Europe/Paris`). Défaut : fuseau du système. */
  readonly timeZone?: string | undefined;
  /** Source du temps, injectable pour les tests. Défaut : `Date.now`. */
  readonly now?: (() => EpochMs) | undefined;
}

/** Format d'un jour civil : `YYYY-MM-DD`. */
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export class SystemClock implements ClockPort {
  readonly timeZone: string;

  private readonly nowFn: () => EpochMs;

  private readonly localPartsFormatter: Intl.DateTimeFormat;

  constructor(options: SystemClockOptions = {}) {
    this.nowFn = options.now ?? (() => Date.now());
    this.timeZone = options.timeZone ?? resolveSystemTimeZone();
    this.localPartsFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  now(): EpochMs {
    return this.nowFn();
  }

  dayKey(at: EpochMs): DayKey {
    const parts = this.localPartsFormatter.formatToParts(new Date(at));
    const year = partOf(parts, 'year');
    const month = partOf(parts, 'month');
    const day = partOf(parts, 'day');
    return `${year}-${month}-${day}`;
  }

  startOfLocalDay(dayKey: DayKey): EpochMs {
    const match = DAY_KEY_PATTERN.exec(dayKey);
    if (match === null) {
      throw new RangeError(`DayKey invalide (YYYY-MM-DD attendu) : ${dayKey}`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    // On part de minuit local « interprété comme UTC », puis on retire l'offset
    // réel du fuseau à cet instant. Si l'offset mesuré au candidat diffère
    // (changement d'heure traversé), on réitère : deux à trois passes
    // convergent toujours pour un jour civil existant.
    let candidate: EpochMs = Date.UTC(year, month - 1, day);
    for (let pass = 0; pass < 3; pass += 1) {
      const offset = this.offsetMs(candidate);
      const next = candidate - offset;
      if (next === candidate || this.offsetMs(next) === offset) {
        return next;
      }
      candidate = next;
    }
    return candidate;
  }

  /** Offset du fuseau (ms) à l'instant donné ; multiple d'une minute. */
  private offsetMs(at: EpochMs): number {
    const parts = this.localPartsFormatter.formatToParts(new Date(at));
    const asUtc = Date.UTC(
      Number(partOf(parts, 'year')),
      Number(partOf(parts, 'month')) - 1,
      Number(partOf(parts, 'day')),
      Number(partOf(parts, 'hour')) % 24,
      Number(partOf(parts, 'minute')),
      Number(partOf(parts, 'second')),
    );
    const secondAligned = at - (at % 1000);
    return asUtc - secondAligned;
  }
}

/** Fuseau du système, avec repli sûr si `Intl` ne le rapporte pas. */
function resolveSystemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((part) => part.type === type);
  if (found === undefined) {
    throw new RangeError(`partie « ${type} » absente du formatage Intl (fuseau invalide ?)`);
  }
  return found.value;
}
