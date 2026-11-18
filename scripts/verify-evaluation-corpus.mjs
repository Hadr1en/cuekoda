import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const [id, targetArg] = process.argv.slice(2);
if (!id || !targetArg) {
  console.error('Usage : npm run corpora:verify -- <id> <archive-ou-depot>');
  process.exit(2);
}
const registry = JSON.parse(readFileSync(new URL('./evaluation-corpora.json', import.meta.url), 'utf8'));
const corpus = registry.corpora.find((entry) => entry.id === id);
if (!corpus) throw new Error(`Corpus inconnu : ${id}`);
const target = resolve(targetArg);
const stat = statSync(target);
if (stat.isDirectory()) {
  if (!corpus.revision) throw new Error(`${id} n'a pas de révision Git enregistrée`);
  const actual = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== corpus.revision) throw new Error(`${id} : révision ${actual}, attendu ${corpus.revision}`);
  console.log(`${id} : révision officielle vérifiée (${actual})`);
} else {
  const expected = corpus.archiveMd5 ?? corpus.audioSha256 ?? corpus.annotationsMd5 ?? corpus.audioMd5;
  if (!expected) throw new Error(`${id} n'a pas de somme d'archive enregistrée`);
  const algorithm = expected.length === 32 ? 'md5' : 'sha256';
  const hash = createHash(algorithm);
  await new Promise((accept, reject) => createReadStream(target).on('data', (chunk) => hash.update(chunk)).on('end', accept).on('error', reject));
  const actual = hash.digest('hex');
  if (actual !== expected.toLowerCase()) throw new Error(`${id} : ${algorithm} ${actual}, attendu ${expected}`);
  console.log(`${id} : archive officielle vérifiée (${algorithm} ${actual})`);
}
