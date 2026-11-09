# ADR 0004 — Persistance localStorage versionnée

- **Statut** : accepté
- **Date** : 2026-11-09
- **Phase** : 1

## Contexte

L'application est hors ligne-first, sans compte et sans serveur. La progression
(SRS, XP, séries, badges, quêtes, collection, accroches personnelles) doit
survivre aux rechargements, être exportable et rester lisible après plusieurs
versions du produit. Le prototype v0 stockait deux clés non versionnées
(`aron36.srs`, `aron36.plan`) et écrasait silencieusement les erreurs de parse.

## Décision

- **Une seule clé** : `aron36.progress`, contenant un `PersistedProgress`
  complet et versionné (`schemaVersion: 1`).
- **Agrégat racine unique** : cartes, joueur, accroches, journaux. Les vues
  (niveau, maîtrise, métriques) sont dérivées, jamais persistées.
- **Migrations explicites** `v → v+1` dans un registre ordonné, pures et
  testées avec des fixtures JSON figées.
- **Décodage défensif** : `JSON.parse` + validation de forme + validation des
  invariants. Toute anomalie renvoie un `ProgressError` typé.
- **Aucun écrasement silencieux** : en cas de corruption, la donnée brute est
  recopiée sous `aron36.progress.corrupt.<epochMs>` avant toute action ; l'UI
  propose export, nouvel essai ou réinitialisation avec double confirmation.
- **Export/import JSON** via une enveloppe distincte (`format`,
  `formatVersion`), avec remplacement atomique après validation complète.
- **Rétention** : 5 000 lignes de `ReviewLog`, 500 `SessionLog`.
- **Quota** : l'échec d'écriture est un résultat (`quota-exceeded`), pas une
  exception ; la session continue en mémoire et l'export est proposé.

## Conséquences

- Une seule opération de lecture/écriture simplifie la cohérence et les tests.
- Le schéma est lisible et inspectable dans les DevTools.
- Les migrations sont obligatoires à chaque changement de forme ; oublier une
  migration est détecté par le test de registre et le test de fixture.
- Le volume reste raisonnable (< 1 Mo pour un usage intensif) grâce à la
  rétention ; `localStorage` (~5 Mo) suffit.
- La synchronisation multi-onglets n'est pas gérée en v1 : deux onglets peuvent
  diverger. Un `BroadcastChannel` est envisagé en Phase 5, sans changer le
  format.
- Le format d'export est un contrat public : il doit rester stable et versionné.
- Les données restent sur l'appareil ; aucun risque de fuite serveur, mais
  aucune sauvegarde automatique en cas de nettoyage du navigateur. L'export est
  la sauvegarde officielle.

## Alternatives rejetées

| Alternative                                                | Raison du rejet                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **IndexedDB**                                              | Asynchrone, API verbeuse, surdimensionné pour < 1 Mo ; complique les tests et le déterminisme. |
| **Backend + comptes**                                      | Hors périmètre v1, coût d'exploitation, contradiction avec « sans serveur ».                   |
| **Cookies**                                                | Taille limitée, envoyés à chaque requête, inadaptés à un état riche.                           |
| **Une clé par domaine** (`aron36.cards`, `aron36.player`…) | Transactions partielles, incohérences entre clés, migrations multiples.                        |
| **Sérialisation binaire (MessagePack, CBOR)**              | Gain de taille marginal, perte d'inspectabilité, dépendance supplémentaire.                    |
| **Sauvegarde automatique dans le cloud**                   | Contraire à la promesse de confidentialité et au hors-ligne-first.                             |
| **Écraser les données corrompues**                         | Perte silencieuse inacceptable ; contraire à l'éthique du produit.                             |
