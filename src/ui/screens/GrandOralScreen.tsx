import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { selectSessionProgress } from '@/application/store';
import type { MasterySnapshot } from '@/domain/mastery/types';
import type { SessionItem, SessionSummary } from '@/domain/session/types';
import type { ConfidenceRating, LocalizedText, ReviewGrade } from '@/domain/shared/types';
import { useLocalizedText, useT } from '@/i18n';
import type { MessageKey, Translator } from '@/i18n';
import { Button, Card, Chip, Dialog, Inline, Kbd, ProgressBar, useToast } from '@/ui/primitives';
import {
  ACTION_FAILURE_MESSAGE_KEYS,
  useActions,
  useAppState,
  useClock,
  useMastery,
  useSelect,
} from '@/ui/store';
import type { ActionFailureReason } from '@/ui/store';

import {
  evaluateGrandOral,
  formatElapsed,
  GRAND_ORAL_ITEM_COUNT,
  GRAND_ORAL_MAX_DURATION_MS,
  GRAND_ORAL_PASS_ACCURACY,
} from './grandOralCriteria';
import type { GrandOralTier } from './grandOralCriteria';
import styles from './GrandOralScreen.module.css';

/**
 * Grand Oral (P5-B) — examen final chronométré, palier Diamant du PLAN.
 *
 * Construit **sur le mode `grand-oral` existant** : l'écran ne crée ni plan, ni
 * règle, ni durée. Il démarre la session via `startSession`, affiche les items
 * du plan (zéro discrimination, indices désactivés par la politique du mode) et
 * lit le verdict du `SessionSummary` produit par `finishSession`. Les seuls
 * seuils de l'examen vivent dans `./grandOralCriteria`.
 *
 * Ce que l'écran ne fait jamais :
 * - écrire une réponse (examen oral : aucun champ de saisie) ;
 * - mesurer le temps avec `Date.now()` : le chronomètre lit `ClockPort` et un
 *   `setInterval` ne sert qu'à **forcer un rendu**, jamais à compter ;
 * - calculer une durée, une précision ou un palier : tout vient du domaine.
 */

/** Ordre d'affichage des notes, de l'échec à la réussite facile. */
const GRADES: readonly ReviewGrade[] = ['again', 'hard', 'good', 'easy'];

/** Libellés des notes, réutilisés du mode d'entraînement. */
const GRADE_KEYS = {
  again: 'train.grade.again',
  hard: 'train.grade.hard',
  good: 'train.grade.good',
  easy: 'train.grade.easy',
} as const satisfies Readonly<Record<ReviewGrade, MessageKey>>;

/** Raccourcis clavier `1`–`4` des notes. */
const GRADE_SHORTCUTS: Readonly<Record<string, ReviewGrade>> = {
  '1': 'again',
  '2': 'hard',
  '3': 'good',
  '4': 'easy',
};

/** Échelle complète des jugements de confiance (L12), dans l'ordre. */
const CONFIDENCE_RATINGS: readonly ConfidenceRating[] = [1, 2, 3, 4, 5];

/** Libellés des jugements de confiance, réutilisés du mode d'entraînement. */
const CONFIDENCE_KEYS = {
  1: 'train.confidence.1',
  2: 'train.confidence.2',
  3: 'train.confidence.3',
  4: 'train.confidence.4',
  5: 'train.confidence.5',
} as const satisfies Readonly<Record<ConfidenceRating, MessageKey>>;

/** Libellés des paliers du Grand Oral. */
const TIER_KEYS = {
  diamond: 'grandOral.tier.diamond',
  gold: 'grandOral.tier.gold',
  silver: 'grandOral.tier.silver',
  bronze: 'grandOral.tier.bronze',
} as const satisfies Readonly<Record<GrandOralTier, MessageKey>>;

/** Cadence de rafraîchissement de l'affichage (jamais la mesure du temps). */
const TIMER_REFRESH_MS = 1000;

/** Texte de la réponse attendue : question complète ou numéro global. */
function expectedAnswerText(
  answer: SessionItem['expectedAnswer'],
  t: Translator,
  localize: (text: LocalizedText) => string,
): string {
  return answer.kind === 'number'
    ? t('train.cue.number', { number: answer.questionNumber })
    : localize(answer.text);
}

/** Vrai quand le nœud (ou l'un de ses ancêtres) est une boîte de dialogue. */
function isWithinDialog(node: EventTarget | Element | null): boolean {
  return node instanceof Element && node.closest('[role="dialog"]') !== null;
}

/** Signature de notation : la note, la confiance déclarée et le temps de réponse. */
type SubmitGrade = (
  grade: ReviewGrade,
  confidence: ConfidenceRating | null,
  responseTimeMs: number,
) => void;

/**
 * Écran du Grand Oral.
 *
 * Trois visages selon l'état, du plus fermé au plus avancé :
 * 1. **accès** — les trois actes ne sont pas maîtrisés : compte exact des
 *    questions restantes par acte (`useMastery`, jamais recalculé) ;
 * 2. **examen** — session `grand-oral` active : chronomètre, item, notation ;
 * 3. **bilan** — session terminée : verdict et palier issus du résumé.
 */
export function GrandOralScreen() {
  const t = useT();
  const actions = useActions();
  const state = useAppState();
  const mastery = useMastery();
  const toast = useToast();
  const progress = useSelect(selectSessionProgress);

  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [failure, setFailure] = useState<MessageKey | null>(null);

  const session =
    state.session !== null && state.session.plan.mode === 'grand-oral' ? state.session : null;
  const running = session !== null && session.phase !== 'completed' && summary === null;
  const currentQuestionNumber =
    progress === null ? 0 : Math.min(progress.index + 1, progress.total);

  const reportFailure = useCallback(
    (reason: ActionFailureReason) => {
      const key = ACTION_FAILURE_MESSAGE_KEYS[reason];
      setFailure(key);
      toast.show({ tone: 'danger', title: t(key) });
    },
    [t, toast],
  );

  const startExam = useCallback(() => {
    setSummary(null);
    setFailure(null);
    const result = actions.startSession({ mode: 'grand-oral' });
    if (!result.ok) {
      reportFailure(result.reason);
      return;
    }
    actions.navigate('grand-oral');
  }, [actions, reportFailure]);

  const submitGrade = useCallback<SubmitGrade>(
    (grade, confidence, responseTimeMs) => {
      if (session === null) {
        return;
      }
      const item = session.plan.items[session.currentIndex];
      if (item === undefined) {
        return;
      }
      const result = actions.submitAnswer({
        sessionId: session.plan.id,
        itemId: item.id,
        grade,
        confidence,
        responseTimeMs,
        hintsUsed: session.revealedHints,
        // L8 : l'examen est oral, le canal est forcé — jamais un choix.
        channel: 'spoken',
      });
      if (!result.ok) {
        reportFailure(result.reason);
        return;
      }
      setFailure(null);
      if (result.value.summary === null) {
        return;
      }
      // Dernier item : on clôt la session (journal + XP de fin) et on lit le
      // verdict du résumé **produit par le domaine**.
      const finished = actions.finishSession(session.plan.id);
      if (!finished.ok) {
        reportFailure(finished.reason);
        return;
      }
      setSummary(finished.value.summary);
      // `session/completed` ramène l'écran à l'accueil : on rouvre le bilan ici.
      actions.navigate('grand-oral');
    },
    [actions, reportFailure, session],
  );

  const revealAnswer = useCallback(() => {
    if (session === null) {
      return;
    }
    const result = actions.revealAnswer(session.plan.id);
    if (!result.ok) {
      reportFailure(result.reason);
    }
  }, [actions, reportFailure, session]);

  const handleAbandonConfirm = useCallback(() => {
    setAbandonOpen(false);
    if (session !== null) {
      const result = actions.abandonSession(session.plan.id);
      if (!result.ok) {
        reportFailure(result.reason);
      }
    }
    setSummary(null);
    actions.navigate('home');
  }, [actions, reportFailure, session]);

  const handleReplay = useCallback(() => {
    setSummary(null);
    setFailure(null);
    const result = actions.startSession({ mode: 'grand-oral' });
    if (!result.ok) {
      reportFailure(result.reason);
      actions.navigate('home');
      return;
    }
    actions.navigate('grand-oral');
  }, [actions, reportFailure]);

  if (summary !== null) {
    return (
      <GrandOralResult
        summary={summary}
        onReplay={handleReplay}
        onHome={() => actions.navigate('home')}
      />
    );
  }

  if (!running || session === null) {
    return (
      <GrandOralGate
        mastery={mastery}
        failure={failure}
        onStart={startExam}
        onSeeProgress={() => actions.navigate('train')}
      />
    );
  }

  const item = session.plan.items[session.currentIndex] ?? null;

  return (
    <div className={styles.screen}>
      <header className={styles.chrome}>
        <div className={styles.titleBlock}>
          <h1 className={styles.heading}>{t('grandOral.heading')}</h1>
          <p className={styles.instruction}>{t('grandOral.instruction')}</p>
        </div>
        <Button variant="ghost" onClick={() => setAbandonOpen(true)}>
          {t('grandOral.abandon')}
        </Button>
      </header>

      <div className={styles.status}>
        <OralTimer startedAt={session.startedAt} />
        {progress === null ? null : (
          <div className={styles.sessionProgress}>
            <p className={styles.sessionProgressText}>
              {t('train.progressText', { current: currentQuestionNumber, total: progress.total })}
            </p>
            <ProgressBar
              value={currentQuestionNumber}
              max={progress.total}
              label={t('train.progressLabel', {
                current: currentQuestionNumber,
                total: progress.total,
              })}
            />
          </div>
        )}
      </div>

      {failure === null ? null : (
        <p role="alert" className={styles.error}>
          {t(failure)}
        </p>
      )}

      {item === null ? null : (
        <GrandOralItem
          key={item.id}
          item={item}
          domainRevealed={session.phase === 'revealed'}
          requiresConfidence={session.plan.config.requiresConfidence}
          onSubmit={submitGrade}
          onReveal={revealAnswer}
        />
      )}

      <Dialog
        open={abandonOpen}
        onClose={() => setAbandonOpen(false)}
        title={t('grandOral.abandonTitle')}
        closeLabel={t('grandOral.close')}
        footer={
          <Inline gap={3} wrap>
            <Button variant="danger" onClick={handleAbandonConfirm}>
              {t('grandOral.abandonConfirm')}
            </Button>
            <Button variant="secondary" onClick={() => setAbandonOpen(false)}>
              {t('grandOral.abandonCancel')}
            </Button>
          </Inline>
        }
      >
        <p>{t('grandOral.abandonBody')}</p>
      </Dialog>
    </div>
  );
}

/* ── Chronomètre ──────────────────────────────────────────────────────────── */

interface OralTimerProps {
  /** Instant de départ de la session, fourni par le domaine (`SessionState`). */
  readonly startedAt: number;
}

/**
 * Chronomètre de l'examen, affiché en `mm:ss`.
 *
 * La valeur est `ClockPort.now() - startedAt`, relue à chaque rendu ; le
 * `setInterval` ne fait que provoquer ce rendu (ADR 0008 : aucune horloge
 * implicite). Il court tant que la session est active, donc ne s'arrête pas
 * entre les items. Annonce accessible désactivée (`aria-live="off"`) : un
 * lecteur d'écran n'est pas inondé seconde par seconde.
 */
function OralTimer({ startedAt }: OralTimerProps) {
  const t = useT();
  const clock = useClock();
  const [, forceRender] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      forceRender((tick) => tick + 1);
    }, TIMER_REFRESH_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const elapsed = formatElapsed(clock.now() - startedAt);

  return (
    <p className={styles.timer} role="timer" aria-live="off">
      <span className={styles.timerLabel}>{t('grandOral.timerLabel')}</span>{' '}
      <span className={styles.timerValue}>{elapsed}</span>
    </p>
  );
}

/* ── Accès ────────────────────────────────────────────────────────────────── */

interface GrandOralGateProps {
  readonly mastery: MasterySnapshot | null;
  readonly failure: MessageKey | null;
  readonly onStart: () => void;
  readonly onSeeProgress: () => void;
}

/**
 * Conditions d'accès : les trois actes doivent être **entièrement** maîtrisés.
 *
 * Le verdict de disponibilité est lu du snapshot de maîtrise (`useMastery`), et
 * l'écran se contente d'en dériver le compte restant par acte
 * (`questionCount - masteredCount`) : il n'évalue aucune maîtrise lui-même.
 */
function GrandOralGate({ mastery, failure, onStart, onSeeProgress }: GrandOralGateProps) {
  const t = useT();
  const acts = mastery?.acts ?? [];
  const locked = mastery === null || acts.some((act) => act.masteredCount < act.questionCount);

  return (
    <div className={styles.screen}>
      <h1 className={styles.heading}>{t('grandOral.heading')}</h1>
      <Card className={styles.gate}>
        <p>{t('grandOral.lead')}</p>
        {failure === null ? null : (
          <p role="alert" className={styles.error}>
            {t(failure)}
          </p>
        )}
        {locked ? (
          <>
            <h2 className={styles.stepTitle}>{t('grandOral.gateTitle')}</h2>
            <p>{t('grandOral.gateLead')}</p>
            <ul className={styles.actList}>
              {acts.map((act) => (
                <li key={act.actId} className={styles.actRow}>
                  <span className={styles.actName}>
                    {t('grandOral.gateAct', { act: act.actId })}
                  </span>
                  <span className={styles.actRemaining}>
                    {t('grandOral.gateRemaining', {
                      count: act.questionCount - act.masteredCount,
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.muted}>{t('grandOral.gateWhy')}</p>
            <Button variant="secondary" onClick={onSeeProgress}>
              {t('grandOral.gateCta')}
            </Button>
          </>
        ) : (
          <>
            <p className={styles.muted}>{t('grandOral.gateReady')}</p>
            <Button size="lg" onClick={onStart}>
              {t('grandOral.start')}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

/* ── Item ─────────────────────────────────────────────────────────────────── */

interface GrandOralItemProps {
  readonly item: SessionItem;
  /** Phase de révélation portée par le domaine (`SessionState.phase`). */
  readonly domainRevealed: boolean;
  readonly requiresConfidence: boolean;
  readonly onSubmit: SubmitGrade;
  readonly onReveal: () => void;
}

/**
 * Étape d'un item d'examen : indice, confiance (L12), révélation, auto-notation.
 *
 * Aucun champ de saisie n'est rendu : on récite à voix haute puis on se note
 * contre la réponse attendue. Le composant est remonté à chaque item
 * (`key={item.id}`), donc la confiance et le temps de réponse repartent de zéro.
 */
function GrandOralItem({
  item,
  domainRevealed,
  requiresConfidence,
  onSubmit,
  onReveal,
}: GrandOralItemProps) {
  const t = useT();
  const localize = useLocalizedText();
  const clock = useClock();
  const confidenceTitleId = useId();
  const shownAtRef = useRef<number>(clock.now());

  const [confidence, setConfidence] = useState<ConfidenceRating | null>(null);
  const [localRevealed, setLocalRevealed] = useState(false);

  const revealed = localRevealed || domainRevealed;

  const submit = useCallback(
    (grade: ReviewGrade) => {
      onSubmit(grade, confidence, Math.max(0, clock.now() - shownAtRef.current));
    },
    [clock, confidence, onSubmit],
  );

  const handleReveal = useCallback(() => {
    if (!requiresConfidence) {
      onReveal();
      return;
    }
    // L12 : la confiance précède la révélation. On affiche la réponse ici et la
    // transition atomique (confiance → révélation → note) est différée à la
    // notation, comme dans l'écran d'entraînement.
    if (confidence !== null) {
      setLocalRevealed(true);
    }
  }, [confidence, onReveal, requiresConfidence]);

  // Raccourcis : `1`–`4` notent une fois la réponse révélée, `Espace` révèle.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (isWithinDialog(event.target) || isWithinDialog(document.activeElement)) {
        return;
      }
      if (revealed) {
        const grade = GRADE_SHORTCUTS[event.key];
        if (grade === undefined) {
          return;
        }
        event.preventDefault();
        submit(grade);
        return;
      }
      if (event.key !== ' ' && event.code !== 'Space') {
        return;
      }
      event.preventDefault();
      handleReveal();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [handleReveal, revealed, submit]);

  return (
    <Card className={styles.stage}>
      <div aria-live="polite">
        <CueView item={item} />
      </div>

      {item.hints.length === 0 ? <p className={styles.muted}>{t('grandOral.noHints')}</p> : null}

      {revealed ? (
        <section className={styles.revealed} aria-live="polite">
          <h2 className={styles.stepTitle}>{t('train.expected.title')}</h2>
          <p className={styles.expected}>{expectedAnswerText(item.expectedAnswer, t, localize)}</p>
          <div className={styles.grades}>
            <h3 className={styles.stepTitle}>{t('train.grade.title')}</h3>
            <Inline gap={3} wrap>
              {GRADES.map((value, index) => (
                <Button
                  key={value}
                  variant={value === 'again' ? 'danger' : 'secondary'}
                  onClick={() => submit(value)}
                >
                  {`${String(index + 1)}. ${t(GRADE_KEYS[value])}`}
                </Button>
              ))}
            </Inline>
            <p className={styles.shortcut}>
              {t('train.grade.shortcut')} <Kbd>1</Kbd>–<Kbd>4</Kbd> {t('grandOral.gradeShortcut')}
            </p>
          </div>
        </section>
      ) : (
        <>
          {requiresConfidence ? (
            <section className={styles.confidence} aria-labelledby={confidenceTitleId}>
              <h2 id={confidenceTitleId} className={styles.stepTitle}>
                {t('train.confidence.title')}
              </h2>
              <Inline gap={2} wrap>
                {CONFIDENCE_RATINGS.map((rating) => (
                  <Button
                    key={rating}
                    variant={confidence === rating ? 'primary' : 'secondary'}
                    aria-pressed={confidence === rating}
                    onClick={() => setConfidence(rating)}
                  >
                    {t(CONFIDENCE_KEYS[rating])}
                  </Button>
                ))}
              </Inline>
            </section>
          ) : null}

          <div className={styles.reveal}>
            {requiresConfidence && confidence === null ? (
              <p className={styles.muted}>{t('train.confidence.required')}</p>
            ) : null}
            <Button
              size="lg"
              disabled={requiresConfidence && confidence === null}
              onClick={handleReveal}
            >
              {t('train.reveal')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

/** Rend la zone d'indice selon la direction de drill (L16). */
function CueView({ item }: { readonly item: SessionItem }) {
  const t = useT();
  const localize = useLocalizedText();
  const cue = item.cue;
  switch (cue.kind) {
    case 'order':
      return (
        <p className={styles.cueOrder}>
          {t('train.cue.order', { act: cue.actId, position: cue.positionInAct })}
        </p>
      );
    case 'keyword':
      return (
        <div className={styles.cue}>
          <p className={styles.label}>{t('train.cue.keyword')}</p>
          <p className={styles.keyword}>{localize(cue.text)}</p>
        </div>
      );
    case 'image':
      return (
        <div className={styles.cue}>
          <p className={styles.label}>{t('train.cue.image')}</p>
          <p className={styles.image}>{localize(cue.text)}</p>
        </div>
      );
    case 'number':
      return (
        <p className={styles.number}>{t('train.cue.number', { number: cue.questionNumber })}</p>
      );
    case 'question':
      return (
        <div className={styles.cue}>
          <p className={styles.label}>{t('train.cue.question')}</p>
          <p className={styles.question}>{localize(cue.text)}</p>
          <p className={styles.instruction}>{t('train.cue.questionInstruction')}</p>
        </div>
      );
  }
}

/* ── Bilan ────────────────────────────────────────────────────────────────── */

interface GrandOralResultProps {
  readonly summary: SessionSummary;
  readonly onReplay: () => void;
  readonly onHome: () => void;
}

/**
 * Bilan de l'examen : aucune valeur n'est recalculée ici.
 *
 * `evaluateGrandOral` transforme le `SessionSummary` du domaine en verdict
 * (réussite, palier, causes), et l'écran ne fait que formater ce verdict.
 */
function GrandOralResult({ summary, onReplay, onHome }: GrandOralResultProps) {
  const t = useT();
  const outcome = evaluateGrandOral(summary);
  const accuracyPercent = Math.round(outcome.accuracy * 100);
  const limitPercent = Math.round(GRAND_ORAL_PASS_ACCURACY * 100);

  return (
    <div className={styles.screen}>
      <h1 className={styles.heading}>{t('grandOral.resultTitle')}</h1>
      <Card className={styles.result}>
        <Inline gap={2} align="center">
          <Chip tone={outcome.passed ? 'success' : 'muted'}>{t(TIER_KEYS[outcome.tier])}</Chip>
          {outcome.passed ? <Chip tone="accent">{t('grandOral.resultBadge')}</Chip> : null}
        </Inline>

        <p className={outcome.passed ? styles.correct : styles.failed}>
          {t(outcome.passed ? 'grandOral.resultPassed' : 'grandOral.resultFailed')}
        </p>

        <dl className={styles.metrics}>
          <div className={styles.metric}>
            <dt className={styles.metricLabel}>{t('grandOral.metric.duration')}</dt>
            <dd className={styles.metricValue}>{formatElapsed(outcome.durationMs)}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.metricLabel}>{t('grandOral.metric.accuracy')}</dt>
            <dd className={styles.metricValue}>
              {t('grandOral.metric.accuracyValue', { percent: accuracyPercent })}
            </dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.metricLabel}>{t('grandOral.metric.items')}</dt>
            <dd className={styles.metricValue}>
              {t('grandOral.metric.itemsValue', {
                count: outcome.itemCount,
                total: GRAND_ORAL_ITEM_COUNT,
              })}
            </dd>
          </div>
        </dl>

        {outcome.failureCauses.map((cause) => (
          <p key={cause} role="status" className={styles.cause}>
            {cause === 'duration'
              ? t('grandOral.cause.duration', {
                  actual: formatElapsed(outcome.durationMs),
                  limit: formatElapsed(GRAND_ORAL_MAX_DURATION_MS),
                })
              : t('grandOral.cause.accuracy', { actual: accuracyPercent, limit: limitPercent })}
          </p>
        ))}

        <Inline gap={3} wrap>
          <Button onClick={onReplay}>{t('grandOral.replay')}</Button>
          <Button variant="secondary" onClick={onHome}>
            {t('grandOral.home')}
          </Button>
        </Inline>
      </Card>
    </div>
  );
}
