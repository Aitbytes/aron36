import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { UseCaseRejection } from './errors';
import { createHarness, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Import / export / réinitialisation (via le codec injecté) et évaluation de
 * la maîtrise : résultats explicites, jamais de destruction silencieuse.
 */

function readStored(harness: TestHarness): PersistedProgress {
  const raw = harness.storage.read(STORAGE_KEY);
  if (!raw.ok || raw.value === null) {
    throw new Error('progression absente du stockage');
  }
  return JSON.parse(raw.value) as PersistedProgress;
}

describe('export puis import — aller-retour de progression', () => {
  it('exporte une enveloppe puis réimporte exactement la progression', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    // Un peu d'activité : XP et journaux.
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 2 });
    for (let index = 0; index < 2; index += 1) {
      harness.useCases.submitAnswer.execute({
        sessionId: started.plan.id,
        itemId: `${started.plan.id}:${String(index)}`,
        grade: 'good',
        confidence: null,
        responseTimeMs: 1_000,
        hintsUsed: 0,
        channel: 'written',
      });
    }

    const exported = harness.useCases.exportProgress.execute();
    expect(exported.filename).toBe('aron36-progress-2026-06-10.json');
    const envelope = JSON.parse(exported.json) as {
      readonly format: string;
      readonly formatVersion: number;
      readonly progress: PersistedProgress;
    };
    expect(envelope.format).toBe('aron36-progress');
    expect(envelope.formatVersion).toBe(1);
    const beforeImport = readStored(harness);
    expect(envelope.progress.player.totalXp).toBe(beforeImport.player.totalXp);
    expect(envelope.progress.reviewLogs).toHaveLength(2);

    // Réinitialisation puis réimport : l'état revient.
    harness.useCases.resetProgress.execute();
    expect(readStored(harness).player.totalXp).toBe(0);
    const imported = harness.useCases.importProgress.execute({ raw: exported.json });
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.progress.player.totalXp).toBe(beforeImport.player.totalXp);
      expect(imported.progress.reviewLogs).toHaveLength(2);
      expect(imported.progress.schemaVersion).toBe(SCHEMA_VERSION);
    }
    expect(readStored(harness).player.totalXp).toBe(beforeImport.player.totalXp);
  });

  it('renvoie une erreur explicite pour un export illisible, sans rien changer', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const before = readStored(harness);

    const imported = harness.useCases.importProgress.execute({ raw: '}' });

    expect(imported.ok).toBe(false);
    if (!imported.ok) {
      expect(imported.error.code).toBe('invalid-json');
    }
    expect(readStored(harness)).toEqual(before);
  });
});

describe('resetProgress — reprise à zéro, jamais à l\u2019aveugle', () => {
  it('recrée un profil neuf en préservant la locale du joueur', () => {
    const harness = createHarness();
    const seeded = seedFreshProgress(harness);
    harness.storage.seedRaw(
      STORAGE_KEY,
      harness.codec.encode({
        ...seeded,
        player: {
          ...seeded.player,
          totalXp: 120,
          settings: { ...seeded.player.settings, locale: 'en' },
        },
      }),
    );

    const reset = harness.useCases.resetProgress.execute();

    expect(reset.progress.player.totalXp).toBe(0);
    expect(reset.progress.reviewLogs).toEqual([]);
    expect(reset.progress.sessionLogs).toEqual([]);
    expect(reset.progress.player.settings.locale).toBe('en');
    // Nouveau profil (l'ancien identifiant ne peut pas être réutilisé).
    expect(reset.progress.player.profile.id).toBe('profile-2');
    expect(readStored(harness).player.totalXp).toBe(0);
  });

  it('refuse la réinitialisation d\u2019une progression future (lecture seule)', () => {
    const harness = createHarness();
    harness.storage.seedRaw(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, appVersion: 'x', savedAt: 0 }),
    );
    expect(() => harness.useCases.resetProgress.execute()).toThrowError(UseCaseRejection);
    try {
      harness.useCases.resetProgress.execute();
    } catch (error) {
      expect((error as UseCaseRejection).reason).toBe('progress-protected');
    }
    // La donnée future est intacte.
    expect(harness.storage.read(STORAGE_KEY).value).toBe(
      JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, appVersion: 'x', savedAt: 0 }),
    );
  });

  it('refuse l\u2019import d\u2019une progression future (aucune écriture autorisée)', () => {
    const harness = createHarness();
    harness.storage.seedRaw(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, appVersion: 'x', savedAt: 0 }),
    );
    // Enveloppe d'export valide (version 1) construite à la main : l'import
    // reste refusé tant que la donnée locale est en version future.
    const envelope = JSON.stringify({
      format: 'aron36-progress',
      formatVersion: 1,
      exportedAt: '2026-06-10T06:00:00.000Z',
      progress: {
        schemaVersion: SCHEMA_VERSION,
        appVersion: '0.1.0',
        savedAt: 0,
        player: {
          profile: { id: 'importé', displayName: '', createdAt: 0 },
          totalXp: 5,
          streak: { current: 0, longest: 0, lastActiveDay: null, freezes: 0, frozenDays: [] },
          badges: [],
          questBoard: null,
          collection: { entries: [] },
          settings: {
            locale: 'fr',
            speechEnabled: true,
            reducedMotion: 'system',
            dailyGoalMinutes: 15,
            confidencePromptEnabled: true,
          },
        },
        cards: {},
        hooks: { hooks: [], updatedAt: 0 },
        reviewLogs: [],
        sessionLogs: [],
      },
    });
    expect(() => harness.useCases.importProgress.execute({ raw: envelope })).toThrowError(
      UseCaseRejection,
    );
    // Aucune écriture : la donnée future reste intacte.
    expect(harness.storage.read(STORAGE_KEY).value).toBe(
      JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, appVersion: 'x', savedAt: 0 }),
    );
  });

  it('sauvegarde la donnée corrompue avant un reset explicite', () => {
    const harness = createHarness();
    harness.storage.seedRaw(STORAGE_KEY, 'donnée-corrompue');

    harness.useCases.resetProgress.execute();

    // Une copie brute de la donnée corrompue existe, préfixée par le contrat.
    const keys = harness.storage.keys().value ?? [];
    const backup = keys.filter((key) => key.startsWith('aron36.progress.corrupt.'));
    expect(backup).toHaveLength(1);
    expect(harness.storage.read(backup[0] ?? '').value).toBe('donnée-corrompue');
    // Et la progression neuve a remplacé l'entrée principale.
    expect(readStored(harness).player.profile.id).toBe('profile-1');
  });
});

describe('evaluateMastery — photographie de la maîtrise', () => {
  it('renvoie un instantané neutre au premier lancement', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    const evaluated = harness.useCases.evaluateMastery.execute();

    expect(evaluated.mastery.acts).toHaveLength(3);
    expect(evaluated.mastery.totalMastered).toBe(0);
    expect(evaluated.mastery.overallRatio).toBe(0);
    expect(evaluated.mastery.nextActToUnlock).toBe(2);
    expect(evaluated.mastery.computedAt).toBe(harness.clock.now());
    // L'acte I est toujours débloqué, les suivants restent fermés.
    expect(evaluated.mastery.acts[0]?.unlocked).toBe(true);
    expect(evaluated.mastery.acts[1]?.unlocked).toBe(false);
  });
});
