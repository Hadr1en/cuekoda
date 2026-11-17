import type { ExportOptions } from '../core/export';

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
