import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { createAppServices, hydrate } from '@/application/bootstrap';
import { createStore } from '@/application/store';
import { createUseCases } from '@/application/usecases';
import { createInfrastructure } from '@/infrastructure';
import { scheduleServiceWorkerRegistration } from '@/pwa';
import '@/styles/global.css';

/**
 * Composition racine — **aucune logique métier**.
 *
 * Ordre imposé : infrastructure → services applicatifs (domaine câblé) →
 * hydratation de la progression → store → cas d'usage → rendu. Si l'hydratation
 * détecte une donnée corrompue ou d'une version future, l'application démarre
 * quand même : l'état porte `lastError` et l'accueil affiche le bandeau de
 * récupération (rien n'est écrasé).
 */

const container = document.getElementById('root');

if (container === null) {
  throw new Error('Élément racine #root introuvable dans index.html');
}

/** Fuseau IANA de l'utilisateur ; `undefined` laisse l'horloge choisir. */
function resolveTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

const infrastructure = createInfrastructure({ timeZone: resolveTimeZone() });

const services = createAppServices({
  storage: infrastructure.storage,
  clock: infrastructure.clock,
  ids: infrastructure.ids,
  speech: infrastructure.speech,
  createRandom: infrastructure.createRandom,
  // Seule fabrique non déterministe de l'application : une graine opaque par
  // session, jamais utilisée ailleurs (le domaine reste pur).
  newSeed: () => crypto.randomUUID(),
});

const { state } = hydrate(services);
const store = createStore(state);
const useCases = createUseCases(services);

createRoot(container).render(
  <StrictMode>
    <App store={store} clock={infrastructure.clock} useCases={useCases} />
  </StrictMode>,
);

/**
 * Service worker : enregistré **après** le rendu, jamais avant.
 *
 * - en développement, aucun worker n'est généré (`sw.js` n'existe qu'après
 *   `npm run build`) : on n'enregistre rien, pour ne pas mettre en cache une
 *   arborescence servie par Vite ;
 * - en production, l'enregistrement est planifié au `load` puis en temps mort, et
 *   tout échec est silencieux : sans worker, l'application reste utilisable en
 *   ligne, simplement pas hors ligne.
 */
if (import.meta.env.PROD) {
  scheduleServiceWorkerRegistration();
}
