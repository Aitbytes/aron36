import { describe, expect, it } from 'vitest';

import { QUESTION_CATALOG, getQuestionsByAct } from '@/domain/questions';
import { ACT_IDS, QUESTIONS_PER_ACT } from '@/domain/shared/types';

import { MENTAL_FILMS, filmForAct, filmSceneFor } from './films';

describe('films mentaux (L6, L7)', () => {
  it('fournit exactement un film par acte, titré et pitché en français et en anglais', () => {
    expect(MENTAL_FILMS).toHaveLength(ACT_IDS.length);
    expect(MENTAL_FILMS.map((film) => film.actId)).toEqual([...ACT_IDS]);

    for (const film of MENTAL_FILMS) {
      expect(film.title.fr.trim().length).toBeGreaterThan(0);
      expect(film.title.en?.trim().length ?? 0).toBeGreaterThan(0);
      expect(film.pitch.fr.trim().length).toBeGreaterThan(0);
      expect(film.pitch.en?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('contient 12 scènes ordonnées 1..12 dans chaque acte', () => {
    for (const actId of ACT_IDS) {
      const film = filmForAct(actId);
      expect(film.scenes).toHaveLength(QUESTIONS_PER_ACT);
      film.scenes.forEach((scene, index) => {
        expect(scene.order).toBe(index + 1);
        expect(scene.image.fr.trim().length).toBeGreaterThan(0);
        expect(scene.image.en?.trim().length ?? 0).toBeGreaterThan(0);
      });
    }
  });

  it('illustre chaque question de l’acte, dans l’ordre des positions, sans doublon', () => {
    for (const actId of ACT_IDS) {
      const film = filmForAct(actId);
      const questions = getQuestionsByAct(QUESTION_CATALOG, actId);
      expect(questions).toHaveLength(QUESTIONS_PER_ACT);

      const sceneIds = film.scenes.map((scene) => scene.questionId);
      expect(new Set(sceneIds).size).toBe(QUESTIONS_PER_ACT);

      for (const question of questions) {
        const scene = film.scenes.find((candidate) => candidate.questionId === question.id);
        expect(scene).toBeDefined();
        expect(scene?.order).toBe(question.positionInAct);
      }
    }
  });

  it('chaîne les scènes : transition non nulle sauf la dernière', () => {
    for (const actId of ACT_IDS) {
      const film = filmForAct(actId);
      film.scenes.forEach((scene, index) => {
        const isLast = index === film.scenes.length - 1;
        if (isLast) {
          expect(scene.transitionToNext).toBeNull();
          return;
        }
        expect(scene.transitionToNext).not.toBeNull();
        expect(scene.transitionToNext?.fr.trim().length ?? 0).toBeGreaterThan(0);
        expect(scene.transitionToNext?.en?.trim().length ?? 0).toBeGreaterThan(0);
      });
    }
  });

  it('partage la même image que l’image mentale de la question (aucune dérive)', () => {
    for (const question of QUESTION_CATALOG.questions) {
      const scene = filmSceneFor(question.actId, question.positionInAct);
      expect(scene?.questionId).toBe(question.id);
      expect(scene?.image).toEqual(question.mentalImage);
    }
  });

  it('filmSceneFor est total sur 1..12 et renvoie undefined hors bornes', () => {
    for (const actId of ACT_IDS) {
      expect(filmSceneFor(actId, 1)?.order).toBe(1);
      expect(filmSceneFor(actId, 12)?.order).toBe(12);
      expect(filmSceneFor(actId, 0)).toBeUndefined();
      expect(filmSceneFor(actId, 13)).toBeUndefined();
    }
  });
});
