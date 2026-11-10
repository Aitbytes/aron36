import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { REFERENCE_TIME } from '@/application/progress/testState';
import { makePlayer, makeProgress } from '@/application/store/test-fixtures';
import { actOfQuestion, rarityForAct } from '@/domain/gamification';
import type { CollectionEntry } from '@/domain/gamification/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { QUESTION_CATALOG } from '@/domain/questions';
import { TestProviders, createUiHarness } from '@/test/uiHarness';
import { CollectionScreen } from '@/ui/screens/CollectionScreen';

function entryFor(questionId: number, masteryTier: 1 | 2 | 3 | 4 | 5): CollectionEntry {
  return {
    questionId,
    rarity: rarityForAct(actOfQuestion(questionId)),
    obtainedAt: REFERENCE_TIME - questionId * 3_600_000,
    masteryTier,
  };
}

function renderCollection(progress: PersistedProgress) {
  const harness = createUiHarness({ progress });
  render(
    <TestProviders harness={harness}>
      <CollectionScreen />
    </TestProviders>,
  );
  return { harness };
}

describe('album de collection', () => {
  it('affiche un état vide explicite quand aucune carte n’est obtenue', () => {
    renderCollection(makeProgress());

    expect(
      screen.getByText('Aucune carte pour l’instant — réponds juste une fois, puis maîtrise.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 / 36 cartes')).toBeInTheDocument();

    const lockedQuestion = QUESTION_CATALOG.byId.get(1);
    if (lockedQuestion === undefined) {
      throw new Error('la question 1 doit exister');
    }
    expect(screen.queryByText(lockedQuestion.prompt.fr)).toBeNull();
  });

  it('affiche 36 cartes et un compteur correct pour une collection complète', () => {
    const entries: CollectionEntry[] = [];
    for (let questionId = 1; questionId <= 36; questionId += 1) {
      entries.push(entryFor(questionId, ((questionId % 5) + 1) as 1 | 2 | 3 | 4 | 5));
    }
    renderCollection(makeProgress({ player: makePlayer({ collection: { entries } }) }));

    expect(screen.getByText('36 / 36 cartes')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Carte /u })).toHaveLength(36);
    expect(screen.getByText('Acte 1 : 12 / 12')).toBeInTheDocument();
    expect(screen.getByText('Acte 2 : 12 / 12')).toBeInTheDocument();
    expect(screen.getByText('Acte 3 : 12 / 12')).toBeInTheDocument();
  });

  it('ne révèle ni le texte ni l’image d’une carte verrouillée', () => {
    renderCollection(
      makeProgress({
        player: makePlayer({ collection: { entries: [entryFor(1, 2)] } }),
      }),
    );

    const locked = QUESTION_CATALOG.byId.get(2);
    if (locked === undefined) {
      throw new Error('la question 2 doit exister');
    }
    expect(screen.queryByText(locked.prompt.fr)).toBeNull();
    expect(screen.queryByText(locked.mentalImage.fr)).toBeNull();
    expect(screen.getAllByText('À découvrir').length).toBeGreaterThan(0);
  });

  it('ouvre le détail d’une carte obtenue avec sa question et son image', async () => {
    const user = userEvent.setup();
    renderCollection(
      makeProgress({
        player: makePlayer({ collection: { entries: [entryFor(5, 3)] } }),
      }),
    );
    const question = QUESTION_CATALOG.byId.get(5);
    if (question === undefined) {
      throw new Error('la question 5 doit exister');
    }

    await user.click(screen.getByRole('button', { name: /^Carte 5 /u }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(question.prompt.fr)).toBeInTheDocument();
    expect(within(dialog).getByText(question.mentalImage.fr)).toBeInTheDocument();
    expect(within(dialog).getAllByText('Commune').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Palier 3').length).toBeGreaterThan(0);
  });
});
