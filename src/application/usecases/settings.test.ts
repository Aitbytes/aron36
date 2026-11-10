import { describe, expect, it } from 'vitest';

import { STORAGE_KEY } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { hydrate } from '@/application/bootstrap';
import { createHarness, seedFreshProgress } from './test-doubles';
import type { TestHarness } from './test-doubles';

/**
 * Réglages persistés (`updateSettings`, correctif revue Phase 3) : un réglage
 * modifié survit à un rechargement. Auparavant `settings/updated` mutait
 * `progress.player.settings` dans le store **sans écriture** : au prochain
 * lancement, tout revenait (locale comprise).
 */

function readStored(harness: TestHarness): PersistedProgress {
  const raw = harness.storage.read(STORAGE_KEY);
  if (!raw.ok || raw.value === null) {
    throw new Error('progression absente du stockage');
  }
  return JSON.parse(raw.value) as PersistedProgress;
}

describe('updateSettings — aller-retour de persistance', () => {
  it('persiste les réglages puis les retrouve au rechargement (hydrate)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    const updated = harness.useCases.updateSettings.execute({
      settings: { locale: 'en', dailyGoalMinutes: 25, speechEnabled: false },
    });

    expect(updated.writeFailure).toBeNull();
    expect(updated.progress.player.settings.locale).toBe('en');
    expect(updated.progress.player.settings.dailyGoalMinutes).toBe(25);
    // Le stockage reflète immédiatement le changement.
    const stored = readStored(harness);
    expect(stored.player.settings.locale).toBe('en');
    expect(stored.player.settings.dailyGoalMinutes).toBe(25);

    // Rechargement complet : la valeur est conservée, pas seulement en mémoire.
    const reloaded = hydrate(harness.services, () => harness.codec);
    expect(reloaded.status).toBe('loaded');
    expect(reloaded.state.progress.player.settings.locale).toBe('en');
    expect(reloaded.state.progress.player.settings.dailyGoalMinutes).toBe(25);
    expect(reloaded.state.progress.player.settings.speechEnabled).toBe(false);
  });

  it('fusion partielle : les champs absents du patch gardent leur valeur', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    harness.useCases.updateSettings.execute({ settings: { dailyGoalMinutes: 20 } });
    const second = harness.useCases.updateSettings.execute({ settings: { locale: 'en' } });

    expect(second.progress.player.settings).toEqual({
      locale: 'en',
      speechEnabled: true,
      reducedMotion: 'system',
      dailyGoalMinutes: 20,
      confidencePromptEnabled: true,
    });
  });

  it('ne touche ni à la progression du joueur ni aux cartes', () => {
    const harness = createHarness();
    const seeded = seedFreshProgress(harness);
    harness.storage.seedRaw(
      STORAGE_KEY,
      harness.codec.encode({
        ...seeded,
        player: { ...seeded.player, totalXp: 77 },
      }),
    );

    const updated = harness.useCases.updateSettings.execute({ settings: { locale: 'en' } });

    expect(updated.progress.player.totalXp).toBe(77);
    expect(updated.progress.cards).toEqual(readStored(harness).cards);
  });
});
