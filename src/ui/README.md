# UI — socle de la Phase 4-A

Le socle livré ici est l'**API stable** contre laquelle les trois lots suivants
(écran de jeu, carte de progression, tableau de bord) sont développés.

## Règle de couche

- **Aucune logique métier dans `src/ui/**`** : l'UI ne calcule ni XP, ni série,
  ni maîtrise, ni intervalle. Elle lit des sélecteurs (`@/application/store`) et
  agit par `useActions()`.
- Les écrans ne voient **jamais** `UseCases`, le dépôt, ni `@/infrastructure/*`.
- Aucune chaîne visible en dur : tout passe par `useT()` (`@/i18n`).
- Aucune couleur en dur : uniquement les tokens de `src/styles/tokens.css`.

## Surface d'action — `useActions()`

`src/ui/store/appActions.ts` définit `AppActions` : appel d'un cas d'usage,
dispatch de l'action de store correspondante, issue explicite, et notification
obligatoire d'une écriture ratée (`writeFailure`).

```ts
const actions = useActions();

const outcome = actions.startSession({ mode: 'review' });
if (!outcome.ok) {
  // outcome.reason : raison stable, traduisible par ACTION_FAILURE_MESSAGE_KEYS
  // outcome.error  : ProgressError | null
}
// outcome.ok === true → outcome.value (sortie du cas d'usage), outcome.warning
```

| Action | Entrée → sortie | Action de store dispatchée |
| --- | --- | --- |
| `navigate(screen)` | `AppScreen` | `ui/navigate` |
| `selectAct(actId)` | `ActId \| null` | `ui/act-selected` |
| `dismissFeedback()` | — | `ui/feedback-dismissed` |
| `setBusy(busy)` | `boolean` | `ui/busy-changed` |
| `startSession(input)` | `StartSessionInput` → `StartSessionOutput` | `session/started` |
| `submitAnswer(input)` | `SubmitAnswerInput` → `SubmitAnswerOutput` | `session/answered` |
| `revealHint(sessionId)` | `SessionId` → `RevealHintOutput` | `session/hint-revealed` |
| `revealAnswer(sessionId)` | `SessionId` → `RevealAnswerOutput` | `session/hint-revealed` |
| `finishSession(sessionId)` | `SessionId` → `FinishSessionOutput` | `session/completed` |
| `abandonSession(sessionId)` | `SessionId` → `AbandonSessionOutput` | `session/abandoned` |
| `saveHook(input)` | `SaveHookInput` → `SaveHookOutput` | `hooks/saved` |
| `updateSettings(input)` | `UpdateSettingsInput` → `UpdateSettingsOutput` | `settings/updated` |
| `importProgress(input)` | `ImportProgressInput` → `PersistedProgress` | `progress/replaced` |
| `exportProgress()` | — → `ExportProgressOutput` | — (données renvoyées) |
| `resetProgress()` | — → `ResetProgressOutput` | `progress/reset` |
| `evaluateMastery()` | — → `MasterySnapshot` | — (lecture déléguée) |

`revealHint` et `revealAnswer` partagent `session/hint-revealed` : c'est la seule
action de store (gelée en Phase 3) qui remplace un `SessionState` sans le
rejouer.

`submitAnswer` **ne clôt pas** la session, même quand la dernière réponse la
termine (`outcome.value.summary !== null`) : l'écran de jeu affiche son bilan,
puis appelle `finishSession(sessionId)`, qui dispatche `session/completed` et
ramène l'interface à l'accueil. `outcome.value.summary` est donc la seule source
du bilan — `AppState` ne porte pas de résumé.

## Autres hooks

- `useAppState()` — état complet, via `useSyncExternalStore`.
- `useSelect(selector)` — sélecteur ; un sélecteur paramétré se compose avec
  `useSelect(useCallback((state) => selectDueCount(state, clock.now()), [clock]))`.
- `useDispatch()` — dispatch brut, réservé à la couche `store`.
- `useClock()` / `useNow()` — horloge injectée : **jamais** `Date.now()`.
- `useMastery()` — `MasterySnapshot | null`, mémoïsé sur `progress`.
- `useAsyncAction(operation)` — `{ pending, run }`, maintient `ui.busy`.
- `useT()` / `useLocale()` / `useLocalizedText()` — i18n.

## Primitives (`src/ui/primitives`)

`Button` (variantes `primary|secondary|ghost|danger`, tailles, `loading`),
`IconButton` (`label` obligatoire), `Card`, `Panel` (`title`, `titleAs`,
`actions`), `ProgressBar` (`value`, `max`, `label`, `tone`), `Chip`, `Badge`,
`Dialog` (piège de focus, `Échap`, `aria-modal`), `ToastProvider` + `useToast`,
`Spinner`, `Kbd`, `Stack` / `Inline`, `VisuallyHidden`, `cx`.

## Écrans

- **Fonctionnels** : `HomeScreen` (niveau, rang, XP du niveau, série, gels,
  cartes dues, quêtes du jour, prochain acte, démarrage de session, bandeau de
  récupération avec import et double confirmation de réinitialisation),
  `LoadingScreen`.
- **Coquilles honnêtes** (aucune donnée simulée) : `TrainScreen`,
  `CollectionScreen`, `StatsScreen`, `SettingsScreen`.
