import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const out = process.argv[2] || 'site/dist';
const repo = 'Hadr1en/cuekoda';
const releaseIndex = `https://github.com/${repo}/releases`;
const latest = `${releaseIndex}/latest`;
const platforms = [
  ['Windows', 'Windows 10 / 11 · 64 bits', 'windows-setup.exe'],
  ['macOS · Apple Silicon', 'macOS 13+ · puce Apple', 'mac-arm64.dmg'],
  ['macOS · Intel', 'macOS 13+ · processeur Intel', 'mac-x64.dmg'],
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

async function fetchRelease() {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(process.env.GH_TOKEN && { Authorization: `Bearer ${process.env.GH_TOKEN}` }),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) {
    const repository = await fetch(`https://api.github.com/repos/${repo}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (repository.ok) return null;
  }
  if (!response.ok) throw new Error(`GitHub Releases a répondu HTTP ${response.status}.`);
  return response.json();
}

function renderRelease(release) {
  if (!release || release.draft || release.prerelease) {
    return `<p>Aucune version stable disponible pour le moment. <a href="${latest}">Voir les Releases GitHub ↗</a></p>`;
  }

  const expectedPage = `${releaseIndex}/tag/${encodeURIComponent(release.tag_name)}`;
  if (release.html_url !== expectedPage) throw new Error('URL de release inattendue.');
  const candidates = release.assets.flatMap(asset => {
    const match = /^CueKoda-(\d+\.\d+\.\d+)-/.exec(asset.name);
    const expectedUrl = `${releaseIndex}/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`;
    if (!match || asset.state !== 'uploaded' || asset.browser_download_url !== expectedUrl || asset.size <= 0) return [];
    const version = match[1];
    return platforms.some(([, , suffix]) => asset.name === `CueKoda-${version}-${suffix}`)
      ? [{ ...asset, version }] : [];
  });
  const versions = new Set(candidates.map(asset => asset.version));
  if (versions.size > 1) throw new Error('Versions d’installeurs incohérentes dans la release.');
  const version = candidates[0]?.version;
  const formattedDate = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long', timeZone: 'Europe/Paris',
  }).format(new Date(release.published_at));
  const downloads = platforms.map(([label, requirement, suffix]) => {
    const asset = candidates.find(item => item.name === `CueKoda-${version}-${suffix}`);
    const heading = `<span>${requirement}</span><strong>${label}</strong>`;
    if (!asset) return `<div class="download">${heading}<small>Installeur indisponible pour cette version</small></div>`;
    const size = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(asset.size / 1_000_000);
    return `<a class="download" href="${escapeHtml(asset.browser_download_url)}">${heading}<small>Télécharger ${suffix.slice(-4)} · ${size} Mo ↓</small></a>`;
  });
  const notes = release.body?.trim()
    ? `<details class="release-notes"><summary>Notes de version</summary><pre>${escapeHtml(release.body.trim())}</pre></details>`
    : '';

  return `<p class="release-meta"><strong>${version ? `Version ${version}` : 'Dernière version stable'}</strong>
    · ${escapeHtml(release.tag_name)} · <time datetime="${escapeHtml(release.published_at)}">${formattedDate}</time>
    · <a href="${escapeHtml(expectedPage)}">Release GitHub ↗</a></p>
    <div class="downloads">${downloads.join('\n')}</div>${notes}`;
}

const template = await readFile(new URL('site/index.html', root), 'utf8');
const release = renderRelease(await fetchRelease());
await mkdir(join(out, 'media'), { recursive: true });
await writeFile(join(out, 'index.html'), template.replace('<!-- RELEASE -->', () => release));
await copyFile(new URL('site/style.css', root), join(out, 'style.css'));
await copyFile(new URL('assets/logo/png/cuekoda-icone-128.png', root), join(out, 'media/icon.png'));
for (const name of ['detail', 'mix', 'export']) {
  await copyFile(new URL(`docs/screenshots/fr/${name}.png`, root), join(out, `media/${name}.png`));
}
console.log(`Site construit dans ${out}`);
