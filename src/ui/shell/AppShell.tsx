import { useEffect } from 'react';

import { selectLevel, selectStreak } from '@/application/store';
import type { AppScreen } from '@/application/store';
import { useLocalizedText, useT } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { UpdateBanner } from '@/pwa';
import {
  CollectionScreen,
  GrandOralScreen,
  HomeScreen,
  ProgressScreen,
  SettingsScreen,
  StatsScreen,
  TrainScreen,
} from '@/ui/screens';
import { Chip, IconButton, VisuallyHidden } from '@/ui/primitives';
import { useActions, useAppState, useSelect } from '@/ui/store';

import styles from './AppShell.module.css';

/** Écrans de la navigation principale, dans l'ordre d'affichage. */
const NAV_ITEMS = [
  { screen: 'home', label: 'nav.home' },
  { screen: 'train', label: 'nav.train' },
  { screen: 'grand-oral', label: 'nav.grandOral' },
  { screen: 'collection', label: 'nav.collection' },
  { screen: 'stats', label: 'nav.stats' },
  { screen: 'settings', label: 'nav.settings' },
] as const satisfies readonly { readonly screen: AppScreen; readonly label: MessageKey }[];

/**
 * Coque de l'application : en-tête persistant, écran courant, navigation.
 *
 * Accessibilité :
 * - lien d'évitement (« Aller au contenu ») en première position du DOM ;
 * - `<header>`, `<main role="main">`, `<nav aria-label>` : points de repère ;
 * - `aria-current="page"` sur l'onglet actif, jamais la couleur seule ;
 * - navigation clavier complète (boutons natifs, ordre du DOM) ;
 * - `focus-visible` net (styles globaux + tokens).
 */
export function AppShell() {
  const t = useT();
  const localize = useLocalizedText();
  const state = useAppState();
  const actions = useActions();
  const level = useSelect(selectLevel);
  const streak = useSelect(selectStreak);
  const reducedMotion = state.progress.player.settings.reducedMotion;

  // Préférence de mouvement (L8/a11y) : reflétée sur `<html>` au démarrage et à
  // chaque changement, pour que `global.css` neutralise les transitions même
  // quand le système ne demande rien. La requête média reste prioritaire.
  useEffect(() => {
    document.documentElement.setAttribute('data-reduced-motion', reducedMotion);
  }, [reducedMotion]);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        {t('app.skipToContent')}
      </a>

      <header className={styles.header}>
        <div className={styles.identity}>
          <p className={styles.appName}>{t('app.name')}</p>
          <p className={styles.level}>{t('shell.level', { level: level.level })}</p>
        </div>
        <ul className={styles.stats}>
          <li>
            <Chip tone="accent">{localize(level.title)}</Chip>
          </li>
          <li>{t('shell.xpTotal', { xp: state.progress.player.totalXp })}</li>
          <li>{t('shell.streak', { count: streak.current })}</li>
        </ul>
        <div>
          <span aria-live="polite">
            {state.ui.busy ? <VisuallyHidden>{t('shell.busy')}</VisuallyHidden> : null}
          </span>
          <IconButton label={t('shell.openSettings')} onClick={() => actions.navigate('settings')}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <circle cx="12" cy="12" r="3.2" fill="currentColor" />
              <path
                d="M12 2.6v2.2M12 19.2v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </IconButton>
        </div>
      </header>

      {/*
        Mise à jour du service worker (Phase 5) — seule UI ajoutée pour la PWA.
        Elle ne rend rien tant qu'aucun nouveau worker n'attend (défaut = absent
        du DOM) et ne recharge jamais d'elle-même.
      */}
      <UpdateBanner />

      <div className={styles.body}>
        <main id="main-content" role="main" tabIndex={-1} className={styles.main}>
          <CurrentScreen
            screen={state.ui.screen}
            hasActiveSession={state.session !== null && state.session.phase !== 'completed'}
          />
        </main>

        <nav className={styles.nav} aria-label={t('nav.label')}>
          {NAV_ITEMS.map((item) => {
            const current = state.ui.screen === item.screen;
            return (
              <button
                key={item.screen}
                type="button"
                className={styles.navItem}
                aria-current={current ? 'page' : undefined}
                onClick={() => actions.navigate(item.screen)}
              >
                {t(item.label)}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

/**
 * Écran courant : le store est la seule source de navigation (aucun routeur).
 *
 * L'onglet « Entraînement » a deux visages : la carte de progression quand
 * aucune session n'est en cours, l'écran de jeu dès qu'une session est active.
 * C'est ce qui rend le parcours « choisir un acte → jouer → bilan » continu,
 * sans ajouter une entrée de navigation.
 */
function CurrentScreen({
  screen,
  hasActiveSession,
}: {
  readonly screen: AppScreen;
  readonly hasActiveSession: boolean;
}) {
  switch (screen) {
    case 'home':
      return <HomeScreen />;
    case 'train':
      return hasActiveSession ? <TrainScreen /> : <ProgressScreen />;
    case 'collection':
      return <CollectionScreen />;
    case 'stats':
      return <StatsScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'grand-oral':
      return <GrandOralScreen />;
  }
}
