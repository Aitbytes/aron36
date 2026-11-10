#!/usr/bin/env node
/**
 * Traçabilité apprentissage → code (Phase 2).
 *
 * Ce script relie chaque mécanisme d'apprentissage de `docs/PLAN.md` aux modules
 * réels et aux **intitulés exacts** des tests qui le prouvent, puis écrit
 * `docs/TRACEABILITY.md`.
 *
 * Règles :
 * - aucune dépendance : Node seul, ESM ;
 * - les intitulés proviennent des fichiers de test `*.test.ts` et
 *   `*.test.tsx` réellement présents sous `src/` (fichiers `.skip.` et blocs
 *   `it.skip`/`test.todo` exclus) ;
 * - un mécanisme `implemented` sans test correspondant fait échouer le script
 *   (`exit 1`) : c'est le garde-fou anti-« traçabilité décorative » ;
 * - `--check` régénère en mémoire et compare au fichier committé, sans écrire.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MECHANISMS } from './traceability.mapping.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(ROOT, 'src');
const OUTPUT = join(ROOT, 'docs', 'TRACEABILITY.md');
const IS_CHECK = process.argv.includes('--check');

const TEST_FILE = /\.test\.(?:ts|tsx)$/;
const SKIPPED_FILE = /\.skip\./;
const STATUSES = ['implemented', 'partial', 'deferred-phase-3'];
const CONTEXT_LINES = 3;

/** Liste récursivement les fichiers de test, en ignorant les `.skip.`. */
function collectTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        continue;
      }
      found.push(...collectTestFiles(full));
    } else if (TEST_FILE.test(entry.name) && !SKIPPED_FILE.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Lit la chaîne littérale qui commence au caractère `start` (guillemet simple,
 * double ou backtick) et renvoie sa valeur et l'index de fin. `null` si la
 * chaîne n'est pas refermée sur la ligne.
 */
function readQuoted(line, start) {
  const quote = line[start];
  const escapes = { n: '\n', t: '\t', r: '\r', "'": "'", '"': '"', '`': '`', '\\': '\\' };
  let value = '';
  let index = start + 1;
  while (index < line.length) {
    const char = line[index];
    if (char === '\\') {
      const next = line[index + 1];
      if (next === undefined) {
        index += 1;
        continue;
      }
      value += escapes[next] ?? next;
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value, end: index + 1 };
    }
    value += char;
    index += 1;
  }
  return null;
}

/**
 * Extrait les intitulés de `describe`, `it` et `test` d'un fichier de test.
 *
 * La pile des `describe` est reconstruite par indentation (hypothèse : les
 * déclarations sont sur une seule ligne, sans décalage exotique). Les blocs
 * `it.skip`, `test.skip` et `test.todo` sont ignorés : ils ne s'exécutent pas
 * et ne peuvent donc pas prouver quoi que ce soit.
 */
function extractTitles(content) {
  const titles = [];
  const stack = [];
  const declaration = /^(\s*)(describe|it|test)(?:\.([A-Za-z]+))?\s*\(\s*(['"`])/;

  for (const line of content.split(/\r?\n/)) {
    const match = declaration.exec(line);
    if (match === null) {
      continue;
    }
    const indent = match[1].length;
    const kind = match[2];
    const modifier = match[3] ?? null;
    const parsed = readQuoted(line, match.index + match[0].length - 1);
    if (parsed === null) {
      continue;
    }
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (kind === 'describe') {
      stack.push({ indent, title: parsed.value });
      continue;
    }
    if (modifier === 'skip' || modifier === 'todo' || modifier === 'each') {
      continue;
    }
    titles.push({ describe: stack.map((entry) => entry.title), title: parsed.value });
  }
  return titles;
}

/** Chemin relatif à la racine du dépôt, séparateurs POSIX. */
function toPosix(path) {
  return relative(ROOT, path).split(sep).join('/');
}

/** Échappe le contenu d'une cellule de tableau Markdown. */
function cell(value) {
  return String(value).replace(/\|/g, '\\|');
}

/**
 * Rend un tableau Markdown au format exact de Prettier (colonnes alignées sur
 * la largeur maximale, séparateur d'au moins trois tirets).
 */
function renderTable(headers, rows) {
  const grid = [headers, ...rows].map((row) => row.map(cell));
  const widths = headers.map((_, column) => Math.max(3, ...grid.map((row) => row[column].length)));
  const renderRow = (row) => `| ${row.map((value, i) => value.padEnd(widths[i])).join(' | ')} |`;
  const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return [renderRow(grid[0]), separator, ...grid.slice(1).map(renderRow)].join('\n');
}

/** Ligne de preuve affichée dans la dernière colonne. */
/**
 * Un test ne prouve un mécanisme que s'il vit dans **l'un de ses modules**.
 *
 * Sans ce filtre, n'importe quel test dont l'intitulé contient « direction »
 * « prouvait » L16 depuis un écran d'interface — un faux positif qui rendait la
 * traçabilité complaisante. Le champ `modules` de la table de correspondance
 * était décoratif ; il devient contraignant.
 */
function isInModule(file, module) {
  const normalized = file.replaceAll('\\', '/');
  if (module === 'application') {
    return normalized.includes('src/application/');
  }
  return (
    normalized.includes(`/domain/${module}/`) ||
    normalized.includes(`/application/${module}/`) ||
    normalized.includes(`/infrastructure/${module}/`)
  );
}

function renderEvidence(matches) {
  if (matches.length === 0) {
    return '—';
  }
  return matches.map((test) => `\`${test.file}\` › « ${test.name} »`).join('<br>');
}

/** Document complet `docs/TRACEABILITY.md`. */
function renderDocument(mechanisms) {
  const byStatus = new Map(STATUSES.map((status) => [status, []]));
  for (const mechanism of mechanisms) {
    byStatus.get(mechanism.status).push(mechanism.id);
  }
  const summaryRows = STATUSES.map((status) => [
    `\`${status}\``,
    String(byStatus.get(status).length),
    byStatus
      .get(status)
      .map((id) => `\`${id}\``)
      .join(', ') || '—',
  ]);

  const sections = mechanisms.map((mechanism) => {
    const table = renderTable(
      ['Mécanisme', 'Module', 'Interface (fichier)', 'Statut', 'Tests qui le prouvent (nom réel)'],
      [
        [
          `**${mechanism.id}** ${mechanism.name}`,
          mechanism.modules.map((module) => `\`${module}\``).join(', '),
          mechanism.interfaces.map((file) => `\`${file}\``).join('<br>'),
          `\`${mechanism.status}\``,
          renderEvidence(mechanism.matches),
        ],
      ],
    );
    return `### ${mechanism.id} — ${mechanism.name}\n\n${table}`;
  });

  return [
    '# Traçabilité apprentissage → code',
    '',
    '> Document **généré** par `npm run traceability` — ne jamais l’éditer à la main.',
    '',
    'Chaque mécanisme de `docs/PLAN.md` (§ 2) est relié à ses modules, à ses',
    'interfaces réelles et aux **intitulés exacts** des tests qui le prouvent. La CI',
    'exécute `npm run traceability:check` : le fichier committé doit correspondre à',
    'ce que produisent les tests, et un mécanisme `implemented` sans test casse le',
    'build.',
    '',
    '## Synthèse',
    '',
    renderTable(['Statut', 'Nombre', 'Mécanismes'], summaryRows),
    '',
    '## Mécanismes',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
}

/** Construit la liste ordonnée des états (opérations) d'un diff ligne à ligne. */
function buildOperations(before, after) {
  const rows = before.length;
  const columns = after.length;
  const lcs = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const operations = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      operations.push({ kind: 'equal', text: before[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      operations.push({ kind: 'remove', text: before[i] });
      i += 1;
    } else {
      operations.push({ kind: 'add', text: after[j] });
      j += 1;
    }
  }
  while (i < rows) {
    operations.push({ kind: 'remove', text: before[i] });
    i += 1;
  }
  while (j < columns) {
    operations.push({ kind: 'add', text: after[j] });
    j += 1;
  }
  return operations;
}

/** Rend un diff lisible, avec trois lignes de contexte autour des changements. */
function renderDiff(beforeText, afterText) {
  const operations = buildOperations(beforeText.split('\n'), afterText.split('\n'));
  const keep = new Array(operations.length).fill(false);
  operations.forEach((operation, index) => {
    if (operation.kind === 'equal') {
      return;
    }
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(operations.length - 1, index + CONTEXT_LINES);
    for (let cursor = from; cursor <= to; cursor += 1) {
      keep[cursor] = true;
    }
  });

  const lines = [];
  let index = 0;
  while (index < operations.length) {
    if (!keep[index]) {
      let end = index;
      while (end < operations.length && !keep[end]) {
        end += 1;
      }
      lines.push(`@@ ${end - index} ligne(s) commune(s) @@`);
      index = end;
      continue;
    }
    const { kind, text } = operations[index];
    const prefix = kind === 'equal' ? '  ' : kind === 'remove' ? '- ' : '+ ';
    lines.push(`${prefix}${text}`);
    index += 1;
  }
  return lines.join('\n');
}

const ordered = [...MECHANISMS].sort(
  (left, right) => Number(left.id.slice(1)) - Number(right.id.slice(1)),
);

const tests = [];
for (const file of collectTestFiles(SRC_DIR).sort()) {
  const relativePath = toPosix(file);
  for (const { describe, title } of extractTitles(readFileSync(file, 'utf8'))) {
    tests.push({ file: relativePath, name: [...describe, title].join(' › ') });
  }
}

const resolved = ordered.map((mechanism) => ({
  ...mechanism,
  matches: tests.filter(
    (test) =>
      mechanism.modules.some((module) => isInModule(test.file, module)) &&
      mechanism.tests.some((pattern) => pattern.test(test.name)),
  ),
}));

const problems = [];
const seenIds = new Set();
for (const mechanism of resolved) {
  if (seenIds.has(mechanism.id)) {
    problems.push(`identifiant dupliqué : ${mechanism.id}`);
  }
  seenIds.add(mechanism.id);
  if (!STATUSES.includes(mechanism.status)) {
    problems.push(`${mechanism.id} : statut inconnu « ${mechanism.status} »`);
  }
  for (const file of mechanism.interfaces) {
    if (!existsSync(join(ROOT, file))) {
      problems.push(`${mechanism.id} : interface introuvable « ${file} »`);
    }
  }
  if (mechanism.status === 'implemented' && mechanism.matches.length === 0) {
    problems.push(
      `${mechanism.id} (${mechanism.name}) est « implemented » mais aucun test ne le prouve`,
    );
  }
}

if (problems.length > 0) {
  console.error('Traçabilité invalide :\n');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error('\nCorrige le mapping ou ajoute le test réel ; n’invente aucun test.');
  process.exit(1);
}

const generated = renderDocument(resolved);

if (IS_CHECK) {
  if (!existsSync(OUTPUT)) {
    console.error('docs/TRACEABILITY.md est absent : lance `npm run traceability`.');
    process.exit(1);
  }
  const committed = readFileSync(OUTPUT, 'utf8');
  if (committed === generated) {
    console.log(
      `docs/TRACEABILITY.md est à jour (${resolved.length} mécanismes, ${tests.length} tests).`,
    );
    process.exit(0);
  }
  console.error('docs/TRACEABILITY.md est périmé ou dérive des tests réels.\n');
  console.error('--- docs/TRACEABILITY.md (committé)');
  console.error('+++ docs/TRACEABILITY.md (généré)');
  console.error(renderDiff(committed, generated));
  console.error('\nLance `npm run traceability` et committe le résultat.');
  process.exit(1);
}

writeFileSync(OUTPUT, generated);
console.log(
  `docs/TRACEABILITY.md régénéré : ${resolved.length} mécanismes, ${tests.length} tests lus.`,
);
