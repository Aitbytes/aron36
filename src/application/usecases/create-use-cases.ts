import {
  BADGE_DEFINITIONS,
  QUEST_DEFINITIONS,
  STREAK_RULES,
  XP_RULES,
  badgeEvaluator,
  collectionEvaluator,
  metricsCalculator,
  questGenerator,
  streakUpdater,
  xpCalculator,
} from '@/domain/gamification';
import type {
  PlayerSettings,
  PlayerState,
  QuestBoard,
  QuestProgressInput,
  XpAmount,
  XpAward,
} from '@/domain/gamification/types';
import { upsertHook } from '@/domain/memory/hooks';
import { masteryEvaluator } from '@/domain/mastery';
import type { MasterySnapshot, QuestionMastery } from '@/domain/mastery/types';
import { MAX_REVIEW_LOG_ENTRIES, MAX_SESSION_LOG_ENTRIES } from '@/domain/progress/types';
import type { PersistedProgress } from '@/domain/progress/types';
import { QUESTIONS_PER_ACT } from '@/domain/shared/types';
import type { DayKey, EpochMs, QuestionId, SessionId } from '@/domain/shared/types';
import { sessionBuilder, sessionEngine } from '@/domain/session';
import type {
  AnswerFeedback,
  SessionLog,
  SessionRequest,
  SessionState,
} from '@/domain/session/types';
import type { ScheduledReview, ReviewLog } from '@/domain/srs/types';
import type { CardState } from '@/domain/srs/types';

import { UseCaseRejection } from './errors';
import { createInitialProgress } from '@/application/bootstrap';
import { createProgressRepository } from './progress-repository';
import type { ProgressRepository } from './progress-repository';
import { resolveSessionWindow } from './session-window';
import { buildSessionSummary, tallySession } from './summary';
import { progressCodec } from '@/application/progress';
import type { ProgressCodecFactory } from '@/application/progress';
import type {
  AppServices,
  EvaluateMasteryOutput,
  ExportProgressOutput,
  FinishSessionInput,
  FinishSessionOutput,
  ImportProgressInput,
  ImportProgressOutput,
  ResetProgressOutput,
  SaveHookInput,
  SaveHookOutput,
  StartSessionInput,
  StartSessionOutput,
  SubmitAnswerInput,
  SubmitAnswerOutput,
  UpdateSettingsInput,
  UpdateSettingsOutput,
  UseCases,
} from './types';

/**
 * Les 8 cas d'usage du contrat `UseCases` (Phase 3-C).
 *
 * Chaque cas d'usage combine le domaine (implémentations pures importées
 * directement : XP, séries, quêtes, collection, badges, métriques, maîtrise,
 * moteur de session — aucune n'a d'I/O) et les ports (`AppServices`).
 *
 * Conventions :
 * - **aucune horloge implicite** : tout instant vient de `services.clock`, tout
 *   identifiant de `services.ids`, toute graine de `services.newSeed()` ;
 * - la progression est portée par un dépôt interne (`ProgressRepository`) : les
 *   deltas appliqués (XP, carte SRS, journal) sont **les mêmes** que ceux du
 *   réducteur sur `session/answered` / `session/completed` — l'UI peut donc
 *   dispatcher les actions granulaires ou `progress/replaced` avec
 *   `updatedProgress`, les deux restent cohérents ;
 * - les rejets de contrat (session inconnue, soumission refusée par le moteur,
 *   accroche invalide) lèvent une `UseCaseRejection` typée ; les échecs d'I/O
 *   restent des résultats explicites, jamais des exceptions.
 *
 * État interne : `runs` garde la `SessionState` courante par identifiant (les
 * sessions ne sont pas persistées) et la somme des XP de **production**
 * attribuées, nécessaire à `SessionLog.xpAwarded` (« production uniquement »).
 */
interface SessionRun {
  state: SessionState;
  productionXp: XpAmount;
}

/** Fenêtre de journal récent transmis au constructeur de plan (L4, L16). */
const RECENT_LOGS_WINDOW = 200;

/** Crée les 8 cas d'usage liés aux services et au codec injectés. */
export function createUseCases(
  services: AppServices,
  createCodec: ProgressCodecFactory = () => progressCodec,
): UseCases {
  const codec = createCodec();
  const repository: ProgressRepository = createProgressRepository(services, codec, (locale) =>
    createInitialProgress(services, locale),
  );
  const runs = new Map<SessionId, SessionRun>();

  function requireRun(sessionId: SessionId): SessionRun {
    const run = runs.get(sessionId);
    if (run === undefined) {
      throw new UseCaseRejection(
        'unknown-session',
        { kind: 'session-id', sessionId },
        'Aucune session active pour cet identifiant : appeler startSession.',
      );
    }
    return run;
  }

  function evaluateMasterySnapshot(
    cards: PersistedProgress['cards'],
    reviewLogs: PersistedProgress['reviewLogs'],
    now: EpochMs,
  ): MasterySnapshot {
    return masteryEvaluator.evaluate(
      { cards: Object.values(cards), reviewLogs, questionsPerAct: QUESTIONS_PER_ACT, now },
      services.masteryCriteria,
    );
  }

  /* ── 1. startSession ──────────────────────────────────────────────────── */

  function startSession(input: StartSessionInput): StartSessionOutput {
    const progress = repository.requireProgress();
    const now = services.clock.now();

    // L14/L15 : actes débloqués et maîtrisés, recalculés par `MasteryEvaluator`
    // depuis les cartes et les journaux — jamais par le domaine seul.
    const mastery = evaluateMasterySnapshot(progress.cards, progress.reviewLogs, now);
    const request: SessionRequest = {
      mode: input.mode,
      sessionId: services.ids.newSessionId(),
      seed: services.newSeed(),
      now,
      ...(input.actIds === undefined ? {} : { actIds: input.actIds }),
      ...(input.questionIds === undefined ? {} : { questionIds: input.questionIds }),
      ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
      ...(input.maxDurationMs === undefined ? {} : { maxDurationMs: input.maxDurationMs }),
    };
    const built = sessionBuilder.build(request, {
      catalog: services.catalog,
      cards: cardsMap(progress.cards),
      hooks: progress.hooks.hooks,
      recentLogs: progress.reviewLogs.slice(-RECENT_LOGS_WINDOW),
      unlockedActIds: mastery.acts.filter((act) => act.unlocked).map((act) => act.actId),
      masteredActIds: mastery.acts
        .filter((act) => act.masteredCount === act.questionCount)
        .map((act) => act.actId),
    });
    if (!built.ok) {
      // « Un échec de construction est propagé tel quel » (contrat) : rejet
      // typé portant le motif du domaine, jamais une `Error` générique.
      throw new UseCaseRejection(
        'session-build-refused',
        { kind: 'build', failure: built.failure },
        `Construction de session refusée : ${built.failure}`,
      );
    }
    const state = sessionEngine.start(built.plan, now);
    runs.set(request.sessionId, { state, productionXp: 0 });
    return { plan: built.plan, state };
  }

  /* ── 2. submitAnswer ──────────────────────────────────────────────────── */

  function submitAnswer(input: SubmitAnswerInput): SubmitAnswerOutput {
    const run = requireRun(input.sessionId);
    const now = services.clock.now();

    // (a) L12 : la confiance est déclarée **avant** révélation ; le cas d'usage
    // enchaîne confiance → révélation → note, et propage tout refus du moteur.
    let working = run.state;
    if (input.confidence !== null) {
      const judged = sessionEngine.setConfidence(working, input.confidence);
      if (!judged.ok) {
        throw transitionRefused(judged.failure);
      }
      working = judged.state;
    }
    const revealed = sessionEngine.revealAnswer(working);
    if (!revealed.ok) {
      throw transitionRefused(revealed.failure);
    }
    const submitted = sessionEngine.submitAnswer(revealed.state, {
      itemId: input.itemId,
      grade: input.grade,
      responseTimeMs: input.responseTimeMs,
      hintsUsed: input.hintsUsed,
      channel: input.channel,
      now,
    });
    if (!submitted.ok) {
      throw new UseCaseRejection(
        'session-submission-refused',
        { kind: 'submission', failure: submitted.failure },
        `Soumission refusée par le moteur : ${submitted.failure}`,
      );
    }
    const { state: nextSession, answer, feedback, completed } = submitted.submission;

    // L'item vient d'être accepté par le moteur : il est nécessairement défini.
    const item = run.state.plan.items[run.state.currentIndex];
    if (item === undefined) {
      throw new UseCaseRejection(
        'unknown-session',
        { kind: 'none' },
        'Item courant introuvable après acceptation du moteur (inatteignable).',
      );
    }

    const progress = repository.requireProgress();
    const dayKey = services.clock.dayKey(now);
    const isPretest = answer.isPretest;
    const isDiscrimination = answer.exerciseKind === 'discrimination';
    // L12 : règle documentée (revue Phase 3) — la confiance **déclarée** est
    // journalisée **dès qu'elle est fournie**, quel que soit le mode. Le moteur
    // ne la recopie dans `SessionAnswer` que quand le plan l'exige
    // (`requiresConfidence`) ; hors de ce cas, `answer.confidence` vaut `null`
    // alors que `setConfidence` a bien déposé la valeur. On ne l'ignore plus
    // silencieusement : le journal et la quête de calibration s'en nourrissent.
    const declaredConfidence = answer.confidence ?? input.confidence;

    // (b) Ordonnancement : hors QCM et hors prétest (L18) — ces deux formes ne
    // prouvent aucune restitution et ne déplacent pas la carte SRS.
    const card =
      progress.cards[String(answer.questionId)] ??
      services.scheduler.initialState(answer.questionId, now);
    const scheduledReview: ScheduledReview | null =
      isPretest || isDiscrimination ? null : services.scheduler.schedule(card, answer.grade, now);

    // (c) XP via `XpCalculator` : l'anti-farm compte les journaux **du jour**
    // pour cette question (un prétest, jamais journalisé, n'y entre pas). Un
    // prétest ne rapporte rien (une devinette n'est pas une production) : gain
    // nul explicite, auditable via `breakdown`.
    const xp: XpAward = isPretest
      ? zeroAnswerXp(answer.questionId, now)
      : xpCalculator.forAnswer(
          {
            questionId: answer.questionId,
            direction: answer.direction,
            exerciseKind: answer.exerciseKind,
            grade: answer.grade,
            responseTimeMs: answer.responseTimeMs,
            hintsUsed: answer.hintsUsed,
          },
          {
            rules: XP_RULES,
            sameDayAnswersForQuestion: countSameDayAnswers(
              progress.reviewLogs,
              answer.questionId,
              dayKey,
            ),
            isFirstExposure: isFirstSuccessfulProduction(progress.reviewLogs, answer.questionId),
            now,
          },
        );
    if (!isPretest && !isDiscrimination) {
      run.productionXp += xp.amount;
    }

    // (g) Journal de révision : `id` issu de `IdPort.newReviewLogId()` — espace
    // d'identifiants distinct de `SessionAnswer.itemId`. Construit avant les
    // métriques de badges, qui doivent le voir.
    const reviewLog: ReviewLog | null = isPretest
      ? null
      : {
          id: services.ids.newReviewLogId(),
          sessionId: nextSession.plan.id,
          questionId: answer.questionId,
          direction: answer.direction,
          exerciseKind: answer.exerciseKind,
          grade: answer.grade,
          reviewedAt: answer.answeredAt,
          previousDueAt: scheduledReview?.previousCard.dueAt ?? null,
          nextDueAt: scheduledReview?.nextCard.dueAt ?? card.dueAt,
          intervalDays: scheduledReview?.nextCard.intervalDays ?? card.intervalDays,
          elapsedDays: scheduledReview?.elapsedDays ?? 0,
          responseTimeMs: answer.responseTimeMs,
          hintsUsed: answer.hintsUsed,
          confidence: declaredConfidence,
        };
    const reviewLogs =
      reviewLog === null
        ? progress.reviewLogs
        : [...progress.reviewLogs, reviewLog].slice(-MAX_REVIEW_LOG_ENTRIES);
    const cards: PersistedProgress['cards'] =
      scheduledReview === null
        ? progress.cards
        : {
            ...progress.cards,
            [String(scheduledReview.nextCard.questionId)]: scheduledReview.nextCard,
          };

    // (d) Quêtes du jour : tableau (re)généré si absent ou périmé, puis
    // progressé sur les faits réels de la réponse. Un prétest ne compte pas
    // (ce n'est pas une tentative de restitution).
    const window = resolveSessionWindow(services.clock, now);
    const playerWithQuests: PlayerState = isPretest
      ? progress.player
      : {
          ...progress.player,
          questBoard: advanceQuestBoard(progress.player, dayKey, {
            questionId: answer.questionId,
            actId: item.actId,
            direction: answer.direction,
            exerciseKind: answer.exerciseKind,
            grade: answer.grade,
            confidence: declaredConfidence,
            responseTimeMs: answer.responseTimeMs,
            hintsUsed: answer.hintsUsed,
            wasNewCard: card.reps === 0,
            window,
            now,
          }),
        };

    // (h) Série : l'updater du domaine est **idempotent par jour** — au premier
    // item réussi de la journée la journée est validée, les suivants ne la
    // valident pas deux fois. Un échec (`again`) ne valide rien.
    const streak = isPretest
      ? progress.player.streak
      : streakUpdater.update({
          state: progress.player.streak,
          today: dayKey,
          qualifyingProductionsToday: countQualifyingProductionsToday(reviewLogs, dayKey),
          daysSinceLastActive: daysSince(progress.player.streak.lastActiveDay, dayKey),
          rules: STREAK_RULES,
        }).state;

    // (f) Collection : évaluée sur la maîtrise **recalculée** avec le nouveau
    // journal — l'intervalle SRS fraîchement ordonnancé est la source du palier.
    const mastery = evaluateMasterySnapshot(cards, reviewLogs, now);
    const questionMastery = masteryOf(mastery, answer.questionId);
    const collection = isPretest
      ? progress.player.collection
      : collectionEvaluator.update({
          state: playerWithQuests.collection,
          mastery: questionMastery,
          intervalDays: scheduledReview?.nextCard.intervalDays ?? card.intervalDays,
          now,
        }).state;

    // (e) Badges : évalués sur les métriques **post-réponse** — un premier
    // succès de production doit ouvrir `premier-pas` immédiatement.
    const metrics = metricsCalculator.compute({
      reviewLogs,
      sessionLogs: progress.sessionLogs,
      mastery: flattenQuestions(mastery),
      hooksCount: progress.hooks.hooks.length,
      collection,
      streak,
      oralExamPasses: progress.sessionLogs.filter((log) => log.mode === 'grand-oral').length,
      bestOralExam: bestOralExamOf(progress.sessionLogs),
    });
    const previousUnlocked = new Set(
      progress.player.badges.filter((badge) => badge.unlockedAt !== null).map((b) => b.badgeId),
    );
    const badges = badgeEvaluator.evaluate(
      BADGE_DEFINITIONS,
      metrics,
      playerWithQuests.badges,
      now,
    );
    const newlyUnlockedBadges = badges
      .filter((badge) => badge.unlockedAt !== null && !previousUnlocked.has(badge.badgeId))
      .map((badge) => badge.badgeId);

    const updatedProgress: PersistedProgress = {
      schemaVersion: progress.schemaVersion,
      appVersion: progress.appVersion,
      savedAt: progress.savedAt,
      player: {
        ...playerWithQuests,
        totalXp: playerWithQuests.totalXp + xp.amount,
        badges,
        collection,
        streak,
      },
      cards,
      hooks: progress.hooks,
      reviewLogs,
      sessionLogs: progress.sessionLogs,
    };
    // (i) Persistance immédiate : troncatures déjà appliquées, `savedAt`
    // tamponné par l'horloge injectée dans `repository.save`.
    const savedProgress = repository.save(updatedProgress);
    runs.set(input.sessionId, { state: nextSession, productionXp: run.productionXp });

    // (j) Sortie explicite. Le feedback d'un prétest n'est jamais affiché
    // (L18 : l'UI filtre par `answer.isPretest`) ; la structure est fournie car
    // le contrat de sortie est non nullable.
    return {
      session: nextSession,
      answer,
      feedback:
        feedback ??
        ({
          correct: answer.isCorrect,
          expectedAnswer: item.expectedAnswer,
          mentalImage: item.mentalImage,
          errorSignal: answer.isCorrect ? 'none' : 'wrong-question',
          messageKey: answer.isCorrect
            ? 'session.feedback.correct'
            : 'session.feedback.wrongQuestion',
        } satisfies AnswerFeedback),
      scheduledReview,
      xp,
      newlyUnlockedBadges,
      updatedProgress: savedProgress,
      summary: completed ? buildSessionSummary(nextSession, now, run.productionXp) : null,
      // (k) Échec d'écriture non fatal : reporté pour l'avertissement UI
      // (§ 5.4), jamais lancé — l'état mémoire reste la référence.
      writeFailure: repository.lastWriteFailure(),
    };
  }

  /* ── 3. finishSession ─────────────────────────────────────────────────── */

  function finishSession(input: FinishSessionInput): FinishSessionOutput {
    const run = requireRun(input.sessionId);
    // L17 : `endedAt` **et** `window` sont déduits de l'horloge injectée (jamais
    // de `Date`, jamais d'heure fabriquée par le domaine). Les champs homonymes
    // de l'entrée sont acceptés pour compatibilité contractuelle mais
    // supplantés : `ClockPort` est la source unique de temps.
    const endedAt = services.clock.now();
    const window = resolveSessionWindow(services.clock, endedAt);
    const summary = buildSessionSummary(run.state, endedAt, run.productionXp);
    const tally = tallySession(run.state);
    const xp = xpCalculator.forSession(
      {
        sessionId: input.sessionId,
        itemCount: tally.itemCount,
        productionCount: tally.productionCount,
        correctCount: tally.correctCount,
      },
      { rules: XP_RULES, sameDayAnswersForQuestion: 0, isFirstExposure: false, now: endedAt },
    );
    const sessionLog: SessionLog = {
      sessionId: input.sessionId,
      mode: run.state.plan.mode,
      planSeed: run.state.plan.seed,
      startedAt: run.state.startedAt,
      endedAt,
      durationMs: endedAt - run.state.startedAt,
      window,
      itemCount: tally.itemCount,
      productionCount: tally.productionCount,
      discriminationCount: tally.discriminationCount,
      spokenCount: tally.spokenCount,
      correctCount: tally.correctCount,
      accuracy: tally.accuracy,
      xpAwarded: run.productionXp,
    };
    const progress = repository.requireProgress();
    const savedProgress = repository.save({
      ...progress,
      player: { ...progress.player, totalXp: progress.player.totalXp + xp.amount },
      sessionLogs: [...progress.sessionLogs, sessionLog].slice(-MAX_SESSION_LOG_ENTRIES),
    });
    runs.delete(input.sessionId);
    return {
      summary,
      xp,
      updatedProgress: savedProgress,
      writeFailure: repository.lastWriteFailure(),
    };
  }

  /* ── 4. saveHook ──────────────────────────────────────────────────────── */

  function saveHook(input: SaveHookInput): SaveHookOutput {
    const progress = repository.requireProgress();
    const now = services.clock.now();
    const result = upsertHook(
      progress.hooks,
      { questionId: input.questionId, kind: input.kind, text: input.text },
      now,
    );
    if (!result.ok) {
      throw new UseCaseRejection(
        'hook-refused',
        { kind: 'hook', error: result.error },
        `Accroche refusée : ${result.error.code}`,
      );
    }
    const savedProgress = repository.save({ ...progress, hooks: result.library });
    return {
      hook: result.hook,
      updatedProgress: savedProgress,
      writeFailure: repository.lastWriteFailure(),
    };
  }

  /* ── 5. importProgress ────────────────────────────────────────────────── */

  function importProgress(input: ImportProgressInput): ImportProgressOutput {
    // Une donnée `future-version` ne peut être ni écrite ni remplacée (Phase 1)
    // : l'import reste bloqué tant que l'app n'a pas été mise à jour.
    const loaded = repository.ensureLoaded();
    if (loaded.status === 'blocked' && loaded.error.code === 'future-version') {
      throw new UseCaseRejection(
        'progress-protected',
        { kind: 'progress', error: loaded.error },
        'Progression d’une version future : import interdit (mettre à jour l’application).',
      );
    }
    const result = codec.fromExport(input.raw);
    if (!result.ok) {
      return result;
    }
    const savedProgress = repository.save(result.progress);
    return { ok: true, progress: savedProgress, migratedFrom: result.migratedFrom };
  }

  /* ── 6. exportProgress ────────────────────────────────────────────────── */

  function exportProgress(): ExportProgressOutput {
    const progress = repository.requireProgress();
    const now = services.clock.now();
    const envelope = codec.toExport(progress, now);
    return {
      filename: `aron36-progress-${services.clock.dayKey(now)}.json`,
      json: JSON.stringify(envelope),
    };
  }

  /* ── 7. resetProgress ─────────────────────────────────────────────────── */

  function resetProgress(): ResetProgressOutput {
    const loaded = repository.ensureLoaded();
    if (loaded.status === 'blocked' && loaded.error.code === 'future-version') {
      // Table de décision gelée : `future-version` n'autorise **aucune**
      // écriture, réinitialisation comprise (sinon une donnée lisible par une
      // version plus récente de l'app serait détruite).
      throw new UseCaseRejection(
        'progress-protected',
        { kind: 'progress', error: loaded.error },
        'Progression d’une version future : réinitialisation interdite.',
      );
    }
    repository.backupCorruptRaw();
    const locale =
      loaded.status === 'ready' ? loaded.progress.player.settings.locale : ('fr' as const);
    const savedProgress = repository.save(createInitialProgress(services, locale));
    return { progress: savedProgress, writeFailure: repository.lastWriteFailure() };
  }

  /* ── 8. updateSettings ────────────────────────────────────────────────── */

  function updateSettings(input: UpdateSettingsInput): UpdateSettingsOutput {
    const progress = repository.requireProgress();
    // Fusion partielle : les champs absents du patch gardent leur valeur.
    const settings: PlayerSettings = { ...progress.player.settings, ...input.settings };
    const savedProgress = repository.save({
      ...progress,
      player: { ...progress.player, settings },
    });
    return { progress: savedProgress, writeFailure: repository.lastWriteFailure() };
  }

  /* ── 9. evaluateMastery ───────────────────────────────────────────────── */

  function evaluateMastery(): EvaluateMasteryOutput {
    const progress = repository.requireProgress();
    return {
      mastery: evaluateMasterySnapshot(progress.cards, progress.reviewLogs, services.clock.now()),
    };
  }

  /* ── Helpers liés aux services ────────────────────────────────────────── */

  function transitionRefused(failure: 'wrong-phase' | 'confidence-required'): UseCaseRejection {
    return new UseCaseRejection(
      'session-transition-refused',
      { kind: 'transition', failure },
      `Transition de session refusée : ${failure}`,
    );
  }

  /** Journaux du jour pour une question (compteur anti-farm de l'XP). */
  function countSameDayAnswers(
    reviewLogs: PersistedProgress['reviewLogs'],
    questionId: QuestionId,
    today: DayKey,
  ): number {
    return reviewLogs.filter(
      (log) => log.questionId === questionId && services.clock.dayKey(log.reviewedAt) === today,
    ).length;
  }

  /** Productions réussies du jour (validation de la série, L17). */
  function countQualifyingProductionsToday(
    reviewLogs: PersistedProgress['reviewLogs'],
    today: DayKey,
  ): number {
    return reviewLogs.filter(
      (log) =>
        log.exerciseKind === 'production' &&
        log.grade !== 'again' &&
        services.clock.dayKey(log.reviewedAt) === today,
    ).length;
  }

  /** Jours civils écoulés depuis la dernière validation, via `ClockPort`. */
  function daysSince(lastActiveDay: string | null, today: DayKey): number | null {
    if (lastActiveDay === null) {
      return null;
    }
    const delta =
      services.clock.startOfLocalDay(today) - services.clock.startOfLocalDay(lastActiveDay);
    // `Math.round` absorbe les jours de 23/25 h (transition horaire).
    return Math.round(delta / 86_400_000);
  }

  /** (Re)génère puis progresse le tableau de quêtes du jour. */
  function advanceQuestBoard(
    player: PlayerState,
    dayKey: DayKey,
    input: QuestProgressInput,
  ): QuestBoard {
    const previous = player.questBoard;
    const board =
      previous === null || previous.dayKey !== dayKey
        ? questGenerator.boardFor({
            dayKey,
            seed: services.newSeed(),
            definitions: QUEST_DEFINITIONS,
            recentQuestIds: previous?.quests.map((quest) => quest.questId) ?? [],
          })
        : previous;
    return questGenerator.progress(board, QUEST_DEFINITIONS, input);
  }

  return {
    startSession: { execute: startSession },
    submitAnswer: { execute: submitAnswer },
    finishSession: { execute: finishSession },
    saveHook: { execute: saveHook },
    importProgress: { execute: importProgress },
    exportProgress: { execute: exportProgress },
    resetProgress: { execute: resetProgress },
    updateSettings: { execute: updateSettings },
    evaluateMastery: { execute: evaluateMastery },
  };
}

/* ── Helpers purs, hors fermeture ─────────────────────────────────────────── */

/** `Readonly<Record<string, CardState>>` → map indexée par question. */
function cardsMap(cards: PersistedProgress['cards']): ReadonlyMap<QuestionId, CardState> {
  const map = new Map<QuestionId, CardState>();
  for (const card of Object.values(cards)) {
    map.set(card.questionId, card);
  }
  return map;
}

/** Maîtrise d'une question dans un instantané ; neutre si la carte manque. */
function masteryOf(snapshot: MasterySnapshot, questionId: QuestionId): QuestionMastery {
  for (const act of snapshot.acts) {
    const found = act.questions.find((question) => question.questionId === questionId);
    if (found !== undefined) {
      return found;
    }
  }
  return {
    questionId,
    cardMastered: false,
    directions: [],
    distinctDirections: 0,
    mastered: false,
  };
}

/** Toutes les maîtrises par question d'un instantané, actes dans l'ordre. */
function flattenQuestions(snapshot: MasterySnapshot): readonly QuestionMastery[] {
  return snapshot.acts.flatMap((act) => act.questions);
}

/**
 * `XpContext.isFirstExposure` : « jamais produite avec succès auparavant » —
 * productions uniquement (un QCM n'est pas une production).
 */
function isFirstSuccessfulProduction(
  reviewLogs: PersistedProgress['reviewLogs'],
  questionId: QuestionId,
): boolean {
  return !reviewLogs.some(
    (log) =>
      log.questionId === questionId && log.exerciseKind === 'production' && log.grade !== 'again',
  );
}

/** Gain nul explicite pour une devinette de prétest (L18). */
function zeroAnswerXp(questionId: QuestionId, now: EpochMs): XpAward {
  return {
    amount: 0,
    reason: 'production-answer',
    breakdown: {
      base: 0,
      gradeAdjusted: 0,
      firstExposureBonus: 0,
      noHintBonus: 0,
      speedBonus: 0,
      antiFarmFactor: 1,
      total: 0,
    },
    questionId,
    at: now,
  };
}

/** Meilleur Grand Oral mesuré : précision maximale, puis durée minimale. */
function bestOralExamOf(
  sessionLogs: PersistedProgress['sessionLogs'],
): { readonly durationMs: number; readonly accuracy: number } | null {
  const orals = sessionLogs
    .filter((log) => log.mode === 'grand-oral')
    .map((log) => ({ durationMs: log.durationMs, accuracy: log.accuracy }));
  if (orals.length === 0) {
    return null;
  }
  return orals.reduce((best, candidate) =>
    candidate.accuracy > best.accuracy ||
    (candidate.accuracy === best.accuracy && candidate.durationMs < best.durationMs)
      ? candidate
      : best,
  );
}
