// Downloads the ffmpeg binaries shipped by ffmpeg-static (same release as the npm package) for every
// platform CueKoda is packaged for, into vendor/ffmpeg/<platform>-<arch>/ (used by electron-builder).
//   node scripts/fetch-ffmpeg.mjs
import { createWriteStream, existsSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import path from 'node:path';

const RELEASE = 'b6.1.1'; // ffmpeg-static 5.x release
const BASE = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE}`;
const TARGETS = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['win32', 'x64'],
];

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res;
}

for (const [platform, arch] of TARGETS) {
  const dir = path.join('vendor', 'ffmpeg', `${platform}-${arch}`);
  const bin = path.join(dir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  mkdirSync(dir, { recursive: true });
  if (existsSync(bin)) {
    console.log(`ok (déjà présent) ${bin}`);
  } else {
    const res = await get(`${BASE}/ffmpeg-${platform}-${arch}.gz`);
    await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(bin));
    if (platform !== 'win32') chmodSync(bin, 0o755);
    console.log(`téléchargé ${bin}`);
  }
  // licence and build notes travel with the binary (GPL) — same asset names as ffmpeg-static's install.js
  for (const ext of ['LICENSE', 'README']) {
    const dest = path.join(dir, `ffmpeg.${ext}`);
    if (existsSync(dest)) continue;
    const r = await get(`${BASE}/${platform}-${arch}.${ext}`);
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  }
}
