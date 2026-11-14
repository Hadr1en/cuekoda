import type { AnalysisResult } from './types';

/**
 * Duplicate detection. Never deletes anything: it only groups files so the DJ can compare.
 *  - exact     : identical content (SHA-256), whatever the name / folder
 *  - encoding  : probably the same recording in another format / bitrate (duration, tempo, key and
 *                energy curve match) — an acoustic comparison based on the analysis, not on the bytes
 *  - version   : same base title (remix, edit, extended mix …) — related, NOT duplicates
 */
export type DuplicateKind = 'exact' | 'encoding' | 'version';

export interface DuplicateGroup {
  kind: DuplicateKind;
  reason: string;
  paths: string[];
}

const VERSION_WORDS =
  /\b(original|extended|radio|club|vip|dub|instrumental|acapella|a cappella|remix|edit|mix|rework|bootleg|version|remaster(ed)?|re-?edit|flip)\b/gi;

export function baseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[([][^)\]]*[)\]]/g, ' ') // (Extended Mix), [VIP]
    // "Title - Some Remix": only cut the dash part when it names a version (not "Artist - Title")
    .replace(/\s-\s([^-]*)$/, (m, tail: string) => (new RegExp(VERSION_WORDS.source, 'i').test(tail) ? ' ' : m))
    .replace(/\bfeat\.?.*$/, ' ')
    .replace(VERSION_WORDS, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resample(a: number[], n: number): number[] {
  if (!a.length) return new Array(n).fill(0);
  return Array.from({ length: n }, (_, i) => a[Math.min(a.length - 1, Math.floor((i / n) * a.length))]);
}

export function correlation(a: number[], b: number[]): number {
  const n = 64;
  const x = resample(a, n);
  const y = resample(b, n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

export function findDuplicates(tracks: AnalysisResult[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const inGroup = new Set<string>();

  // exact (content hash)
  const byHash = new Map<string, string[]>();
  for (const t of tracks) if (t.fileHash) byHash.set(t.fileHash, [...(byHash.get(t.fileHash) ?? []), t.path]);
  for (const paths of byHash.values()) {
    if (paths.length < 2) continue;
    groups.push({ kind: 'exact', reason: 'Contenu identique (même empreinte SHA-256)', paths });
    paths.slice(1).forEach((p) => inGroup.add(p));
  }

  const pool = tracks.filter((t) => !inGroup.has(t.path));
  // same recording, different encoding
  const used = new Set<string>();
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i];
    if (used.has(a.path)) continue;
    const members = [a.path];
    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j];
      if (used.has(b.path) || a.fileHash === b.fileHash) continue;
      if (Math.abs(a.durationSec - b.durationSec) > 1) continue;
      if (Math.abs(a.bpm - b.bpm) > 0.1 || a.key.camelot !== b.key.camelot) continue;
      if (!a.energy || !b.energy || correlation(a.energy.curve, b.energy.curve) < 0.97) continue;
      members.push(b.path);
      used.add(b.path);
    }
    if (members.length > 1) {
      used.add(a.path);
      groups.push({
        kind: 'encoding',
        reason: 'Même durée, tempo, tonalité et courbe d’énergie : probablement le même enregistrement dans un autre encodage',
        paths: members,
      });
    }
  }

  // related versions (same base title, different durations / structure)
  const byTitle = new Map<string, string[]>();
  for (const t of tracks) {
    const k = baseTitle(t.title);
    if (k.length < 2) continue;
    byTitle.set(k, [...(byTitle.get(k) ?? []), t.path]);
  }
  for (const [k, paths] of byTitle) {
    const distinct = paths.filter((p) => !groups.some((g) => g.kind !== 'version' && g.paths.includes(p) && g.paths[0] !== p));
    if (distinct.length < 2) continue;
    groups.push({
      kind: 'version',
      reason: `Même titre de base « ${k} » : versions liées (remix, edit, extended…) — pas des doublons à supprimer`,
      paths: distinct,
    });
  }
  return groups;
}
