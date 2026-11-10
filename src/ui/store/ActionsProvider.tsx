import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import type { UseCases } from '@/application/usecases';
import { useT } from '@/i18n';
import { useToast } from '@/ui/primitives';

import { ActionsContext } from './ActionsContext';
import { createAppActions } from './appActions';
import type { ActionNotification, AppActions } from './appActions';
import { useDispatch } from './StoreContext';

export interface ActionsProviderProps {
  readonly useCases: UseCases;
  readonly children: ReactNode;
}

/**
 * Construit et fournit `AppActions` (cas d'usage + store + notifications).
 *
 * L'objet est mémoïsé : sa référence ne change qu'avec les cas d'usage, le
 * dispatch, le traducteur ou l'API de notification. Les effets de bord
 * (écriture ratée, import, réinitialisation) sont signalés par un toast, jamais
 * perdus silencieusement.
 */
export function ActionsProvider({ useCases, children }: ActionsProviderProps) {
  const dispatch = useDispatch();
  const t = useT();
  const toast = useToast();

  const notify = useCallback(
    (notification: ActionNotification): void => {
      toast.show({
        tone: notification.tone,
        title: notification.title,
        body: notification.body ?? undefined,
      });
    },
    [toast],
  );

  const actions = useMemo<AppActions>(
    () => createAppActions({ useCases, dispatch, notify, t }),
    [useCases, dispatch, notify, t],
  );

  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}
