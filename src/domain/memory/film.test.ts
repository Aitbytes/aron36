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

  it('décrit chaque transition par une phrase de liaison, jamais un simple écho de l’image', () => {
    // Méthode des liens (L7) : un chaînon doit s’énoncer en une phrase. On
    // vérifie ici que chaque liaison est une vraie phrase (assez longue) et
    // qu’elle n’est pas une copie de l’image qu’elle relie.
    const wordCount = (text: string): number => text.trim().split(/\s+/u).length;
    for (const actId of ACT_IDS) {
      const film = filmForAct(actId);
      film.scenes.forEach((scene, index) => {
        if (index === film.scenes.length - 1) return;
        const transition = scene.transitionToNext;
        expect(transition).not.toBeNull();
        if (transition === null) return;
        expect(
          wordCount(transition.fr),
          `transition ${String(scene.order)}/${String(actId)}`,
        ).toBeGreaterThanOrEqual(5);
        expect(transition.fr.trim()).not.toBe(scene.image.fr.trim());
      });
    }
  });

  it('couvre les 12 questions de chaque acte, sans trou ni scène surnuméraire', () => {
    for (const actId of ACT_IDS) {
      const film = filmForAct(actId);
      const questionIds = getQuestionsByAct(QUESTION_CATALOG, actId).map((question) => question.id);
      const sceneIds = film.scenes.map((scene) => scene.questionId);
      expect([...sceneIds].sort((a, b) => a - b)).toEqual([...questionIds].sort((a, b) => a - b));
      expect(sceneIds).toHaveLength(QUESTIONS_PER_ACT);
    }
  });

  it('conserve le climax de l’acte III : l’incendie n’apparaît pas avant sa scène 9', () => {
    // L’acte doit s’ouvrir dans le calme et converger vers l’incendie ; ouvrir
    // sur les flammes dépenserait le climax d’avance.
    const fireTerms =
      /feu|flamme|br[ûu]l|incendie|braise|cendre|fum[ée]|ember|fire|flame|burn|ash|smoke/iu;
    const film = filmForAct(3);

    const mentionsFire = (sceneIndex: number): boolean => {
      const scene = film.scenes[sceneIndex];
      if (scene === undefined) return false;
      return (
        fireTerms.test(scene.image.fr) ||
        (scene.transitionToNext !== null && fireTerms.test(scene.transitionToNext.fr))
      );
    };

    const firstFireIndex = film.scenes.findIndex((_scene, index) => mentionsFire(index));
    // Index 0-based : la première mention est la scène 9 (transition incluse).
    expect(firstFireIndex).toBe(8);
    expect(mentionsFire(0)).toBe(false);
    expect(mentionsFire(7)).toBe(false);
    expect(mentionsFire(8)).toBe(true);
  });

  it('fournit 36 images mentales non vides, spécifiques et toutes distinctes', () => {
    const images = QUESTION_CATALOG.questions.map((question) => question.mentalImage.fr);
    expect(images).toHaveLength(36);

    for (const [index, image] of images.entries()) {
      expect(image.trim().length, `image de Q${String(index + 1)}`).toBeGreaterThanOrEqual(40);
      expect(
        image.trim().split(/\s+/u).length,
        `image de Q${String(index + 1)}`,
      ).toBeGreaterThanOrEqual(8);
    }

    const normalized = images.map((image) => image.trim().toLowerCase());
    expect(new Set(normalized).size).toBe(36);
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
