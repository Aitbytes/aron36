import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import type { PlayerSettings } from '@/domain/gamification/types';
import type { LocaleCode } from '@/domain/shared/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { useLocale, useT } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { Button, Dialog, Inline, Panel, Stack, useToast } from '@/ui/primitives';
import { ACTION_FAILURE_MESSAGE_KEYS, useActions, useAppState, useAsyncAction } from '@/ui/store';
import type { ActionResult } from '@/ui/store';

import styles from './SettingsScreen.module.css';

/** Locales proposées, avec la clé de libellé. */
const LOCALE_OPTIONS = [
  { value: 'fr', label: 'settings.languageFr' },
  { value: 'en', label: 'settings.languageEn' },
] as const satisfies readonly { readonly value: LocaleCode; readonly label: MessageKey }[];

/** Objectifs quotidiens proposés (minutes). */
const DAILY_GOALS = [
  10, 15, 20, 25,
] as const satisfies readonly PlayerSettings['dailyGoalMinutes'][];

/** Préférences de mouvement proposées. */
const MOTION_OPTIONS = [
  { value: 'system', label: 'settings.motionSystem' },
  { value: 'reduce', label: 'settings.motionReduce' },
  { value: 'no-preference', label: 'settings.motionNoPreference' },
] as const satisfies readonly {
  readonly value: PlayerSettings['reducedMotion'];
  readonly label: MessageKey;
}[];

/**
 * Réglages.
 *
 * Chaque changement appelle `updateSettings`, qui **persiste** et reflète la
 * locale dans `ui.locale` (le catalogue se recharge donc dans `App`). L'écran ne
 * décide d'aucune règle : il transmet une préférence déjà contrainte par le type
 * `PlayerSettings`.
 *
 * Données : l'export télécharge un JSON, l'import remplace la progression, la
 * réinitialisation exige **deux** confirmations (ouverture de la boîte + saisie
 * d'un mot exact). Aucune punition, aucun compte à rebours : un échec est un
 * message explicite, jamais une perte silencieuse.
 */
export function SettingsScreen() {
  const t = useT();
  const locale = useLocale();
  const state = useAppState();
  const actions = useActions();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetWord, setResetWord] = useState('');
  const resetHintId = useId();

  const settings = state.progress.player.settings;

  const applySettings = useCallback(
    (patch: Partial<PlayerSettings>): void => {
      const result = actions.updateSettings({ settings: patch });
      if (!result.ok) {
        toast.show({
          tone: 'danger',
          title: t(ACTION_FAILURE_MESSAGE_KEYS[result.reason]),
        });
      }
    },
    [actions, t, toast],
  );

  const importOperation = useCallback(
    async (file: File): Promise<ActionResult<PersistedProgress>> => {
      try {
        const raw = await readFileAsText(file);
        return actions.importProgress({ raw });
      } catch (error) {
        // Une lecture de fichier peut échouer (fichier disparu, permission) :
        // l'échec est signalé, jamais avalé ni transformé en exception non gérée.
        console.error('Lecture du fichier de sauvegarde impossible :', error);
        toast.show({ tone: 'danger', title: t('action.failure.importFailed') });
        return { ok: false, reason: 'importFailed', error: null };
      }
    },
    [actions, t, toast],
  );
  const { pending: importing, run: runImport } = useAsyncAction(importOperation);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null;
    // Le champ reste réutilisable : le même fichier doit pouvoir être rejoué.
    event.target.value = '';
    if (file !== null) {
      void runImport(file);
    }
  };

  const handleExport = useCallback((): void => {
    const result = actions.exportProgress();
    if (!result.ok) {
      toast.show({ tone: 'danger', title: t('settings.exportFailed') });
      return;
    }
    downloadJson(result.value.filename, result.value.json);
  }, [actions, t, toast]);

  const confirmWord = t('settings.resetConfirmWord');
  const wordMatches = resetWord.trim().toUpperCase() === confirmWord;

  const handleReset = useCallback((): void => {
    setResetOpen(false);
    setResetWord('');
    const result = actions.resetProgress();
    if (!result.ok) {
      toast.show({
        tone: 'danger',
        title: t(ACTION_FAILURE_MESSAGE_KEYS[result.reason]),
      });
    }
  }, [actions, t, toast]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }),
    [locale],
  );
  const savedAt = state.progress.savedAt;

  return (
    <div className={styles.screen}>
      <h1 className={styles.title}>{t('settings.title')}</h1>

      <Panel title={t('settings.languageTitle')}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('settings.languageLegend')}</legend>
          <Stack gap={2}>
            {LOCALE_OPTIONS.map((option) => (
              <label key={option.value} className={styles.option}>
                <input
                  type="radio"
                  name="settings-locale"
                  value={option.value}
                  checked={settings.locale === option.value}
                  onChange={() => applySettings({ locale: option.value })}
                />
                <span>{t(option.label)}</span>
              </label>
            ))}
          </Stack>
        </fieldset>
      </Panel>

      <Panel title={t('settings.dailyGoalTitle')}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('settings.dailyGoalLegend')}</legend>
          <Stack gap={2}>
            {DAILY_GOALS.map((minutes) => (
              <label key={minutes} className={styles.option}>
                <input
                  type="radio"
                  name="settings-daily-goal"
                  value={minutes}
                  checked={settings.dailyGoalMinutes === minutes}
                  onChange={() => applySettings({ dailyGoalMinutes: minutes })}
                />
                <span>{t('settings.dailyGoalMinutes', { minutes })}</span>
              </label>
            ))}
          </Stack>
        </fieldset>
      </Panel>

      <Panel title={t('settings.speechTitle')}>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={settings.speechEnabled}
            onChange={(event) => applySettings({ speechEnabled: event.target.checked })}
          />
          <span>{t('settings.speechLabel')}</span>
        </label>
        <p className={styles.muted}>{t('settings.speechHint')}</p>
      </Panel>

      <Panel title={t('settings.motionTitle')}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('settings.motionLegend')}</legend>
          <Stack gap={2}>
            {MOTION_OPTIONS.map((option) => (
              <label key={option.value} className={styles.option}>
                <input
                  type="radio"
                  name="settings-motion"
                  value={option.value}
                  checked={settings.reducedMotion === option.value}
                  onChange={() => applySettings({ reducedMotion: option.value })}
                />
                <span>{t(option.label)}</span>
              </label>
            ))}
          </Stack>
        </fieldset>
      </Panel>

      <Panel title={t('settings.confidenceTitle')}>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={settings.confidencePromptEnabled}
            onChange={(event) => applySettings({ confidencePromptEnabled: event.target.checked })}
          />
          <span>{t('settings.confidenceLabel')}</span>
        </label>
        <p className={styles.muted}>{t('settings.confidenceHint')}</p>
      </Panel>

      <Panel title={t('settings.dataTitle')}>
        <p className={styles.muted}>{t('settings.dataIntro')}</p>
        <Inline gap={4} wrap>
          <span className={styles.muted}>
            {t('settings.schemaVersion', { version: state.progress.schemaVersion })}
          </span>
          <span className={styles.muted}>
            {savedAt <= 0 ? (
              t('settings.neverSaved')
            ) : (
              <time dateTime={new Date(savedAt).toISOString()}>
                {t('settings.lastSaved', { date: dateFormatter.format(savedAt) })}
              </time>
            )}
          </span>
        </Inline>

        <Stack gap={3} className={styles.dataActions}>
          <div className={styles.dataRow}>
            <Button onClick={handleExport}>{t('settings.export')}</Button>
            <span className={styles.muted}>{t('settings.exportHint')}</span>
          </div>
          <div className={styles.dataRow}>
            <input
              ref={fileInputRef}
              className={styles.fileInput}
              type="file"
              accept="application/json,.json"
              tabIndex={-1}
              onChange={handleFileChange}
            />
            <Button loading={importing} onClick={() => fileInputRef.current?.click()}>
              {t('settings.import')}
            </Button>
            <span className={styles.muted}>{t('settings.importHint')}</span>
          </div>
          <div className={styles.dataRow}>
            <Button variant="danger" onClick={() => setResetOpen(true)}>
              {t('settings.reset')}
            </Button>
            <span className={styles.warning}>{t('settings.resetWarning')}</span>
          </div>
        </Stack>
      </Panel>

      <Dialog
        open={resetOpen}
        onClose={() => {
          setResetOpen(false);
          setResetWord('');
        }}
        title={t('recovery.resetTitle')}
        closeLabel={t('recovery.close')}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setResetOpen(false);
                setResetWord('');
              }}
            >
              {t('recovery.cancel')}
            </Button>
            <Button variant="danger" disabled={!wordMatches} onClick={handleReset}>
              {t('recovery.resetConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('recovery.resetBody')}</p>
        <label className={styles.resetField}>
          <span>{t('settings.resetWordLabel', { word: confirmWord })}</span>
          <input
            type="text"
            value={resetWord}
            aria-describedby={resetHintId}
            autoComplete="off"
            onChange={(event) => setResetWord(event.target.value)}
          />
        </label>
        <p id={resetHintId} className={styles.muted}>
          {t('settings.resetWordHint')}
        </p>
      </Dialog>
    </div>
  );
}

/** Télécharge un contenu JSON via un lien temporaire (aucun envoi réseau). */
function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Lit un fichier texte via `FileReader` (présent en jsdom comme en navigateur). */
function readFileAsText(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('lecture du fichier impossible'));
    };
    reader.readAsText(file);
  });
}
