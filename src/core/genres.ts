/**
 * Beatport-facing genre taxonomy.
 *
 * Genres are editorial labels; they are never inferred from the waveform.  They are grouped into a
 * small number of preparation families so the rhythm engine and cue profiles can use explicit,
 * testable behaviour instead of one special case per genre.
 */
export type RhythmMode = 'four-on-floor' | 'broken' | 'half-time' | 'open';

export type GenreFamily =
  | 'mainstage'
  | 'house'
  | 'techno'
  | 'trance'
  | 'hard-dance'
  | 'drum-and-bass'
  | 'bass'
  | 'global'
  | 'open-format';

export interface BeatportGenre {
  name: string;
  family: GenreFamily;
  rhythm: RhythmMode;
  /** Built-in preparation profile that best matches this editorial genre. */
  profileId: string;
  aliases?: string[];
}

const g = (
  name: string, family: GenreFamily, rhythm: RhythmMode, profileId: string, aliases?: string[],
): BeatportGenre => ({ name, family, rhythm, profileId, aliases });

/** Parent genres accepted by Beatport, including its open-format extension (September 2026). */
export const BEATPORT_GENRES: readonly BeatportGenre[] = [
  g('140 / Deep Dubstep / Grime', 'bass', 'half-time', 'bass', ['140', 'Deep Dubstep', 'Grime']),
  g('Afro House', 'global', 'four-on-floor', 'global'),
  g('Amapiano', 'global', 'four-on-floor', 'global'),
  g('Ambient / Experimental', 'open-format', 'open', 'openformat', ['Ambient', 'Experimental']),
  g('Bass / Club', 'bass', 'broken', 'bass', ['Juke', 'Footwork', 'Jersey Club', 'Gqom', 'UK Funky']),
  g('Bass House', 'bass', 'four-on-floor', 'bass'),
  g('Brazilian Funk', 'global', 'broken', 'global', ['Baile Funk', 'Carioca Funk', 'Mandelao Funk']),
  g('Breaks / Breakbeat / UK Bass', 'bass', 'broken', 'bass', ['Breaks', 'Breakbeat', 'UK Bass', 'Glitch Hop']),
  g('Dance / Pop', 'mainstage', 'open', 'openformat', ['Dance Pop', 'Tropical House']),
  g('Deep House', 'house', 'four-on-floor', 'house'),
  g('DJ Edits', 'open-format', 'open', 'openformat', ['Edits', 'Mashups']),
  g('DJ Tools', 'open-format', 'open', 'openformat', ['Acapella', 'Acapellas', 'Battle Tools']),
  g('Downtempo', 'open-format', 'open', 'openformat'),
  g('Drum & Bass', 'drum-and-bass', 'broken', 'drumandbass', ['Drum and Bass', 'DnB', 'Jungle', 'Liquid DnB', 'Jump Up']),
  g('Dubstep', 'bass', 'half-time', 'bass', ['Melodic Dubstep', 'Midtempo']),
  g('Electro (Classic / Detroit / Modern)', 'bass', 'broken', 'bass', ['Electro']),
  g('Electronica', 'open-format', 'open', 'openformat'),
  g('Funky House', 'house', 'four-on-floor', 'house'),
  g('Hard Dance / Hardcore / Neo Rave', 'hard-dance', 'four-on-floor', 'harddance',
    ['Hardstyle', 'Rawstyle', 'Hardcore', 'Uptempo', 'Frenchcore', 'Happy Hardcore', 'Neo Rave']),
  g('Hard Techno', 'hard-dance', 'four-on-floor', 'harddance'),
  g('House', 'house', 'four-on-floor', 'house', ['Acid House', 'Soulful House', 'Latin House']),
  g('Indie Dance', 'house', 'four-on-floor', 'house', ['Dark Disco']),
  g('Indie Tech', 'techno', 'four-on-floor', 'techno'),
  g('Jackin House', 'house', 'four-on-floor', 'house'),
  g('Latin Electronic', 'global', 'open', 'global', ['Guaracha', 'Electronic Cumbia', 'Moombahton']),
  g('Mainstage', 'mainstage', 'four-on-floor', 'edm', ['Big Room', 'Electro House', 'Future House', 'Future Rave', 'Speed House']),
  g('Melodic House & Techno', 'trance', 'four-on-floor', 'trance', ['Melodic House', 'Melodic Techno']),
  g('Minimal / Deep Tech', 'techno', 'four-on-floor', 'techno', ['Minimal House', 'Deep Tech']),
  g('Nu Disco / Disco', 'house', 'four-on-floor', 'house', ['Nu Disco', 'Disco', 'Italo Disco']),
  g('Organic House', 'house', 'four-on-floor', 'house'),
  g('Progressive House', 'mainstage', 'four-on-floor', 'edm'),
  g('Psy-Trance', 'trance', 'four-on-floor', 'trance', ['Psytrance', 'Goa Trance', 'Full-On']),
  g('Tech House', 'house', 'four-on-floor', 'techhouse'),
  g('Techno (Peak Time / Driving)', 'techno', 'four-on-floor', 'techno', ['Peak Time Techno', 'Driving Techno']),
  g('Techno (Raw / Deep / Hypnotic)', 'techno', 'four-on-floor', 'techno', ['Raw Techno', 'Hypnotic Techno', 'Dub Techno']),
  g('Trance (Main Floor)', 'trance', 'four-on-floor', 'trance', ['Uplifting Trance', 'Tech Trance', 'Vocal Trance']),
  g('Trance (Raw / Deep / Hypnotic)', 'trance', 'four-on-floor', 'trance', ['Raw Trance', 'Deep Trance', 'Hypnotic Trance']),
  g('Trap / Future Bass', 'bass', 'half-time', 'bass', ['Trap', 'Future Bass']),
  g('UK Garage / Bassline', 'bass', 'broken', 'bass', ['UK Garage', 'UKG', 'Bassline', '2-Step', 'Speed Garage']),
  // Beatport open-format parents.  They are useful for festival edits and crossover sets even when the
  // original recording is not electronic.
  g('Hip-Hop', 'open-format', 'half-time', 'openformat', ['Hip Hop']),
  g('Pop', 'open-format', 'open', 'openformat'),
  g('R&B', 'open-format', 'half-time', 'openformat', ['RNB', 'Rhythm and Blues']),
  g('Latin', 'global', 'open', 'global', ['Reggaeton', 'Dembow', 'Salsa', 'Cumbia', 'Latin Pop']),
  g('African', 'global', 'open', 'global', ['Afrobeats', 'Afropop', 'Afro R&B']),
  g('Caribbean', 'global', 'open', 'global', ['Dancehall', 'Reggae', 'Soca', 'Calypso']),
  g('Rock', 'open-format', 'open', 'openformat', ['Indie Rock', 'Metal', 'Punk']),
  g('Country', 'open-format', 'open', 'openformat'),
] as const;

export const GENRE_FAMILY_LABELS: Record<GenreFamily, string> = {
  mainstage: 'Mainstage / progressive',
  house: 'House / disco',
  techno: 'Techno / minimal',
  trance: 'Trance / melodic',
  'hard-dance': 'Hard dance / hard techno',
  'drum-and-bass': 'Drum & Bass / jungle',
  bass: 'Bass / breaks / garage',
  global: 'Afro / Latin / global',
  'open-format': 'Open format / crossover',
};

const normal = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

const index = new Map<string, BeatportGenre>();
for (const genre of BEATPORT_GENRES) {
  for (const name of [genre.name, ...(genre.aliases ?? [])]) index.set(normal(name), genre);
}

/** Exact parent/alias match first, then a conservative token match for common tag decorations. */
export function beatportGenre(value: string | undefined): BeatportGenre | undefined {
  const key = normal(value ?? '');
  if (!key) return undefined;
  const exact = index.get(key);
  if (exact) return exact;
  const candidates = [...index.entries()].filter(([alias]) => alias.length >= 5
    && (key.includes(alias) || alias.includes(key)));
  candidates.sort((a, b) => b[0].length - a[0].length);
  return candidates[0]?.[1];
}
