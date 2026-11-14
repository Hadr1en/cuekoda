import { app, net, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAC_SWAP_SCRIPT, RELEASES_API, evaluateRelease, type GithubRelease, type UpdateInfo, type UpdateStatus } from '../shared/update';

/**
 * Self-update from the public GitHub releases. Only GitHub is contacted (no library data is sent):
 * a GET of the latest release, then — on the DJ's click — the download of the installer, checked
 * against its size and mandatory GitHub SHA-256 digest before anything runs. The digest checks
 * download integrity, with GitHub as the source of both the installer and its expected digest.
 *   Windows: silent NSIS install over the current one, then relaunch.
 *   macOS: the old app goes to the Trash, the new one is copied in place, then relaunched (the app is not
 *          signed by Apple, so the system updater cannot be used); falls back to opening the DMG.
 */
export class Updater {
  status: UpdateStatus = { state: 'idle' };
  constructor(private readonly notify: (s: UpdateStatus) => void) {}

  /** Build number injected by CI into package.json (none in dev builds). */
  get currentBuild(): number | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const b = require(path.join(app.getAppPath(), 'package.json')).cuekodaBuild;
      return Number.isInteger(Number(b)) && Number(b) > 0 ? Number(b) : null;
    } catch {
      return null;
    }
  }

  private set(s: UpdateStatus) {
    this.status = s;
    this.notify(s);
  }

  async check(): Promise<UpdateStatus> {
    if (this.status.state === 'downloading' || this.status.state === 'installing') return this.status;
    this.set({ state: 'checking' });
    try {
      const res = await net.fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `CueKoda/${app.getVersion()}` },
      });
      if (res.status === 404) throw new Error('aucune release publique trouvée (le dépôt est-il public ?)');
      if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
      const rel = (await res.json()) as GithubRelease;
      const info = evaluateRelease(rel, { build: this.currentBuild }, process.platform, process.arch);
      this.set(info ? { state: 'available', info } : { state: 'none', currentBuild: this.currentBuild });
    } catch (e) {
      this.set({ state: 'error', message: `Vérification des mises à jour impossible : ${(e as Error).message}` });
    }
    return this.status;
  }

  async install(): Promise<void> {
    if (this.status.state !== 'available' && this.status.state !== 'error') return;
    const info = this.status.state === 'available' ? this.status.info : null;
    if (!info) return;
    try {
      const file = await this.download(info);
      this.set({ state: 'installing', info });
      if (process.platform === 'win32') {
        // per-user NSIS installer: silent install over the current version, then start the new one
        spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
        setTimeout(() => app.quit(), 300);
      } else if (process.platform === 'darwin') {
        this.macSwap(file, info);
      } else {
        this.set({ state: 'manual', info, file, message: 'Installez le fichier téléchargé manuellement.' });
        shell.showItemInFolder(file);
      }
    } catch (e) {
      this.set({ state: 'error', message: `Mise à jour impossible : ${(e as Error).message}` });
    }
  }

  private async download(info: UpdateInfo): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuekoda-update-'));
    const file = path.join(dir, path.basename(info.asset.name));
    const res = await net.fetch(info.asset.url, { headers: { 'User-Agent': `CueKoda/${app.getVersion()}` } });
    if (!res.ok || !res.body) throw new Error(`téléchargement refusé (${res.status})`);
    const hash = createHash('sha256');
    const out = fs.createWriteStream(file);
    let got = 0;
    let lastPct = -1;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      got += value.length;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      const pct = Math.floor((got / info.asset.size) * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        this.set({ state: 'downloading', info, fraction: Math.min(1, got / info.asset.size) });
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (got !== info.asset.size) throw new Error(`fichier incomplet (${got} / ${info.asset.size} octets)`);
    const sha = hash.digest('hex');
    if (sha !== info.asset.sha256) throw new Error('empreinte SHA-256 différente de celle publiée : fichier rejeté');
    return file;
  }

  private macSwap(dmg: string, info: UpdateInfo) {
    // …/CueKoda.app/Contents/MacOS/CueKoda → …/CueKoda.app
    const bundle = path.resolve(path.dirname(app.getPath('exe')), '..', '..');
    if (!bundle.endsWith('.app')) {
      void shell.openPath(dmg);
      this.set({ state: 'manual', info, file: dmg, message: 'Glissez CueKoda dans Applications pour remplacer l’ancienne version.' });
      return;
    }
    const script = path.join(path.dirname(dmg), 'swap.sh');
    fs.writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o755 });
    const log = path.join(app.getPath('logs'), 'update.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    spawn('/bin/sh', [script, String(process.pid), dmg, bundle, log], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
  }
}
