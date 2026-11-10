import { describe, expect, it } from 'vitest';

import { createTranslator, enMessages, frMessages, pickLocalized } from '@/i18n';

describe('i18n — catalogues typés', () => {
  it('le catalogue anglais couvre exactement les clés du français', () => {
    expect(Object.keys(enMessages).sort()).toEqual(Object.keys(frMessages).sort());
  });

  it('interpole les paramètres nommés et formate les nombres', () => {
    const t = createTranslator('fr');

    expect(t('shell.level', { level: 12 })).toBe('Niveau 12');
    expect(t('shell.streak', { count: 4 })).toBe('Série de 4 jours');
  });

  it('choisit la forme plurielle selon count', () => {
    const t = createTranslator('fr');

    expect(t('home.dueCount', { count: 0 })).toBe('0 carte à réviser');
    expect(t('home.dueCount', { count: 1 })).toBe('1 carte à réviser');
    expect(t('home.dueCount', { count: 3 })).toBe('3 cartes à réviser');
  });

  it('replie un texte localisé anglais absent sur le français', () => {
    expect(pickLocalized({ fr: 'français', en: 'english' }, 'en')).toBe('english');
    expect(pickLocalized({ fr: 'français' }, 'en')).toBe('français');
    expect(pickLocalized({ fr: 'français', en: 'english' }, 'fr')).toBe('français');
  });
});
