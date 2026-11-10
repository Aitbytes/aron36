#!/usr/bin/env node
/**
 * Régénère les PNG d'icônes de la PWA depuis les sources SVG.
 *
 * Les PNG committés dans `public/icons/` sont des **artefacts** : le manifeste
 * les référence, le service worker les précache. Ce script existe pour qu'on
 * puisse les reproduire (changement de marque, ajout d'une taille) sans source
 * binaire unique ni outil propriétaire.
 *
 * Aucune dépendance npm : on pilote ImageMagick (`magick`, ou `convert` sur les
 * versions 6) via `spawnSync`. S'il est absent, le script s'arrête avec un code
 * non nul et un message explicite — il n'est **pas** branché sur `npm run build`
 * pour que la CI n'exige pas ImageMagick.
 *
 * Usage : `node scripts/build-icons.mjs`
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ICONS_DIR = join(ROOT, 'public', 'icons');

/** Source SVG et tailles à produire (une entrée par PNG committé). */
const TARGETS = [
  { source: 'aron36.svg', output: 'icon-192.png', size: 192 },
  { source: 'aron36.svg', output: 'icon-512.png', size: 512 },
  { source: 'aron36-maskable.svg', output: 'maskable-512.png', size: 512 },
  // iOS applique lui-même son masque : fond plein cadre, marque à l'échelle 1.
  { source: 'aron36-square.svg', output: 'apple-touch-icon.png', size: 180 },
];

/** Première commande ImageMagick disponible sur la machine, sinon `null`. */
function findImageMagick() {
  for (const command of ['magick', 'convert']) {
    const probe = spawnSync(command, ['-version'], { encoding: 'utf8' });
    if (probe.status === 0) {
      return command;
    }
  }
  return null;
}

const binary = findImageMagick();
if (binary === null) {
  console.error(
    'ImageMagick introuvable (`magick` ou `convert`) : les PNG de public/icons/ restent inchangés.',
  );
  process.exit(1);
}

mkdirSync(ICONS_DIR, { recursive: true });

for (const { source, output, size } of TARGETS) {
  const sourcePath = join(ICONS_DIR, source);
  const outputPath = join(ICONS_DIR, output);
  if (!existsSync(sourcePath)) {
    console.error(`Source absente : public/icons/${source}`);
    process.exit(1);
  }
  // `-background none` **avant** l'entrée : c'est un réglage d'image appliqué au
  // fichier lu ensuite. Placé après, le rendu SVG resterait aplati sur du blanc
  // et les coins arrondis de l'icône deviendraient opaques.
  const result = spawnSync(
    binary,
    ['-background', 'none', sourcePath, '-resize', `${size}x${size}`, outputPath],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(`Échec de la génération de public/icons/${output} :\n${result.stderr}`);
    process.exit(1);
  }
  console.log(`public/icons/${output} (${size}×${size})`);
}
