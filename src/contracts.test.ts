import { describe, expect, it } from 'vitest';

import { DRILL_DIRECTIONS, QUESTION_COUNT, REVIEW_GRADES } from '@/domain/shared/types';
import {
  COLLECTION_SIZE,
  DAILY_QUEST_COUNT,
  LEVEL_CURVE,
  STREAK_RULES,
  XP_RULES,
} from '@/domain/gamification/types';
import { DEFAULT_MASTERY_CRITERIA } from '@/domain/mastery/types';
import { MIGRATIONS, SCHEMA_VERSION, STORAGE_KEY } from '@/domain/progress/types';
import { DEFAULT_SCHEDULER_CONFIG } from '@/domain/srs/types';

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
});
