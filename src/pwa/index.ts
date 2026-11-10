/**
 * PWA (Phase 5) : enregistrement du service worker, état de mise à jour et
 * bannière associée. Aucune dépendance au store : ce module ne connaît que le
 * navigateur, et `UpdateBanner` que le traducteur.
 */
export { registerServiceWorker, scheduleServiceWorkerRegistration } from './registerServiceWorker';
export type { RegisterServiceWorkerOptions } from './registerServiceWorker';
export { createSwUpdateSignal, swUpdate, SKIP_WAITING } from './updateSignal';
export type { SwUpdateSignal, SwUpdateSignalControl } from './updateSignal';
export { UpdateBanner } from './UpdateBanner';
export type { UpdateBannerProps } from './UpdateBanner';
