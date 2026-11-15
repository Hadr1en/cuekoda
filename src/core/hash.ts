import { createHash } from 'node:crypto';
import { createReadStream, type BigIntStats } from 'node:fs';
import { stat } from 'node:fs/promises';

/** SHA-256 of a file's content (streamed): cache key and exact-duplicate detector. */
export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

export interface AudioRevision {
  fileHash: string;
  stat: BigIntStats;
}

/** Protect the hash, decoded audio and any cache entry from coming from different file revisions. */
export async function assertAudioRevision(file: string, expected: AudioRevision): Promise<void> {
  const actual = await stat(file, { bigint: true });
  const previous = expected.stat;
  if (actual.size !== previous.size || actual.mtimeNs !== previous.mtimeNs || actual.ctimeNs !== previous.ctimeNs
    || actual.ino !== previous.ino || actual.dev !== previous.dev) {
    throw new Error('Le fichier audio a changé pendant l’analyse. Relancez l’analyse.');
  }
}

export async function hashAudioRevision(file: string, before?: BigIntStats): Promise<AudioRevision> {
  const initial = before ?? await stat(file, { bigint: true });
  const revision = { stat: initial, fileHash: await hashFile(file) };
  await assertAudioRevision(file, revision);
  return revision;
}
