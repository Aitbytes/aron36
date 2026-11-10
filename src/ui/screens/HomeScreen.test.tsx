import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { progressCodec } from '@/application/progress';
import { buildFullProgress, REFERENCE_TIME } from '@/application/progress/testState';
import { makeDueCard, makeProgress } from '@/application/store/test-fixtures';
import {
  FixedClock,
  HARNESS_OFFSET_MINUTES,
  HARNESS_TIME_ZONE,
} from '@/application/usecases/test-doubles';
import type { QuestBoard } from '@/domain/gamification/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { createUiHarness, renderApp } from '@/test/uiHarness';

const clock = new FixedClock(REFERENCE_TIME, HARNESS_OFFSET_MINUTES, HARNESS_TIME_ZONE);
const TODAY = clock.dayKey(REFERENCE_TIME);

/**
 * Quêtes du jour, construites sur des identifiants du **catalogue réel**
 * (`QUEST_DEFINITIONS`) : la fixture de `progress/testState` porte des
 * identifiants hérités du prototype, inconnus du catalogue.
 */
function progressWithTodayQuests(): PersistedProgress {
  const base = buildFullProgress();
  const board: QuestBoard = {
    dayKey: TODAY,
    seed: 'ui-quest-seed',
    quests: [
      {
        questId: 'echauffement',
        dayKey: TODAY,
        progress: 4,
        target: 10,
        completedAt: null,
        attempts: 5,
        correct: 4,
        seenQuestionIds: [1, 5, 9],
      },
      {
        questId: 'revision-du-soir',
        dayKey: TODAY,
        progress: 3,
        target: 3,
        completedAt: REFERENCE_TIME - 3_600_000,
        attempts: 3,
        correct: 3,
        seenQuestionIds: [20, 21, 22],
      },
    ],
  };
  return { ...base, player: { ...base.player, questBoard: board } };
}

/** Douze cartes de l'acte I dues : le seul acte débloqué sur un profil neuf. */
function progressWithDueActOne(): PersistedProgress {
  const cards: Record<string, ReturnType<typeof makeDueCard>> = {};
  for (let questionId = 1; questionId <= 12; questionId += 1) {
    cards[String(questionId)] = makeDueCard(questionId, 0);
  }
  return makeProgress({ cards });
}

describe('écran d’accueil', () => {
  it('affiche la série, la XP et les cartes dues de l’état fixture', () => {
    renderApp(createUiHarness());

    expect(screen.getByRole('heading', { level: 1, name: 'Accueil' })).toBeInTheDocument();
    expect(screen.getAllByText('Série de 6 jours').length).toBeGreaterThan(0);
    expect(screen.getByText('Gels disponibles : 1')).toBeInTheDocument();
    expect(screen.getByText('3 cartes à réviser')).toBeInTheDocument();
    expect(screen.getAllByText('Niveau 5').length).toBeGreaterThan(0);
    expect(screen.getAllByText('240 / 500 XP dans ce niveau').length).toBeGreaterThan(0);
  });

  it('affiche les quêtes du jour persistées', () => {
    renderApp(createUiHarness({ progress: progressWithTodayQuests() }));

    expect(screen.getByRole('heading', { level: 2, name: 'Quêtes du jour' })).toBeInTheDocument();
    expect(screen.getByText('Échauffement')).toBeInTheDocument();
    expect(screen.getByText('4 / 10')).toBeInTheDocument();
    expect(screen.getByText('Révision du soir')).toBeInTheDocument();
    expect(screen.getByText('Terminée')).toBeInTheDocument();
  });

  it('démarre une session et navigue vers l’entraînement', async () => {
    const user = userEvent.setup();
    const harness = createUiHarness({ progress: progressWithDueActOne() });
    renderApp(harness);

    expect(screen.getByText('12 cartes à réviser')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Commencer la session' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Entraînement' })).toBeInTheDocument();
    expect(harness.store.getState().session?.plan.mode).toBe('review');
  });

  it('importe une sauvegarde et remplace la progression en place', async () => {
    const harness = createUiHarness({
      lastError: { code: 'invalid-json', message: 'illisible', details: null },
    });
    renderApp(harness);
    const imported = buildFullProgress();
    const withXp: PersistedProgress = {
      ...imported,
      player: { ...imported.player, totalXp: 9_999 },
    };
    const input = document.querySelector('input[type="file"]');
    if (input === null) {
      throw new Error('le champ d’import doit être présent dans le bandeau');
    }

    // `importProgress` attend une **enveloppe d'export**, pas le format interne.
    const envelope = JSON.stringify(progressCodec.toExport(withXp, REFERENCE_TIME));
    fireEvent.change(input, {
      target: { files: [new File([envelope], 'sauvegarde.json', { type: 'application/json' })] },
    });

    await waitFor(() => {
      expect(harness.store.getState().progress.player.totalXp).toBe(9_999);
    });
    expect(screen.queryByRole('heading', { level: 2, name: 'Progression protégée' })).toBeNull();
  });

  it('demande deux confirmations avant de réinitialiser la progression', async () => {
    const user = userEvent.setup();
    renderApp(
      createUiHarness({ lastError: { code: 'invalid-json', message: 'illisible', details: null } }),
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Progression protégée' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réinitialiser la progression' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmer la réinitialisation' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Progression protégée' })).toBeNull();
  });
});
