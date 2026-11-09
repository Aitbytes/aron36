import type { DayKey } from '@/domain/shared/types';
import type { StreakState, StreakUpdate, StreakUpdateInput, StreakUpdater } from './types';

/**
 * Série quotidienne et gel (L17).
 *
 * Anti-objectifs servis par ce module :
 * - **pas de punition** : une interruption non couverte repart de 1, mais
 *   `longest` est conservé, les gels restants ne sont pas confisqués et aucune
 *   progression n'est effacée ;
 * - **pas de dark pattern** : un gel est consommé automatiquement, sans écran
 *   culpabilisant ni rappel anxiogène.
 *
 * Une journée est validée par au moins `minProductionAnswersPerDay` productions
 * réussies. La mise à jour est idempotente : rappelée le même jour, elle ne
 * double pas la série.
 */

/*
 * Arithmétique de `DayKey` (calendrier grégorien proleptique), pure et sans
 * `Date` : le domaine ne peut pas lire l'horloge, mais il doit nommer les jours
 * couverts par un gel (`StreakState.frozenDays`). Les algorithmes sont ceux de
 * Howard Hinnant (`days_from_civil` / `civil_from_days`), entièrement
 * arithmétiques.
 */

const CIVIL_EPOCH_OFFSET = 719468;
const DAYS_PER_ERA = 146097;

/** Numéro de jour depuis le 1970-01-01 pour une date grégorienne. */
function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * DAYS_PER_ERA + dayOfEra - CIVIL_EPOCH_OFFSET;
}

/** Date grégorienne correspondant à un numéro de jour depuis le 1970-01-01. */
function civilFromDays(daysSinceEpoch: number): { year: number; month: number; day: number } {
  const shifted = daysSinceEpoch + CIVIL_EPOCH_OFFSET;
  const era = Math.floor(shifted / DAYS_PER_ERA);
  const dayOfEra = shifted - era * DAYS_PER_ERA;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  return { year: month <= 2 ? year + 1 : year, month, day };
}

/** `YYYY-MM-DD` → numéro de jour (les entrées proviennent de `ClockPort`). */
function dayKeyToEpochDay(dayKey: DayKey): number {
  return daysFromCivil(
    Number(dayKey.slice(0, 4)),
    Number(dayKey.slice(5, 7)),
    Number(dayKey.slice(8, 10)),
  );
}

/** Numéro de jour → `YYYY-MM-DD`. */
function epochDayToDayKey(epochDay: number): DayKey {
  const { year, month, day } = civilFromDays(epochDay);
  const paddedYear = String(year).padStart(4, '0');
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  return `${paddedYear}-${paddedMonth}-${paddedDay}`;
}

/** Jour décalé de `delta` jours (négatif accepté). */
function addDaysToDayKey(dayKey: DayKey, delta: number): DayKey {
  return epochDayToDayKey(dayKeyToEpochDay(dayKey) + delta);
}

/** Les `missedDays` jours manqués qui précèdent `today`, du plus ancien au plus récent. */
function missedDayKeys(today: DayKey, missedDays: number): DayKey[] {
  const keys: DayKey[] = [];
  for (let offset = missedDays; offset >= 1; offset -= 1) {
    keys.push(addDaysToDayKey(today, -offset));
  }
  return keys;
}

/** Un gel est gagné à chaque multiple de `freezeEarnedEveryDays` jours de série. */
function freezesAfterEarning(freezes: number, current: number, input: StreakUpdateInput): number {
  const { rules } = input;
  if (current <= 0 || current % rules.freezeEarnedEveryDays !== 0) {
    return freezes;
  }
  return Math.min(freezes + 1, rules.maxFreezes);
}

/**
 * Met à jour la série après une activité.
 *
 * Règles :
 * - journée non validée → état inchangé, `extended: false` (rien n'est perdu) ;
 * - journée déjà validée → état inchangé (idempotence) ;
 * - jours manqués couverts par un gel → série prolongée, gels consommés ;
 * - jours manqués non couverts → série repartant de 1, `longest` conservé,
 *   gels conservés.
 */
function update(input: StreakUpdateInput): StreakUpdate {
  const { state, today, qualifyingProductionsToday, daysSinceLastActive, rules } = input;

  const validatedToday = qualifyingProductionsToday >= rules.minProductionAnswersPerDay;
  if (!validatedToday) {
    return { state, extended: false, frozenDays: [], broken: false };
  }

  if (state.lastActiveDay === today) {
    return { state, extended: false, frozenDays: [], broken: false };
  }

  const gap = daysSinceLastActive ?? 0;
  const missedDays = state.lastActiveDay === null ? 0 : Math.max(0, gap - 1);

  let current: number;
  let freezes = state.freezes;
  let frozenDays: DayKey[] = [];
  let broken = false;

  if (state.lastActiveDay === null) {
    current = 1;
  } else if (rules.autoConsumeFreeze && missedDays > 0 && freezes >= missedDays) {
    freezes -= missedDays;
    frozenDays = missedDayKeys(today, missedDays);
    current = state.current + 1;
  } else if (missedDays > 0) {
    current = 1;
    broken = true;
  } else {
    current = state.current + 1;
  }

  freezes = freezesAfterEarning(freezes, current, input);

  // Garde-fou : un état corrompu (compteur négatif) ne doit jamais se propager.
  const nextCurrent = Math.max(0, current);
  const nextState: StreakState = {
    current: nextCurrent,
    longest: Math.max(0, state.longest, nextCurrent),
    lastActiveDay: today,
    freezes,
    frozenDays: frozenDays.length > 0 ? [...state.frozenDays, ...frozenDays] : state.frozenDays,
  };

  return { state: nextState, extended: true, frozenDays, broken };
}

/** Mise à jour de série pure : aucune horloge, aucune écriture. */
export const streakUpdater: StreakUpdater = { update };
