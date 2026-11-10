Catalogues de messages de l'interface (Phase 4).

- `fr.ts` — catalogue **complet** ; c'est la source de vérité des clés
  (`MessageKey = keyof typeof frMessages`).
- `en.ts` — traduction anglaise typée `Record<MessageKey, string>` : une clé
  manquante ou surnuméraire casse `tsc`.

Le contenu des 36 questions (formulations, mots-clés, images) ne passe **jamais**
par ces catalogues : il vit dans le dataset sous forme de `LocalizedText`.
