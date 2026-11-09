import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ACCURACY_CREDIT,
  CORRECT_GRADES,
  DRILL_DIRECTIONS,
  MASTERY_QUALITY_GRADES,
  NUMERIC_BOUNDS,
  QUESTION_COUNT,
  REVIEW_GRADES,
  SESSION_WINDOWS,
  SESSION_WINDOW_HOURS,
} from '@/domain/shared/types';
import {
  COLLECTION_ENTRY_MIN_INTERVAL_DAYS,
  COLLECTION_MASTERY_TIER_DAYS,
  COLLECTION_SIZE,
  DAILY_QUEST_COUNT,
  LEVEL_CURVE,
  STREAK_RULES,
  XP_RULES,
} from '@/domain/gamification/types';
import { DEFAULT_MASTERY_CRITERIA } from '@/domain/mastery/types';
import {
  MIGRATIONS,
  MAX_SUPPORTED_SCHEMA_VERSION,
  PROGRESS_RECOVERY_ACTIONS,
  SCHEMA_VERSION,
  STORAGE_KEY,
} from '@/domain/progress/types';
import type { ProgressErrorCode } from '@/domain/progress/types';
import * as srsTypes from '@/domain/srs/types';
import { DEFAULT_SCHEDULER_CONFIG } from '@/domain/srs/types';
import type { ExpectedAnswerForDirection, SessionItem } from '@/domain/session/types';

describe('contrats de la Phase 1', () => {
  it('fige les nombres du protocole et les cinq directions de drill', () => {
    expect(QUESTION_COUNT).toBe(36);
    expect(DRILL_DIRECTIONS).toHaveLength(5);
    expect(new Set(DRILL_DIRECTIONS).size).toBe(5);
    expect(REVIEW_GRADES).toEqual(['again', 'hard', 'good', 'easy']);
  });

  it('couvre chaque direction par un barème d’XP et interdit l’XP gratuite', () => {
    expect(Object.keys(XP_RULES.baseByDirection).sort()).toEqual([...DRILL_DIRECTIONS].sort());
    expect(XP_RULES.gradeMultiplier.again).toBe(0);
    expect(XP_RULES.discriminationFactor).toBeLessThanOrEqual(0.5);
  });

  it('fige la persistance versionnée et l’absence de migration à ce jour', () => {
    expect(STORAGE_KEY).toBe('aron36.progress');
    expect(SCHEMA_VERSION).toBe(1);
    expect(MIGRATIONS).toEqual([]);
  });

  it('fige les seuils pédagogiques structurants', () => {
    expect(DEFAULT_SCHEDULER_CONFIG.targetRetention).toBe(0.9);
    expect(DEFAULT_MASTERY_CRITERIA.minDistinctDirections).toBe(3);
    expect(DEFAULT_MASTERY_CRITERIA.actUnlockRatio).toBe(0.9);
    expect(COLLECTION_SIZE).toBe(QUESTION_COUNT);
    expect(DAILY_QUEST_COUNT).toBe(3);
    expect(LEVEL_CURVE.maxLevel).toBe(36);
    expect(STREAK_RULES.maxFreezes).toBe(2);
  });

  // ── Sémantique des notes : une seule définition de « correct » ──────────

  it('définit « correct » une seule fois et de façon cohérente', () => {
    // `correct` = tout sauf `again` ; `maîtrisé` = une barre plus stricte.
    expect([...CORRECT_GRADES]).toEqual(['hard', 'good', 'easy']);
    expect(CORRECT_GRADES).not.toContain('again');
    expect([...MASTERY_QUALITY_GRADES]).toEqual(['good', 'easy']);
    for (const grade of MASTERY_QUALITY_GRADES) {
      expect(CORRECT_GRADES).toContain(grade);
    }
    // Le crédit de précision est strictement décroissant de easy à again.
    expect(ACCURACY_CREDIT.again).toBe(0);
    expect(ACCURACY_CREDIT.easy).toBe(1);
    expect(ACCURACY_CREDIT.hard).toBeGreaterThan(0);
    expect(ACCURACY_CREDIT.hard).toBeLessThan(ACCURACY_CREDIT.good);
    // Le barème d'XP traite `again` comme une absence de production.
    expect(XP_RULES.gradeMultiplier.again).toBe(0);
  });

  // ── Direction ↔ indice : garanti par le compilateur (L16) ───────────────

  it('garantit au niveau du type l’appariement direction → indice', () => {
    expectTypeOf<
      Extract<SessionItem, { direction: 'image-to-question' }>['cue']['kind']
    >().toEqualTypeOf<'image'>();
    expectTypeOf<
      Extract<SessionItem, { direction: 'order-to-question' }>['cue']['kind']
    >().toEqualTypeOf<'order'>();
    expectTypeOf<
      Extract<SessionItem, { direction: 'question-to-number' }>['cue']['kind']
    >().toEqualTypeOf<'question'>();
    // Seule direction inversée : la réponse attendue est le numéro, pas le texte.
    expectTypeOf<
      ExpectedAnswerForDirection<'question-to-number'>['kind']
    >().toEqualTypeOf<'number'>();
    expectTypeOf<
      ExpectedAnswerForDirection<'keyword-to-question'>['kind']
    >().toEqualTypeOf<'question'>();
  });

  // ── Source unique des seuils de maîtrise ────────────────────────────────

  it('n’expose qu’une seule source de seuils de maîtrise', () => {
    // Aucune constante MASTERY_* ne doit subsister dans le module SRS.
    const srsMasteryExports = Object.keys(srsTypes).filter((key) => key.startsWith('MASTERY_'));
    expect(srsMasteryExports).toEqual([]);
    // Le seuil d’entrée en collection est aligné sur la maîtrise.
    expect(COLLECTION_ENTRY_MIN_INTERVAL_DAYS).toBe(DEFAULT_MASTERY_CRITERIA.minIntervalDays);
  });

  // ── Collection : tous les paliers sont atteignables ─────────────────────

  it('rend tous les paliers de collection atteignables', () => {
    expect(COLLECTION_MASTERY_TIER_DAYS).toHaveLength(5);
    expect(COLLECTION_MASTERY_TIER_DAYS[0]).toBe(COLLECTION_ENTRY_MIN_INTERVAL_DAYS);
    for (let i = 1; i < COLLECTION_MASTERY_TIER_DAYS.length; i += 1) {
      const previous = COLLECTION_MASTERY_TIER_DAYS[i - 1] ?? 0;
      const current = COLLECTION_MASTERY_TIER_DAYS[i] ?? 0;
      expect(current).toBeGreaterThan(previous);
    }
    // Le dernier palier ne doit pas dépasser l’intervalle maximal du SRS.
    expect(COLLECTION_MASTERY_TIER_DAYS.at(-1)).toBeLessThanOrEqual(
      DEFAULT_SCHEDULER_CONFIG.maxIntervalDays,
    );
  });

  // ── Persistance : versions et actions de récupération ───────────────────

  it('traite une version future comme non destructive', () => {
    expect(MAX_SUPPORTED_SCHEMA_VERSION).toBe(SCHEMA_VERSION);
    // Toute erreur connue a une action UI définie : aucune n’est oubliée.
    const codes: ProgressErrorCode[] = [
      'invalid-json',
      'invalid-shape',
      'unsupported-version',
      'missing-migration',
      'future-version',
      'read-failed',
      'write-failed',
      'quota-exceeded',
      'storage-unavailable',
    ];
    for (const code of codes) {
      expect(PROGRESS_RECOVERY_ACTIONS[code]).toBeTruthy();
    }
    // Une version future ne propose ni import ni réinitialisation.
    expect(PROGRESS_RECOVERY_ACTIONS['future-version']).toBe('ask-to-update-app');
  });

  // ── Unités et bornes (ADR 0009) ─────────────────────────────────────────

  it('fournit des bornes d’exécution pour les champs numériques', () => {
    expect(NUMERIC_BOUNDS.questionId).toEqual({ inclusiveMin: 1, inclusiveMax: 36 });
    expect(NUMERIC_BOUNDS.actId).toEqual({ inclusiveMin: 1, inclusiveMax: 3 });
    expect(NUMERIC_BOUNDS.positionInAct).toEqual({ inclusiveMin: 1, inclusiveMax: 12 });
    expect(NUMERIC_BOUNDS.difficulty).toEqual({ inclusiveMin: 1, inclusiveMax: 10 });
    expect(NUMERIC_BOUNDS.ratio).toEqual({ inclusiveMin: 0, inclusiveMax: 1 });
    expect(NUMERIC_BOUNDS.confidence).toEqual({ inclusiveMin: 1, inclusiveMax: 5 });
    // Les durées et intervalles sont positifs ou nuls, sans borne haute.
    expect(NUMERIC_BOUNDS.intervalDays.inclusiveMin).toBe(0);
    expect(NUMERIC_BOUNDS.durationMs.inclusiveMin).toBe(0);
  });

  it('définit quatre fenêtres de journée aux bornes croissantes (L17)', () => {
    expect([...SESSION_WINDOWS]).toEqual(['morning', 'day', 'evening', 'night']);
    const bounds = Object.values(SESSION_WINDOW_HOURS);
    for (let i = 1; i < bounds.length; i += 1) {
      expect(bounds[i]).toBeGreaterThan(bounds[i - 1] ?? 0);
    }
  });
});
