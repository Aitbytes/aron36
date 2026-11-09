import { QUESTION_COUNT } from '@/domain/shared/types';
import type { Migration } from '@/domain/progress/types';
import type { ProgressError } from '@/domain/progress/types';
import type { CardState } from '@/domain/srs/types';

/**
 * Registre des migrations **applicatives** de la progression (ADR 0004).
 *
 * Chaque migration est **pure** : elle ne lit jamais le stockage, ne consulte
 * ni l'horloge ni l'environnement, et transforme une donnée d'entrée en donnée
 * de la version suivante. Un échec est signalé par une exception, que le
 * décodeur convertit en `missing-migration` ou `invalid-shape` — sans jamais
 * écrire quoi que ce soit.
 *
 * À distinguer de `MIGRATIONS` (vide) déclaré dans `src/domain/progress/types.ts`
 * par la Phase 1 : le registre **fonctionnel** vit ici, côté application, car
 * la migration v0 → v1 lit la forme du prototype (clés `LEGACY_V0_STORAGE_KEYS`),
 * qui n'est pas un `PersistedProgress`.
 */

/** Clés du prototype v0 : contenu de `aron36.srs`. */
export interface LegacyV0State {
  readonly cards: Readonly<Record<string, LegacyV0Card>>;
}

/** Carte v0 telle que désérialisée, avant validation des champs. */
interface RawLegacyCard {
  readonly box: unknown;
  readonly due: unknown;
}

/**
 * Intervalles (jours) associés aux boîtes de Leitner 1..5 du prototype.
 * Gelé : modifier cette table fausserait les re-imports v0 déjà réalisés.
 */
export const LEITNER_BOX_INTERVAL_DAYS: readonly number[] = [1, 2, 4, 8, 16];

/** difficulté neutre pour un état importé sans historique de difficulté. */
const NEUTRAL_DIFFICULTY = 5;

/** Clé décimale canonique du prototype (`"3"`, pas `"03"` ni `"3.0"`). */
const DECIMAL_KEY_PATTERN = /^[1-9]\d*$/;

/**
 * v0 → v1 : boîtes de Leitner 1..5 → intervalles `[1, 2, 4, 8, 16]` jours,
 * `phase = 'review'`, `dueAt` conservé. Les cases du plan 7 jours ne sont
 * **pas** importées (hors périmètre v1) ; le contenu de `aron36.plan` est
 * simplement ignoré par le chargeur.
 *
 * L'état produit est complet mais minimal : aucun historique (journaux,
 * accroches, XP) n'existait dans le prototype. `savedAt = 0` : une migration
 * ne consulte pas l'horloge — le chargeur l'estampe via `ClockPort`.
 */
export function migrateV0ToV1(input: unknown): unknown {
  const legacy = asLegacyState(input);
  const cards: Record<string, CardState> = {};
  for (const [key, legacyCard] of Object.entries(legacy.cards)) {
    const questionId = Number(key);
    if (!DECIMAL_KEY_PATTERN.test(key) || questionId < 1 || questionId > QUESTION_COUNT) {
      throw new Error(`carte v0 hors domaine : clé « ${key} »`);
    }
    if (
      typeof legacyCard.box !== 'number' ||
      !Number.isInteger(legacyCard.box) ||
      legacyCard.box < 1 ||
      legacyCard.box > LEITNER_BOX_INTERVAL_DAYS.length
    ) {
      throw new Error(
        `boîte de Leitner invalide pour la question ${key} : ${String(legacyCard.box)}`,
      );
    }
    if (
      typeof legacyCard.due !== 'number' ||
      !Number.isInteger(legacyCard.due) ||
      legacyCard.due < 0
    ) {
      throw new Error(`échéance v0 invalide pour la question ${key} : ${String(legacyCard.due)}`);
    }
    const intervalDays = LEITNER_BOX_INTERVAL_DAYS[legacyCard.box - 1] ?? 1;
    cards[key] = {
      questionId,
      phase: 'review',
      dueAt: legacyCard.due,
      intervalDays,
      stabilityDays: intervalDays,
      learningStep: 0,
      difficulty: NEUTRAL_DIFFICULTY,
      reps: 1,
      lapses: 0,
      consecutiveSuccesses: 0,
      lastReviewedAt: null,
      lastGrade: null,
    };
  }
  return {
    schemaVersion: 1,
    appVersion: '',
    savedAt: 0,
    player: {
      profile: { id: 'p_import-v0', displayName: '', createdAt: 0 },
      totalXp: 0,
      streak: { current: 0, longest: 0, lastActiveDay: null, freezes: 0, frozenDays: [] },
      badges: [],
      questBoard: null,
      collection: { entries: [] },
      settings: {
        locale: 'fr',
        speechEnabled: false,
        reducedMotion: 'system',
        dailyGoalMinutes: 15,
        confidencePromptEnabled: true,
      },
    },
    cards,
    hooks: { hooks: [], updatedAt: 0 },
    reviewLogs: [],
    sessionLogs: [],
  };
}

/** Registre ordonné des migrations ; la chaîne doit aller de 0 à la version courante. */
export const MIGRATIONS: readonly Migration[] = [
  {
    fromVersion: 0,
    toVersion: 1,
    description:
      'Import du prototype v0 (boîtes de Leitner) : box 1..5 → intervalles [1, 2, 4, 8, 16] jours, phase « review », dueAt conservé. Le plan 7 jours n’est pas importé.',
    migrate: migrateV0ToV1,
  },
];

/** Cherche la migration qui part exactement de `fromVersion`. */
export function findMigration(
  registry: readonly Migration[],
  fromVersion: number,
): Migration | null {
  return registry.find((migration) => migration.fromVersion === fromVersion) ?? null;
}

export type LegacyMigrationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ProgressError };

/** Carte du prototype v0, validée. */
export interface LegacyV0Card {
  readonly box: number;
  readonly due: number;
}

/**
 * Applique la migration du prototype v0 à une donnée brute déjà désérialisée.
 *
 * Renvoie un **document** (non encore validé) : la validation complète et la
 * normalisation relèvent du codec, que le chargeur appelle juste après. Cette
 * fonction n'écrit rien : un échec laisse les données d'origine intactes.
 */
export function migrateLegacyState(input: unknown): LegacyMigrationResult {
  const migration = findMigration(MIGRATIONS, 0);
  if (migration === null) {
    return {
      ok: false,
      error: {
        code: 'missing-migration',
        message: 'aucune migration du prototype v0 disponible',
        details: { fromVersion: '0' },
      },
    };
  }
  try {
    return { ok: true, value: migration.migrate(input) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'invalid-shape',
        message: `migration v0 → v1 impossible : ${error instanceof Error ? error.message : String(error)}`,
        details: { fromVersion: '0' },
      },
    };
  }
}

function asLegacyState(input: unknown): {
  readonly cards: Readonly<Record<string, RawLegacyCard>>;
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('état v0 illisible : racine non objet');
  }
  const cards = (input as { cards?: unknown }).cards;
  if (typeof cards !== 'object' || cards === null || Array.isArray(cards)) {
    throw new Error('état v0 illisible : « cards » absent ou non objet');
  }
  const normalized: Record<string, RawLegacyCard> = {};
  for (const [key, value] of Object.entries(cards)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`carte v0 illisible pour la clé « ${key} »`);
    }
    const entry = value as { box?: unknown; due?: unknown };
    normalized[key] = { box: entry.box, due: entry.due };
  }
  return { cards: normalized };
}
