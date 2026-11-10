import { useMemo } from 'react';

import type { MasterySnapshot } from '@/domain/mastery/types';

import { useActions } from './ActionsContext';
import { useSelect } from './StoreContext';

/**
 * Photographie de maîtrise, déléguée au domaine via le cas d'usage.
 *
 * L'UI n'évalue **jamais** la maîtrise elle-même : `evaluateMastery` (pur, sans
 * I/O d'écriture) renvoie l'instantané du domaine, et ce hook le mémoïse sur la
 * référence de `progress`. Le résultat est `null` quand la progression est
 * indisponible (chemin de récupération) : les écrans dégradent l'affichage
 * plutôt que de tomber.
 */
export function useMastery(): MasterySnapshot | null {
  const actions = useActions();
  const progress = useSelect((state) => state.progress);
  return useMemo(
    () => {
      const result = actions.evaluateMastery();
      return result.ok ? result.value : null;
    },
    // Seule la progression peut changer la photographie de maîtrise : sa
    // référence est la clé de mémoïsation, même si le calcul la relit du dépôt
    // (le cas d'usage est la seule porte d'entrée, donc aucun paramètre à passer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, progress],
  );
}
