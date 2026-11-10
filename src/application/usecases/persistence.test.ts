import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, STORAGE_KEY, MAX_REVIEW_LOG_ENTRIES } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { QUESTIONS_PER_ACT } from '@/domain/shared/types';
import {
  createAppServices,
  createInitialProgress,
  hydrate,
  APP_VERSION,
} from '@/application/bootstrap';
import {
  createHarness,
  seedFreshProgress,
  NOW,
  MemoryStorage,
  FixedClock,
  createSequentialIds,
  createSeedFactory,
  silentSpeech,
} from './test-doubles';

/**
 * Persistance : chaque réponse écrit l'état complet (`savedAt` tamponné par
 * l'horloge injectée) ; l'amorçage ne détruit jamais une donnée d'une version
 * future ou illisible.
 */

describe('persistance — chaque réponse écrit l\u2019état complet', () => {
  it('écrit cartes, journaux et XP dans le stockage après chaque réponse', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }
    harness.clock.advance(2_000);
    const output = harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId: item.id,
      grade: 'good',
      confidence: null,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });

    const raw = harness.storage.read(STORAGE_KEY);
    expect(raw.ok).toBe(true);
    const stored = JSON.parse(raw.ok ? (raw.value ?? '') : '') as PersistedProgress;
    expect(stored.schemaVersion).toBe(SCHEMA_VERSION);
    expect(stored.appVersion).toBe(APP_VERSION);
    // `savedAt` vient de l'horloge injectée, pas d'une horloge système.
    expect(stored.savedAt).toBe(harness.clock.now());
    expect(stored.savedAt).toBe(NOW + 2_000);
    expect(stored.reviewLogs).toHaveLength(1);
    expect(stored.reviewLogs[0]).toEqual(output.updatedProgress.reviewLogs[0]);
    expect(stored.cards[String(item.questionId)]?.reps).toBe(1);
    expect(stored.player.totalXp).toBe(output.xp.amount);
  });

  it('prouve le passage par IdPort : session, journal et profil séquentiels', () => {
    const harness = createHarness();
    // Premier lancement : le profil est créé par `createInitialProgress`.
    seedFreshProgress(harness);
    expect(harness.storage.read(STORAGE_KEY).value).toContain('"profile-1"');

    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
    // `sessionId` provient d'`IdPort.newSessionId()`.
    expect(started.plan.id).toBe('session-1');
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }
    const output = harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId: item.id,
      grade: 'good',
      confidence: null,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });
    // `id` du journal provient d'`IdPort.newReviewLogId()` — jamais de
    // `SessionAnswer.itemId`.
    expect(output.updatedProgress.reviewLogs[0]?.id).toBe('review-log-1');
    expect(output.updatedProgress.reviewLogs[0]?.id).not.toBe(item.id);
  });

  it('tronque les journaux de révision à la limite de persistance', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    // Remplit le journal au maximum puis ajoute une réponse.
    const seeded = seedFreshProgress(harness);
    const saturated: PersistedProgress = {
      ...seeded,
      reviewLogs: Array.from({ length: MAX_REVIEW_LOG_ENTRIES }, (_unused, index) => ({
        id: `log-${String(index)}`,
        sessionId: 'session-pleine',
        questionId: 1,
        direction: 'keyword-to-question' as const,
        exerciseKind: 'production' as const,
        grade: 'good' as const,
        reviewedAt: 0,
        previousDueAt: null,
        nextDueAt: 86_400_000,
        intervalDays: 1,
        elapsedDays: 0,
        responseTimeMs: 1_000,
        hintsUsed: 0,
        confidence: null,
      })),
    };
    harness.storage.seedRaw(STORAGE_KEY, harness.codec.encode(saturated));

    const started = harness.useCases.startSession.execute({
      mode: 'learning',
      questionIds: [2],
      maxItems: 1,
    });
    const item = started.plan.items[0];
    if (item === undefined) {
      throw new Error('item manquant');
    }
    harness.useCases.submitAnswer.execute({
      sessionId: started.plan.id,
      itemId: item.id,
      grade: 'good',
      confidence: null,
      responseTimeMs: 1_000,
      hintsUsed: 0,
      channel: 'written',
    });

    const stored = JSON.parse(
      harness.storage.read(STORAGE_KEY).ok ? (harness.storage.read(STORAGE_KEY).value ?? '') : '',
    ) as PersistedProgress;
    expect(stored.reviewLogs).toHaveLength(MAX_REVIEW_LOG_ENTRIES);
    expect(stored.reviewLogs.at(-1)?.id).toBe('review-log-1');
    expect(stored.reviewLogs[0]?.id).toBe('log-1');
  });
});

describe('hydrate — amorçage sans jamais détruire', () => {
  it('crée et persiste un profil neuf quand le stockage est vide', () => {
    const harness = createHarness();
    const result = hydrate(harness.services, () => harness.codec);

    expect(result.status).toBe('empty');
    expect(result.state.ready).toBe(true);
    expect(result.state.progress.player.profile.id).toBe('profile-1');
    expect(result.state.progress.player.settings.locale).toBe('fr');
    expect(Object.keys(result.state.progress.cards)).toHaveLength(QUESTIONS_PER_ACT * 3);
    // Le profil neuf est immédiatement persisté (le stockage était vide).
    const raw = harness.storage.read(STORAGE_KEY);
    expect(raw.ok && raw.value !== null).toBe(true);
    const stored = JSON.parse(raw.ok ? (raw.value ?? '') : '') as PersistedProgress;
    expect(stored.savedAt).toBe(NOW);
    expect(stored.player.profile.id).toBe('profile-1');
  });

  it('charge une progression existante telle quelle', () => {
    const harness = createHarness();
    const seeded = seedFreshProgress(harness);
    const result = hydrate(harness.services, () => harness.codec);

    expect(result.status).toBe('loaded');
    expect(result.state.progress).toEqual(seeded);
    expect(result.state.lastError).toBeNull();
  });

  it('préserve une donnée de version future sans rien écrire', () => {
    const harness = createHarness();
    const future = JSON.stringify({
      schemaVersion: SCHEMA_VERSION + 7,
      appVersion: '999.0.0',
      savedAt: NOW,
    });
    harness.storage.seedRaw(STORAGE_KEY, future);

    const result = hydrate(harness.services, () => harness.codec);

    expect(result.status).toBe('future-version');
    expect(result.state.lastError?.code).toBe('future-version');
    expect(result.state.progress.player.profile.id).not.toBe('');
    // La donnée source est intacte, octet pour octet.
    expect(harness.storage.read(STORAGE_KEY).value).toBe(future);
    // Aucune clé ajoutée (pas de sauvegarde, pas de réinitialisation).
    expect(harness.storage.keys().value).toEqual([STORAGE_KEY]);
  });

  it('signale une donnée illisible et n\u2019écrit rien', () => {
    const harness = createHarness();
    harness.storage.seedRaw(STORAGE_KEY, '{pas-du-json');

    const result = hydrate(harness.services, () => harness.codec);

    expect(result.status).toBe('corrupt');
    expect(result.state.lastError?.code).toBe('invalid-json');
    expect(harness.storage.read(STORAGE_KEY).value).toBe('{pas-du-json');
    expect(harness.storage.keys().value).toEqual([STORAGE_KEY]);
  });
});

describe('createInitialProgress — premier lancement', () => {
  it('prépare 36 cartes neuves, un profil identifié et le schéma courant', () => {
    const clock = new FixedClock(NOW);
    const storage = new MemoryStorage();
    const services = createAppServices({
      storage,
      clock,
      ids: createSequentialIds(),
      speech: silentSpeech,
      newSeed: createSeedFactory(),
    });

    const fresh = createInitialProgress(services, 'en');

    expect(fresh.schemaVersion).toBe(SCHEMA_VERSION);
    expect(fresh.appVersion).toBe(APP_VERSION);
    expect(fresh.savedAt).toBe(NOW);
    expect(fresh.player.profile.id).toBe('profile-1');
    expect(fresh.player.profile.createdAt).toBe(NOW);
    expect(fresh.player.settings.locale).toBe('en');
    expect(fresh.player.totalXp).toBe(0);
    expect(fresh.player.streak.current).toBe(0);
    expect(fresh.player.badges).toEqual([]);
    expect(fresh.player.collection.entries).toEqual([]);
    expect(Object.keys(fresh.cards)).toHaveLength(36);
    for (const card of Object.values(fresh.cards)) {
      expect(card.phase).toBe('new');
      expect(card.dueAt).toBe(NOW);
      expect(card.reps).toBe(0);
    }
    expect(fresh.hooks.hooks).toEqual([]);
    expect(fresh.reviewLogs).toEqual([]);
    expect(fresh.sessionLogs).toEqual([]);
  });

  it('reconnaît un harnais vide comme l\u2019état de départ des cas d\u2019usage', () => {
    const harness = createHarness();
    // Le dépôt interne des cas d'usage s'auto-initialise au premier accès.
    const started = harness.useCases.startSession.execute({ mode: 'learning', maxItems: 1 });
    expect(started.plan.items).toHaveLength(1);
    // Le premier lancement a persisté un profil neuf.
    expect(harness.storage.read(STORAGE_KEY).value).toContain('"profile-1"');
    void seedFreshProgress;
  });
});
