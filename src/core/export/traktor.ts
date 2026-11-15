import * as path from 'node:path';
import type { AnalysisResult } from '../types';
import { SAME_POSITION_SEC } from '../cues';
import { formatKey, traktorKeyIndex } from '../key';
import { esc, exportedLoops } from './rekordbox';
import { commentTag, type ExportOptions } from './index';

/**
 * Traktor paths look like DIR="/:Users/:me/:Music/:" with FILE and VOLUME separate.
 * macOS: a file on another disk (/Volumes/USB/Music/a.mp3) belongs to that volume (VOLUME="USB",
 * DIR="/:Music/:"), as Traktor writes it — otherwise its entries do not match the collection's.
 */
export function traktorLocation(p: string, macVolume: string): { dir: string; file: string; volume: string } {
  const win = /^[A-Za-z]:[\\/]/.test(p);
  const abs = win ? p : path.posix.resolve(p);
  const file = abs.replace(/\\/g, '/').split('/').pop() ?? '';
  const normalized = abs.replace(/\\/g, '/');
  const onVolume = !win ? /^\/Volumes\/([^/]+)(\/.*)$/.exec(normalized) : null;
  const volume = win ? normalized.slice(0, 2) : onVolume ? onVolume[1] : macVolume;
  const rest = win ? normalized.slice(2) : onVolume ? onVolume[2] : normalized;
  const parts = rest.split('/').filter(Boolean);
  parts.pop(); // file name
  const dir = '/:' + parts.map((s) => `${s}/:`).join('');
  return { dir, file, volume };
}

/**
 * Traktor hotcue index for a CueKoda pad. Traktor keeps its beatgrid marker on hotcue 1 (HOTCUE="0", as its
 * own AutoGrid does): pads A–G go to hotcues 2–8 and pad H becomes a stored cue (HOTCUE="-1"), so no cue
 * shares the grid marker's button.
 */
export const traktorHotcue = (slot: number): number => (slot < 0 || slot >= 7 ? -1 : slot + 1);

/** AutoGrid already marks the first downbeat. Preserve the pad numbers of the remaining cues. */
export function traktorCues(track: AnalysisResult): AnalysisResult['cues'] {
  const gridStart = Math.max(0, track.grid.firstDownbeatSec);
  return track.cues.filter((cue) =>
    cue.slot <= 7 && Math.abs(Math.max(0, cue.timeSec) - gridStart) >= SAME_POSITION_SEC);
}

/**
 * Traktor collection (NML 19).
 *  - hot cues → CUE_V2 TYPE=0 HOTCUE=1..7 (hotcue 0 = grid marker; Traktor colours cues by type: CueKoda colours are not transferable)
 *  - grid     → CUE_V2 TYPE=4 "AutoGrid" on the first downbeat
 *  - loops    → CUE_V2 TYPE=5 LEN=<ms> HOTCUE=-1 (stored loops)
 * Import with "Import Another Collection" — back up your own collection.nml first.
 */
export function buildTraktorNml(
  tracks: AnalysisResult[],
  opts: ExportOptions = { memoryCues: false, loops: 'accepted' },
  macVolume = 'Macintosh HD',
): string {
  const now = new Date();
  const date = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
  const ms = (s: number) => (Math.max(0, s) * 1000).toFixed(3);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
  lines.push('<NML VERSION="19">');
  lines.push('<HEAD COMPANY="www.native-instruments.com" PROGRAM="Traktor"></HEAD>');
  lines.push('<MUSICFOLDERS></MUSICFOLDERS>');
  lines.push(`<COLLECTION ENTRIES="${tracks.length}">`);
  for (const t of tracks) {
    const loc = traktorLocation(t.path, macVolume);
    lines.push(`<ENTRY MODIFIED_DATE="${date}" MODIFIED_TIME="0" TITLE="${esc(t.title)}" ARTIST="${esc(t.artist)}">`);
    lines.push(
      `<LOCATION DIR="${esc(loc.dir)}" FILE="${esc(loc.file)}" VOLUME="${esc(loc.volume)}" VOLUMEID="${esc(loc.volume)}"></LOCATION>`,
    );
    lines.push(`<ALBUM TITLE="${esc(t.album)}"></ALBUM>`);
    const comment = opts.commentTags !== false ? commentTag(t, 'openKey') : '';
    lines.push(
      `<INFO BITRATE="${t.bitrate}" GENRE="${esc(t.genre)}"${comment ? ` COMMENT="${esc(comment)}"` : ''} KEY="${esc(formatKey(t.key, 'openKey'))}" PLAYTIME="${Math.round(t.durationSec)}" ` +
        `PLAYTIME_FLOAT="${t.durationSec.toFixed(6)}" IMPORT_DATE="${date}" FLAGS="0"></INFO>`,
    );
    lines.push(`<TEMPO BPM="${t.bpm.toFixed(6)}" BPM_QUALITY="${(t.grid.confidence * 100).toFixed(6)}"></TEMPO>`);
    const ki = traktorKeyIndex(t.key.musical);
    if (ki !== null) lines.push(`<MUSICAL_KEY VALUE="${ki}"></MUSICAL_KEY>`);
    lines.push(
      `<CUE_V2 NAME="AutoGrid" DISPL_ORDER="0" TYPE="4" START="${ms(t.grid.firstDownbeatSec)}" LEN="0" REPEATS="-1" HOTCUE="0"></CUE_V2>`,
    );
    for (const c of traktorCues(t)) {
      // slot < 0 = memory cue: a stored cue point with no hotcue button (HOTCUE="-1")
      lines.push(
        `<CUE_V2 NAME="${esc(c.name)}" DISPL_ORDER="0" TYPE="0" START="${ms(c.timeSec)}" LEN="0" REPEATS="-1" HOTCUE="${traktorHotcue(c.slot)}"></CUE_V2>`,
      );
    }
    for (const l of exportedLoops(t, opts.loops)) {
      const len = (l.beats * 60) / t.bpm;
      lines.push(
        `<CUE_V2 NAME="${esc(l.name)}" DISPL_ORDER="0" TYPE="5" START="${ms(l.startSec)}" LEN="${(len * 1000).toFixed(3)}" REPEATS="-1" HOTCUE="-1"></CUE_V2>`,
      );
    }
    lines.push('</ENTRY>');
  }
  lines.push('</COLLECTION>');
  lines.push('<PLAYLISTS><NODE TYPE="FOLDER" NAME="$ROOT"><SUBNODES COUNT="1">');
  lines.push(`<NODE TYPE="PLAYLIST" NAME="${esc(opts.playlistName || 'CueKoda')}"><PLAYLIST ENTRIES="${tracks.length}" TYPE="LIST" UUID="cuekoda-${now.getTime()}">`);
  for (const t of tracks) {
    const loc = traktorLocation(t.path, macVolume);
    lines.push(`<ENTRY><PRIMARYKEY TYPE="TRACK" KEY="${esc(`${loc.volume}${loc.dir}${loc.file}`)}"></PRIMARYKEY></ENTRY>`);
  }
  lines.push('</PLAYLIST></NODE>');
  lines.push('</SUBNODES></NODE></PLAYLISTS>');
  lines.push('</NML>');
  return lines.join('\n') + '\n';
}
