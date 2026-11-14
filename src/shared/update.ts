/**
 * Update check against the public GitHub releases of CueKoda (pure logic, unit-tested).
 * Each CI build publishes a release tagged `build-<run number>`; installed apps carry their own build
 * number (package.json `cuekodaBuild`, injected by CI). A dev build (no number) is never "out of date".
 */
export const RELEASES_API = 'https://api.github.com/repos/Hadr1en/cuekoda/releases/latest';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  /** "sha256:<hex>" (GitHub asset digest), when available */
  digest?: string | null;
}

export interface GithubRelease {
  tag_name: string;
  name?: string | null;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets: ReleaseAsset[];
}

export interface UpdateInfo {
  build: number;
  version: string;
  title: string;
  pageUrl: string;
  asset: { name: string; url: string; size: number; sha256: string };
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none'; currentBuild: number | null }
  | { state: 'available'; info: UpdateInfo }
  | { state: 'downloading'; info: UpdateInfo; fraction: number }
  | { state: 'installing'; info: UpdateInfo }
  | { state: 'manual'; info: UpdateInfo; file: string; message: string }
  | { state: 'error'; message: string };

export function parseBuild(tag: string): number | null {
  const m = /^build-(\d+)$/.exec(tag.trim());
  return m ? Number(m[1]) : null;
}

/** Installer of this platform / architecture in a release (names come from electron-builder's artifactName). */
export function pickAsset(assets: ReleaseAsset[], platform: string, arch: string): ReleaseAsset | null {
  const re =
    platform === 'darwin' ? new RegExp(`^CueKoda-[\\d.]+-mac-${arch === 'arm64' ? 'arm64' : 'x64'}\\.dmg$`)
      : platform === 'win32' ? /^CueKoda-[\d.]+-windows-setup\.exe$/
        : null;
  return (re && assets.find((a) => re.test(a.name))) || null;
}

export function versionOf(assetName: string): string {
  return /^CueKoda-([\d.]+)-/.exec(assetName)?.[1] ?? '';
}

/** What to offer, if anything. A candidate without a valid digest is rejected. */
export function evaluateRelease(
  rel: GithubRelease,
  current: { build: number | null },
  platform: string,
  arch: string,
): UpdateInfo | null {
  if (rel.draft || rel.prerelease) return null;
  const build = parseBuild(rel.tag_name);
  if (build === null || current.build === null || build <= current.build) return null;
  const a = pickAsset(rel.assets, platform, arch);
  if (!a) return null;
  if (typeof a.digest !== 'string' || a.digest.length !== 71 || !/^sha256:[0-9a-f]{64}$/i.test(a.digest)) {
    throw new Error('empreinte SHA-256 absente ou invalide : mise à jour rejetée');
  }
  const sha = a.digest.slice(7).toLowerCase();
  return {
    build,
    version: versionOf(a.name),
    title: rel.name || rel.tag_name,
    pageUrl: rel.html_url,
    asset: { name: a.name, url: a.browser_download_url, size: a.size, sha256: sha },
  };
}

/**
 * macOS: shell script run after the app quits. It mounts the new DMG, moves the old app to the Trash
 * (nothing is deleted), copies the new one in place, then relaunches it. If the copy fails, the old
 * app is put back. Arguments are passed as positional parameters, never interpolated into the script.
 */
export const MAC_SWAP_SCRIPT = `#!/bin/sh
PID="$1"; DMG="$2"; APP="$3"; LOG="$4"
exec >>"$LOG" 2>&1
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
MNT=$(mktemp -d "\${TMPDIR:-/tmp}/cuekoda-mnt.XXXXXX")
hdiutil attach -nobrowse -noautoopen -mountpoint "$MNT" "$DMG" || { open "$DMG"; exit 1; }
OLD="$HOME/.Trash/CueKoda (ancienne version $(date +%Y%m%d-%H%M%S)).app"
if mv "$APP" "$OLD"; then
  if ditto "$MNT/CueKoda.app" "$APP"; then
    echo "mise à jour installée"
  else
    echo "copie impossible : restauration"; mv "$OLD" "$APP"
  fi
else
  echo "déplacement impossible (droits ?) : ouverture du DMG"; hdiutil detach "$MNT" -quiet; open "$DMG"; exit 1
fi
hdiutil detach "$MNT" -quiet
open "$APP"
`;
