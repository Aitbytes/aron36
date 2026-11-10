import type { MessageKey } from '../types';

/**
 * Catalogue anglais (seconde locale, ADR 0005).
 *
 * Typé `Record<MessageKey, string>` : il doit couvrir **exactement** les clés du
 * catalogue français. Une clé manquante ou surnuméraire casse `tsc`.
 */
export const enMessages: Record<MessageKey, string> = {
  // ── Application ─────────────────────────────────────────────────────────
  'app.name': 'Aron 36',
  'app.skipToContent': 'Skip to content',

  // ── Navigation ──────────────────────────────────────────────────────────
  'nav.label': 'Main navigation',
  'nav.home': 'Home',
  'nav.train': 'Training',
  'nav.collection': 'Collection',
  'nav.stats': 'Stats',
  'nav.settings': 'Settings',

  // ── Shell (header, levels, streaks) ─────────────────────────────────────
  'shell.level': 'Level {level}',
  'shell.xpTotal': 'Total XP: {xp}',
  'shell.xpInLevel': '{current} / {span} XP in this level',
  'shell.maxLevel': 'Maximum level reached',
  'shell.streak': '{count}-day streak',
  'shell.streak_one': '{count}-day streak',
  'shell.streak_other': '{count}-day streak',
  'shell.freezes': 'Freezes available: {count}',
  'shell.openSettings': 'Open settings',
  'shell.loading': 'Loading your progress…',
  'shell.busy': 'Operation in progress',

  // ── Home ────────────────────────────────────────────────────────────────
  'home.title': 'Home',
  'home.heroTitle': 'Today’s training',
  'home.heroLead': 'Active recall only: nothing to reread before producing.',
  'home.startSession': 'Start session',
  'home.dueCount': '{count} cards to review',
  'home.dueCount_one': '{count} card to review',
  'home.dueCount_other': '{count} cards to review',
  'home.dueNone': 'No card is due: a learning session is offered instead.',
  'home.questsTitle': 'Daily quests',
  'home.questsEmpty': 'Daily quests appear after your first answer of the day.',
  'home.questProgress': '{current} / {target}',
  'home.questDone': 'Completed',
  'home.nextActTitle': 'Next act to unlock',
  'home.nextActAllUnlocked': 'All three acts are unlocked.',
  'home.nextActRequirement': '{act} unlocks when {previous} reaches {ratio}% mastery.',
  'home.nextActProgress': '{mastered} / {total} questions mastered',
  'home.progressTitle': 'Level progress',
  'home.actLabel': 'Act {act}',

  // ── Data recovery ───────────────────────────────────────────────────────
  'recovery.title': 'Progress protected',
  'recovery.protected': 'Your data has not been overwritten: nothing was written.',
  'recovery.updateApp':
    'This progress was written by a newer version of the app. Update the app, then reload the page.',
  'recovery.retryLater':
    'Local storage is temporarily unavailable. Your data is safe: try again later.',
  'recovery.rescue': 'You can import a JSON backup or start from a fresh profile.',
  'recovery.import': 'Import a backup',
  'recovery.reset': 'Reset progress',
  'recovery.resetTitle': 'Reset progress?',
  'recovery.resetBody':
    'All local progress will be replaced by a fresh profile. This action is final.',
  'recovery.resetContinue': 'Continue',
  'recovery.resetSecondStep': 'Final confirmation: the current data will be permanently lost.',
  'recovery.resetConfirm': 'Confirm reset',
  'recovery.cancel': 'Cancel',
  'recovery.close': 'Close',
  'recovery.details': 'Technical detail: {code}',
  'recovery.code.invalidJson': 'The stored content is not valid JSON.',
  'recovery.code.invalidShape': 'The stored content does not match the expected format.',
  'recovery.code.unsupportedVersion': 'The stored format is too old for this version.',
  'recovery.code.missingMigration': 'A migration is missing to read this version.',
  'recovery.code.futureVersion': 'The stored format comes from a newer version.',
  'recovery.code.readFailed': 'Reading local storage failed.',
  'recovery.code.writeFailed': 'Writing to local storage failed.',
  'recovery.code.quotaExceeded': 'Local storage is full.',
  'recovery.code.storageUnavailable': 'Local storage is unavailable.',

  // ── Actions and failures ────────────────────────────────────────────────
  'action.failure.unknown': 'This action is not possible right now.',
  'action.failure.unknownSession': 'No active session for this action.',
  'action.failure.transitionRefused': 'This transition is not possible right now.',
  'action.failure.submissionRefused': 'The answer was refused by the session engine.',
  'action.failure.buildRefused': 'No session can be built with these criteria.',
  'action.failure.hookRefused': 'This hook cannot be saved.',
  'action.failure.hintUnavailable': 'No hint is available for this item.',
  'action.failure.progressUnavailable': 'Progress is unavailable: use data recovery first.',
  'action.failure.progressProtected': 'Progress from a newer version: no write is authorised.',
  'action.failure.importFailed': 'The backup file cannot be read.',
  'action.failure.exportFailed': 'Exporting the backup failed.',
  'action.failure.resetFailed': 'The reset failed.',

  // ── Notifications ───────────────────────────────────────────────────────
  'toast.regionLabel': 'Notifications',
  'toast.dismiss': 'Dismiss notification',
  'toast.writeFailed.title': 'Saving failed',
  'toast.writeFailed.body':
    'Your progress stays valid for this session (code {code}). Consider exporting a backup.',
  'toast.importDone.title': 'Backup imported',
  'toast.importDone.body': 'Your progress has been replaced by the backup.',
  'toast.importFailed.title': 'Import failed',
  'toast.importFailed.body': 'The selected file could not be read (code {code}).',
  'toast.resetDone.title': 'Progress reset',
  'toast.resetDone.body': 'A fresh profile was created.',

  // ── Screens (honest shells) ─────────────────────────────────────────────
  'screen.underConstruction': 'Under construction',
  'screen.comingSoon': 'This screen arrives in a later batch.',
  'train.title': 'Training',
  'train.description':
    'The game screen will live here: five drill directions, progressive hints, confidence rating and corrective feedback.',
  'collection.title': 'Collection',
  'collection.description': 'The 36 collection cards will be shown here with their mastery tier.',
  'stats.title': 'Stats',
  'stats.description':
    'Derived metrics (accuracy per direction, calibration, sessions) will be shown here.',
  'settings.title': 'Settings',
  'settings.description':
    'Language, speech synthesis, daily goal and reduced motion are configured here.',

  // ── Primitives ──────────────────────────────────────────────────────────
  'primitive.spinner.label': 'Loading',
};
