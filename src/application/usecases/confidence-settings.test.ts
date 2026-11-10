import { describe, expect, it } from 'vitest';

import { createHarness, seedFreshProgress } from './test-doubles';

/**
 * `confidencePromptEnabled` n'est plus inerte (correctif revue Phase 4).
 *
 * Coché (défaut), les défauts du mode s'appliquent : `review` et `grand-oral`
 * exigent un jugement de confiance avant révélation (L12), `learning` non.
 * Décoché, le jugement est retiré **partout** — c'est l'effet observable du
 * réglage, sans casser le contrat « learning sans contrainte » déjà vérifié par
 * `session-flow.test.ts`.
 */
describe('confidencePromptEnabled — effet réel sur le plan de session', () => {
  it('coché : défauts du mode (review exige, learning non)', () => {
    const harness = createHarness();
    seedFreshProgress(harness);

    const review = harness.useCases.startSession.execute({ mode: 'review' });
    expect(review.plan.config.requiresConfidence).toBe(true);

    const learning = harness.useCases.startSession.execute({ mode: 'learning' });
    expect(learning.plan.config.requiresConfidence).toBe(false);
  });

  it('décoché : plus aucune session n’exige de jugement de confiance', () => {
    const harness = createHarness();
    seedFreshProgress(harness);
    harness.useCases.updateSettings.execute({ settings: { confidencePromptEnabled: false } });

    const review = harness.useCases.startSession.execute({ mode: 'review' });
    expect(review.plan.config.requiresConfidence).toBe(false);

    const grandOral = harness.useCases.startSession.execute({
      mode: 'grand-oral',
      maxItems: 1,
    });
    expect(grandOral.plan.config.requiresConfidence).toBe(false);
  });
});
