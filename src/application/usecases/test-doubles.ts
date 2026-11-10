import { DAY_MS, HOUR_MS } from '@/domain/shared/types';
import type {
  DayKey,
  EpochMs,
  IsoDateTime,
  RandomSeed,
  SessionId,
  ReviewLogId,
} from '@/domain/shared/types';
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from '@/domain/progress/types';
import type {
  ExportEnvelope,
  PersistedProgress,
  ProgressDecodeResult,
  ProgressImportResult,
} from '@/domain/progress/types';
import type { ClockPort } from '@/application/ports/ClockPort';
import type { IdPort } from '@/application/ports/IdPort';
import type { RandomPort } from '@/application/ports/RandomPort';
import type { SpeechPort } from '@/application/ports/SpeechPort';
import type { StorageKey, StoragePort } from '@/application/ports/StoragePort';
import { createAppServices, createInitialProgress } from '@/application/bootstrap';
import { QUESTION_CATALOG } from '@/domain/questions';
import { sessionBuilder } from '@/domain/session';
import type { CardState } from '@/domain/srs/types';
import type { ProgressCodec } from '@/domain/progress/types';

import { createUseCases } from './create-use-cases';
import type { AppServices, UseCases } from './types';

/** Sonde déterministe : graine produisant un premier item de QCM. */
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

/**
 * Doubles en mémoire pour les cas d'usage (aucun `Date.now`, aucun
 * `Math.random`, aucun `localStorage`) :
 * - `FixedClock` : horloge fixe **avançable**, à décalage UTC constant —
 *   l'arithmétique civile (Howard Hinnant) est pure et déterministe ;
 * - `MemoryStorage` : stockage clé/valeur en `Map`, avec amorce de test ;
 * - `createSequentialIds` : identifiants prévisibles (`session-1`,
 *   `review-log-1`, `profile-1`), ce qui permet d'**prouver** que les cas
 *   d'usage passent bien par `IdPort` ;
 * - `createStubProgressCodec` : codec minimal de test (JSON + garde de
 *   version). TODO(progress-lot) : il sera remplacé par le vrai codec de
 *   `@/application/progress` dès que le lot parallèle le livre — aucune
 *   validation de forme n'est dupliquée ici, seule la mécanique de version
 *   (`future-version`) est simulée pour tester `hydrate`.
 */

/* ── Arithmétique civile pure (jours ↔ YYYY-MM-DD) ────────────────────────── */

const DAYS_PER_ERA = 146097;
const CIVIL_EPOCH_OFFSET = 719468;

function civilFromEpochDay(epochDay: number): { year: number; month: number; day: number } {
  const shifted = epochDay + CIVIL_EPOCH_OFFSET;
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

function epochDayFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * DAYS_PER_ERA + dayOfEra - CIVIL_EPOCH_OFFSET;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Date ISO 8601 UTC pure, pour l'enveloppe d'export du double. */
function isoUtc(at: EpochMs): IsoDateTime {
  const epochDay = Math.floor(at / DAY_MS);
  const msOfDay = at - epochDay * DAY_MS;
  const { year, month, day } = civilFromEpochDay(epochDay);
  const hour = Math.floor(msOfDay / HOUR_MS);
  const minute = Math.floor((msOfDay % HOUR_MS) / 60_000);
  const second = Math.floor((msOfDay % 60_000) / 1000);
  const millisecond = msOfDay % 1000;
  return (
    `${pad(year, 4)}-${pad(month)}-${pad(day)}` +
    `T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(millisecond, 3)}Z`
  );
}

/* ── Horloge fixe et avançable ────────────────────────────────────────────── */

/** Horloge de test : instant figé, décalage UTC constant, fuseau choisi. */
export class FixedClock implements ClockPort {
  readonly timeZone: string;
  private readonly offsetMs: number;
  private current: EpochMs;

  constructor(now: EpochMs, offsetMinutes = 120, timeZone = 'Europe/Paris') {
    this.current = now;
    this.offsetMs = offsetMinutes * 60_000;
    this.timeZone = timeZone;
  }

  now(): EpochMs {
    return this.current;
  }

  /** Avance (ou recule) l'horloge d'une durée connue — aucune horloge réelle. */
  advance(deltaMs: number): void {
    this.current += deltaMs;
  }

  dayKey(at: EpochMs): DayKey {
    const { year, month, day } = civilFromEpochDay(Math.floor((at + this.offsetMs) / DAY_MS));
    return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  }

  startOfLocalDay(dayKey: DayKey): EpochMs {
    const year = Number(dayKey.slice(0, 4));
    const month = Number(dayKey.slice(5, 7));
    const day = Number(dayKey.slice(8, 10));
    return epochDayFromCivil(year, month, day) * DAY_MS - this.offsetMs;
  }
}

/* ── Stockage mémoire ─────────────────────────────────────────────────────── */

/** Stockage clé/valeur en mémoire, avec amorce pour préparer un état. */
export class MemoryStorage implements StoragePort {
  private readonly entries = new Map<StorageKey, string>();

  isAvailable(): boolean {
    return true;
  }

  read(key: StorageKey): { ok: true; value: string | null } {
    return { ok: true, value: this.entries.get(key) ?? null };
  }

  write(key: StorageKey, value: string): { ok: true; value: undefined } {
    this.entries.set(key, value);
    return { ok: true, value: undefined };
  }

  remove(key: StorageKey): { ok: true; value: undefined } {
    this.entries.delete(key);
    return { ok: true, value: undefined };
  }

  keys(): { ok: true; value: readonly StorageKey[] } {
    return { ok: true, value: [...this.entries.keys()] };
  }

  /** Amorce de test : écrit directement, sans passer par le codec. */
  seedRaw(key: StorageKey, value: string): void {
    this.entries.set(key, value);
  }
}

/* ── Identifiants séquentiels et aléa contrôlé ────────────────────────────── */

/** Identifiants prévisibles : la séquence prouve l'usage réel de `IdPort`. */
export function createSequentialIds(): IdPort {
  let sessions = 0;
  let logs = 0;
  let profiles = 0;
  return {
    newSessionId: (): SessionId => `session-${String(++sessions)}`,
    newReviewLogId: (): ReviewLogId => `review-log-${String(++logs)}`,
    newProfileId: (): string => `profile-${String(++profiles)}`,
  };
}

/** Fabrique de graines : fixe (`seed`) ou compteur lisible. */
export function createSeedFactory(seed?: RandomSeed): () => RandomSeed {
  let counter = 0;
  return () => seed ?? `seed-${String(++counter)}`;
}

/** Port vocal muet : les cas d'usage ne lisent jamais la voix. */
export const silentSpeech: SpeechPort = {
  isAvailable: () => false,
  voices: () => [],
  speak: () => Promise.resolve({ ok: true }),
  cancel: () => undefined,
};

/** Port d'aléa mémoire pour `createRandom` (jamais consommé par les tests UI). */
export function memoryRandom(seed: RandomSeed): RandomPort {
  let state = 0;
  for (let index = 0; index < seed.length; index += 1) {
    state = (Math.imul(state, 31) + seed.charCodeAt(index)) | 0;
  }
  return {
    seed,
    nextFloat: () => {
      state = (Math.imul(state, 1103515245) + 12345) | 0;
      return ((state >>> 0) % 1_000_000) / 1_000_000;
    },
    nextInt: (minInclusive, maxExclusive) => {
      if (maxExclusive <= minInclusive) {
        throw new Error('plage vide');
      }
      return minInclusive + (((state >>> 0) % (maxExclusive - minInclusive)) | 0);
    },
    shuffle: <T>(items: readonly T[]): readonly T[] => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = ((state >>> 0) % (index + 1)) | 0;
        state = (Math.imul(state, 1103515245) + 12345) | 0;
        const a = copy[index];
        const b = copy[swap];
        if (a !== undefined && b !== undefined) {
          copy[index] = b;
          copy[swap] = a;
        }
      }
      return copy;
    },
  };
}

/* ── Codec minimal de test ───────────────────────────────────────────────── */

/**
 * Décode une progression depuis du JSON **sans** valider la forme (le vrai
 * validateur appartient au codec du lot parallèle) : seule la version du
 * schéma est vérifiée, pour tester les statuts `future-version`/`corrupt`.
 */
function decodeInternal(raw: string): ProgressDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      error: { code: 'invalid-json', message: 'JSON illisible (double de test).', details: null },
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      ok: false,
      error: { code: 'invalid-shape', message: 'Forme non objet (double de test).', details: null },
    };
  }
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number') {
    return {
      ok: false,
      error: {
        code: 'invalid-shape',
        message: 'schemaVersion absent (double de test).',
        details: null,
      },
    };
  }
  if (version > MAX_SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: 'future-version',
        message: `Schéma ${String(version)} postérieur au support (double de test).`,
        details: { version: String(version) },
      },
    };
  }
  if (version < MIN_SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: 'unsupported-version',
        message: `Schéma ${String(version)} trop ancien (double de test).`,
        details: null,
      },
    };
  }
  return { ok: true, progress: parsed as PersistedProgress, migratedFrom: null };
}

/** Codec de test : sérialisation JSON triviale + garde de version. */
export function createStubProgressCodec(): ProgressCodec {
  return {
    encode: (progress: PersistedProgress) => JSON.stringify(progress),
    decode: decodeInternal,
    toExport: (progress: PersistedProgress, now: EpochMs): ExportEnvelope => ({
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: isoUtc(now),
      progress,
    }),
    fromExport: (raw: string): ProgressImportResult => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return {
          ok: false,
          error: {
            code: 'invalid-json',
            message: 'Export illisible (double de test).',
            details: null,
          },
        };
      }
      const envelope = parsed as Partial<ExportEnvelope> | null;
      if (
        envelope === null ||
        typeof envelope !== 'object' ||
        envelope.format !== EXPORT_FORMAT ||
        envelope.formatVersion !== EXPORT_FORMAT_VERSION
      ) {
        return {
          ok: false,
          error: {
            code: 'invalid-shape',
            message: 'Enveloppe d\u2019export inconnue (double de test).',
            details: null,
          },
        };
      }
      return decodeInternal(JSON.stringify(envelope.progress));
    },
  };
}

/* ── Harnais complet ─────────────────────────────────────────────────────── */

export const HARNESS_OFFSET_MINUTES = 120;
export const HARNESS_TIME_ZONE = 'Europe/Paris';

/** 2026-06-10T08:00:00 à Paris (UTC+2, été, sans transition dans la fenêtre). */
export const NOW = Date.UTC(2026, 5, 10, 6, 0, 0);

/** Harnais prêt à l'emploi pour les cas d'usage. */
export interface TestHarness {
  readonly services: AppServices;
  readonly storage: MemoryStorage;
  readonly clock: FixedClock;
  readonly useCases: UseCases;
  readonly codec: ProgressCodec;
}

export interface HarnessOptions {
  readonly clockStart?: EpochMs;
  readonly offsetMinutes?: number;
  readonly timeZone?: string;
  /** Graine fixe : le tirage des plans et des quêtes devient prévisible. */
  readonly seed?: RandomSeed;
}

/** Monte services + cas d'usage sur des doubles mémoire, stockage **vide**. */
export function createHarness(options: HarnessOptions = {}): TestHarness {
  const clock = new FixedClock(
    options.clockStart ?? NOW,
    options.offsetMinutes ?? HARNESS_OFFSET_MINUTES,
    options.timeZone ?? HARNESS_TIME_ZONE,
  );
  const storage = new MemoryStorage();
  const codec = createStubProgressCodec();
  const services: AppServices = createAppServices({
    storage,
    clock,
    ids: createSequentialIds(),
    speech: silentSpeech,
    newSeed: createSeedFactory(options.seed),
  });
  const useCases = createUseCases(services, () => codec);
  return { services, storage, clock, useCases, codec };
}

/** Sérialise un état persisté dans le stockage mémoire du harnais. */
export function seedProgress(harness: TestHarness, progress: PersistedProgress): void {
  harness.storage.seedRaw('aron36.progress', harness.codec.encode(progress));
}

/** Progression de référence pour amorcer un harnais (36 cartes initiales). */
export function seedFreshProgress(
  harness: TestHarness,
  overrides: Partial<PersistedProgress> = {},
): PersistedProgress {
  const fresh = createInitialProgress(harness.services);
  const seeded = { ...fresh, ...overrides };
  seedProgress(harness, seeded);
  return seeded;
}
