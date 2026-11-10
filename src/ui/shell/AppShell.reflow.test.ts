import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createUiHarness, renderApp } from '@/test/uiHarness';

import css from './AppShell.module.css?raw';

/**
 * Preuve du reflow mobile (correctif revue Phase 4, bloquant).
 *
 * jsdom n'implémente pas la mise en page : `scrollWidth` y vaut toujours
 * `clientWidth`, une sonde de rendu ne prouverait donc rien. On vérifie à la
 * place les **règles CSS critiques** du reflow, lues sur le fichier source :
 * c'est la géométrie réelle (bordures de boîte, contraintes de piste) qui
 * garantit qu'aucun élément ne pousse la page au-delà du viewport.
 *
 * La cible est atteinte quand, sous 60 rem :
 * - la coque borne sa largeur (`max-inline-size`) au lieu d'une largeur fixe ;
 * - la colonne de contenu peut se réduire (`minmax(0, 1fr)` + `min-inline-size: 0`) ;
 * - la navigation devient une rangée scrollable (`overflow-x: auto`) avec
 *   `scroll-snap`, et ses onglets ne se tronquent plus (`white-space: nowrap`).
 */
/** Bloc `@media (min-width: 60rem)` complet (jusqu'à l'accolade fermante). */
function mediaBlock(): string {
  const start = css.indexOf('@media (min-width: 60rem)');
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let started = false;
  for (let index = start; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') {
      depth += 1;
      started = true;
    } else if (char === '}') {
      depth -= 1;
      if (started && depth === 0) {
        return css.slice(start, index + 1);
      }
    }
  }
  throw new Error('bloc @media introuvable');
}

/** CSS de base : tout sauf le bloc `@media (min-width: 60rem)`. */
const baseCss = css.replace(mediaBlock(), '');

/** Corps d'une règle simple `.classe { ... }` du CSS de base. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'u').exec(baseCss);
  expect(match, `règle ${selector} absente`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('reflow de la coque — aucune largeur au-delà du viewport (≤ 414 px)', () => {
  it('la coque borne sa largeur sans largeur fixe', () => {
    const shell = ruleBody('.shell');
    expect(shell).toContain('max-inline-size: 64rem');
    expect(shell).toContain('inline-size: 100%');
    expect(shell).not.toContain('inline-size: min');
  });

  it('la colonne de contenu peut se réduire (pas de débordement de piste)', () => {
    expect(ruleBody('.body')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(ruleBody('.body')).toContain('min-inline-size: 0');
    expect(ruleBody('.main')).toContain('min-inline-size: 0');
  });

  it('la navigation sous 60 rem est une rangée scrollable à accroche', () => {
    const nav = ruleBody('.nav');
    expect(nav).toContain('grid-auto-flow: column');
    expect(nav).toContain('grid-auto-columns: max-content');
    expect(nav).toContain('overflow-x: auto');
    expect(nav).toContain('scroll-snap-type: inline proximity');
    expect(nav).toContain('max-inline-size: 100%');
    expect(nav).toContain('min-inline-size: 0');

    const item = ruleBody('.navItem');
    expect(item).toContain('white-space: nowrap');
    expect(item).toContain('scroll-snap-align: center');
  });

  it('au-delà de 60 rem, la navigation redevient une barre latérale', () => {
    const media = mediaBlock();
    expect(media).toContain('grid-auto-flow: row');
    expect(media).toContain('grid-template-columns: 15rem minmax(0, 1fr)');
  });

  it('monte la coque et confirme les cinq onglets dans une seule navigation', () => {
    renderApp(createUiHarness());

    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(nav).toBeInTheDocument();
    expect(nav.querySelectorAll('button')).toHaveLength(5);
    expect(nav.className).not.toBe('');
  });
});
