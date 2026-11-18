import type { ExportOptions } from '../core/export';
import { BEATPORT_GENRES, type GenreFamily, type RhythmMode } from '../core/genres';
import type { ReferenceDetails } from '../core/evaluate';

const MAX_PATHS = 10_000;
const MAX_PATH_LENGTH = 32_768;

export function validatePathList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_PATHS) throw new Error('Liste de fichiers invalide');
  if (value.some((item) => typeof item !== 'string' || !item.length || item.length > MAX_PATH_LENGTH || item.includes('\0'))) {
    throw new Error('Chemin de fichier invalide');
  }
  return value;
}

export function validateExportOptions(value: unknown): ExportOptions {
  if (!value || typeof value !== 'object') throw new Error('Options d’export invalides');
  const raw = value as Record<string, unknown>;
  if (typeof raw.memoryCues !== 'boolean' || !['accepted', 'all', 'none'].includes(String(raw.loops))) {
    throw new Error('Options d’export invalides');
  }
  if (raw.commentTags !== undefined && typeof raw.commentTags !== 'boolean') throw new Error('Options d’export invalides');
  if (raw.playlistName !== undefined && (typeof raw.playlistName !== 'string' || raw.playlistName.length > 200 || raw.playlistName.includes('\0'))) {
    throw new Error('Nom de playlist invalide');
  }
  return {
    memoryCues: raw.memoryCues,
    loops: raw.loops as ExportOptions['loops'],
    commentTags: raw.commentTags as boolean | undefined,
    playlistName: typeof raw.playlistName === 'string' ? raw.playlistName.trim() : undefined,
  };
}

export function validateReferenceDetails(value: unknown): ReferenceDetails {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object') throw new Error('Informations de référence invalides');
  const raw = value as Record<string, unknown>;
  const genres = new Set(BEATPORT_GENRES.map(({ name }) => name));
  const families: GenreFamily[] = ['mainstage', 'house', 'techno', 'trance', 'hard-dance', 'drum-and-bass', 'bass', 'global', 'open-format'];
  const rhythms: RhythmMode[] = ['four-on-floor', 'broken', 'half-time', 'open'];
  const scenarios: NonNullable<ReferenceDetails['scenario']>[] = ['steady', 'variable', 'live', 'edit'];
  const vocals: NonNullable<ReferenceDetails['vocalStyle']>[] = ['instrumental', 'sung', 'rap-spoken', 'chops', 'mixed', 'unknown'];
  if (raw.genre !== undefined && (typeof raw.genre !== 'string' || !genres.has(raw.genre))) throw new Error('Genre Beatport invalide');
  if (raw.genreFamily !== undefined && !families.includes(raw.genreFamily as GenreFamily)) throw new Error('Famille musicale invalide');
  if (raw.rhythm !== undefined && !rhythms.includes(raw.rhythm as RhythmMode)) throw new Error('Type rythmique invalide');
  if (raw.scenario !== undefined && !scenarios.includes(raw.scenario as NonNullable<ReferenceDetails['scenario']>)) throw new Error('Scénario invalide');
  if (raw.vocalStyle !== undefined && !vocals.includes(raw.vocalStyle as NonNullable<ReferenceDetails['vocalStyle']>)) throw new Error('Type vocal invalide');
  return {
    genre: raw.genre as string | undefined,
    genreFamily: raw.genreFamily as GenreFamily | undefined,
    rhythm: raw.rhythm as RhythmMode | undefined,
    scenario: raw.scenario as ReferenceDetails['scenario'],
    vocalStyle: raw.vocalStyle as ReferenceDetails['vocalStyle'],
  };
}
