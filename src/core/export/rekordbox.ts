import * as path from 'node:path';
import type { AnalysisResult, Loop } from '../types';
import { ENGINE_VERSION } from '../types';
import { commentTag, type ExportOptions } from './index';

export const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** rekordbox wants file://localhost/<url-encoded absolute path> (Windows: file://localhost/C:/...). */
export function rekordboxLocation(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const withSlash = abs.startsWith('/') ? abs : `/${abs}`;
  const encoded = withSlash
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ':'))
    .join('/');
  return `file://localhost${encoded}`;
}

export const exportedLoops = (t: AnalysisResult, mode: ExportOptions['loops']): Loop[] =>
  mode === 'none' ? [] : (t.loops ?? []).filter((l) => mode === 'all' || l.accepted);

/**
 * rekordbox XML collection (File › Import Collection / "rekordbox xml" view).
 *  - hot cues  → POSITION_MARK Type=0 Num=0..7 with Red/Green/Blue
 *  - memory cues (option) → same positions with Num=-1
 *  - loops     → memory loops POSITION_MARK Type=4 Start/End Num=-1
 */
export function buildRekordboxXml(
  tracks: AnalysisResult[],
  opts: ExportOptions = { memoryCues: true, loops: 'accepted' },
  playlistName = 'CueKoda',
): string {
  const today = new Date().toISOString().slice(0, 10);
  const f3 = (v: number) => Math.max(0, v).toFixed(3);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<DJ_PLAYLISTS Version="1.0.0">');
  lines.push(`  <PRODUCT Name="CueKoda" Version="${ENGINE_VERSION}" Company="CueKoda"/>`);
  lines.push(`  <COLLECTION Entries="${tracks.length}">`);
  tracks.forEach((t, i) => {
    const id = i + 1;
    lines.push(
      `    <TRACK TrackID="${id}" Name="${esc(t.title)}" Artist="${esc(t.artist)}" Composer="" Album="${esc(t.album)}" ` +
        `Grouping="" Genre="${esc(t.genre)}" Kind="${esc(t.kind)}" Size="${t.sizeBytes}" TotalTime="${Math.round(t.durationSec)}" ` +
        `DiscNumber="0" TrackNumber="0" Year="${esc(t.year)}" AverageBpm="${t.bpm.toFixed(2)}" DateAdded="${today}" ` +
        `BitRate="${Math.round(t.bitrate / 1000)}" SampleRate="${t.sampleRate}" Comments="${opts.commentTags !== false ? esc(commentTag(t)) : ''}" PlayCount="0" Rating="0" ` +
        `Location="${esc(rekordboxLocation(t.path))}" Remixer="" Tonality="${esc(t.key.musical)}" Label="" Mix="">`,
    );
    if (t.tempoMap && t.tempoMap.length > 1) {
      // tempo changes: one TEMPO marker per constant-tempo segment
      for (const m of t.tempoMap) lines.push(`      <TEMPO Inizio="${f3(m.startSec)}" Bpm="${m.bpm.toFixed(2)}" Metro="4/4" Battito="${m.beatInBar}"/>`);
    } else {
      lines.push(`      <TEMPO Inizio="${f3(t.grid.firstDownbeatSec)}" Bpm="${t.bpm.toFixed(2)}" Metro="4/4" Battito="1"/>`);
    }
    for (const c of [...t.cues].sort((a, b) => a.timeSec - b.timeSec)) {
      const [r, g, b] = c.color;
      // memory cue: for every cue when asked, and always for cues that have no pad (slot < 0)
      if (opts.memoryCues || c.slot < 0) {
        lines.push(`      <POSITION_MARK Name="${esc(c.name)}" Type="0" Start="${f3(c.timeSec)}" Num="-1"/>`);
      }
      if (c.slot >= 0 && c.slot <= 7) {
        lines.push(
          `      <POSITION_MARK Name="${esc(c.name)}" Type="0" Start="${f3(c.timeSec)}" Num="${c.slot}" Red="${r}" Green="${g}" Blue="${b}"/>`,
        );
      }
    }
    for (const l of exportedLoops(t, opts.loops)) {
      const end = l.startSec + (l.beats * 60) / t.bpm;
      lines.push(`      <POSITION_MARK Name="${esc(l.name)}" Type="4" Start="${f3(l.startSec)}" End="${f3(end)}" Num="-1"/>`);
    }
    lines.push('    </TRACK>');
  });
  lines.push('  </COLLECTION>');
  lines.push('  <PLAYLISTS>');
  lines.push(`    <NODE Type="0" Name="ROOT" Count="1">`);
  lines.push(`      <NODE Name="${esc(playlistName)}" Type="1" KeyType="0" Entries="${tracks.length}">`);
  tracks.forEach((_, i) => lines.push(`        <TRACK Key="${i + 1}"/>`));
  lines.push('      </NODE>');
  lines.push('    </NODE>');
  lines.push('  </PLAYLISTS>');
  lines.push('</DJ_PLAYLISTS>');
  return lines.join('\n') + '\n';
}
