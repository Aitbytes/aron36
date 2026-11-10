import { describe, expect, it } from 'vitest';

import buttonCss from '../ui/primitives/Button.module.css?raw';
import collectionCss from '../ui/screens/CollectionScreen.module.css?raw';
import progressCss from '../ui/screens/ProgressScreen.module.css?raw';
import settingsCss from '../ui/screens/SettingsScreen.module.css?raw';
import trainCss from '../ui/screens/TrainScreen.module.css?raw';

import tokensCss from './tokens.css?raw';

/**
 * Contraste des bordures de contrôle (WCAG 2.2 — 1.4.11).
 *
 * `--color-border` (1,25:1 sur `--color-surface`) reste réservé aux séparateurs
 * et conteneurs décoratifs. Tout contrôle dont la frontière n'est portée **que**
 * par sa bordure (bouton secondaire transparent, champs de saisie, nœuds/cartes
 * interactifs) doit utiliser `--color-border-strong`, ≥ 3:1 sur les trois fonds.
 *
 * jsdom ne calcule pas la cascade : la preuve est faite ici, de façon
 * déterministe, en parsant les valeurs réelles des tokens et des CSS Modules.
 */

/** Valeur hexadécimale d'un token de `tokens.css`. */
function token(name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`, 'u').exec(tokensCss);
  expect(match, `token ${name} introuvable`).not.toBeNull();
  return match?.[1] ?? '#000000';
}

/** Composante linéaire sRGB d'un canal 0..255 (formule WCAG). */
function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG d'une couleur hexadécimale. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const red = channel(Number.parseInt(value.slice(0, 2), 16));
  const green = channel(Number.parseInt(value.slice(2, 4), 16));
  const blue = channel(Number.parseInt(value.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Rapport de contraste WCAG entre deux couleurs. */
function contrast(left: string, right: string): number {
  const first = luminance(left);
  const second = luminance(right);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('tokens — bordures de contrôle (WCAG 1.4.11)', () => {
  it('--color-border-strong atteint 3:1 sur les trois fonds', () => {
    const strong = token('--color-border-strong');
    for (const surface of ['--color-bg', '--color-surface', '--color-surface-raised']) {
      expect(contrast(strong, token(surface))).toBeGreaterThanOrEqual(3);
    }
  });

  it('--color-border reste décoratif (sous 3:1) et n’est pas utilisé seul', () => {
    const decorative = token('--color-border');
    expect(contrast(decorative, token('--color-surface'))).toBeLessThan(3);
  });

  it('les contrôles bornés par leur seule bordure utilisent la bordure forte', () => {
    expect(buttonCss).toContain('border-color: var(--color-border-strong)');
    expect(trainCss).toContain('var(--color-border-strong)');
    expect(settingsCss).toContain('var(--color-border-strong)');
    expect(collectionCss).toContain('var(--color-border-strong)');
    expect(progressCss).toContain('var(--color-border-strong)');
  });
});
