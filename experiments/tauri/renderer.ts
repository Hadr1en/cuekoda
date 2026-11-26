import { resolveLang, setLang } from '../../src/shared/i18n';

interface Track { path: string; title: string }
interface Preview {
  durationSec: number;
  metadata: { title: string; artist?: string; album?: string; genre?: string };
  waveform: { perSec: number; peak: number[]; low: number[]; mid: number[]; high: number[] };
}
interface Native {
  core: {
    invoke<T>(command: string, args?: object): Promise<T>;
    convertFileSrc(path: string): string;
  };
  event: {
    listen<T>(event: string, callback: (event: { payload: T }) => void): Promise<() => void>;
  };
}
const { core, event } = (window as Window & { __TAURI__?: Native }).__TAURI__!;
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const library = get('library');
const rows = get('rows');
const search = get<HTMLInputElement>('search');
const status = get('status');
const player = get<HTMLAudioElement>('player');
const canvas = get<HTMLCanvasElement>('wave');
const zoom = get<HTMLInputElement>('zoom');
const position = get<HTMLInputElement>('position');
const analyze = get<HTMLButtonElement>('analyze');
const cancel = get<HTMLButtonElement>('cancel');
const theme = get<HTMLButtonElement>('theme');
const title = get('title');
const metadata = get('metadata');
const lang = resolveLang('system', navigator.language);
setLang(lang);
document.documentElement.lang = lang;
const copy = (fr: string, en: string) => lang === 'fr' ? fr : en;
for (const [id, fr, en] of [
  ['files', 'Ajouter des fichiers', 'Add files'],
  ['folder', 'Ajouter un dossier', 'Add folder'],
  ['analyze', 'Analyser la forme d’onde', 'Analyze waveform'],
  ['cancel', 'Annuler', 'Cancel'],
  ['title', 'Bibliothèque musicale', 'Music library'],
]) get(id).textContent = copy(fr, en);
search.placeholder = copy('Filtrer la bibliothèque', 'Search the library');
search.setAttribute('aria-label', search.placeholder);
library.setAttribute('aria-label', title.textContent!);
const tracks = new Map<string, Track>();
const previews = new Map<string, Preview>();
const rowHeight = 36;
let visible: Track[] = [];
let selection: Track | undefined;
let descending = false;

function renderRows() {
  paintRows(true);
}

function paintRows(virtualize: boolean) {
  rows.style.height = `${visible.length * rowHeight}px`;
  const start = virtualize ? Math.max(0, Math.floor(library.scrollTop / rowHeight) - 2) : 0;
  const end = virtualize ? Math.min(visible.length, start + Math.ceil(library.clientHeight / rowHeight) + 5) : visible.length;
  const fragment = document.createDocumentFragment();
  for (let index = start; index < end; index++) {
    const track = visible[index];
    const row = document.createElement('div');
    row.className = 'track-option';
    row.id = `track-${index}`;
    row.textContent = track.title;
    row.style.top = `${index * rowHeight}px`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selection?.path === track.path));
    row.addEventListener('click', () => select(track));
    fragment.append(row);
  }
  rows.replaceChildren(fragment);
  const active = visible.findIndex((track) => track.path === selection?.path);
  if (active >= start && active < end) library.setAttribute('aria-activedescendant', `track-${active}`);
  else library.removeAttribute('aria-activedescendant');
}

function filter() {
  const query = search.value.trim().toLocaleLowerCase();
  visible = [...tracks.values()].filter((track) => track.title.toLocaleLowerCase().includes(query));
  visible.sort((a, b) => (descending ? -1 : 1) * a.title.localeCompare(b.title, lang));
  renderRows();
}

function select(track: Track) {
  selection = track;
  player.src = core.convertFileSrc(track.path);
  zoom.value = '1';
  position.value = '0';
  analyze.disabled = !cancel.disabled;
  showPreview();
  renderRows();
}

function showPreview() {
  const preview = selection && previews.get(selection.path);
  title.textContent = preview?.metadata.title || selection?.title || '';
  metadata.textContent = preview ? [preview.metadata.artist, preview.metadata.album, preview.metadata.genre]
    .filter(Boolean).join(' · ') : '';
  draw();
}

function view() {
  const duration = (selection && previews.get(selection.path)?.durationSec) || 0;
  const span = duration / Number(zoom.value);
  return { span, start: (duration - span) * Number(position.value) / 1000 };
}

function draw() {
  const context = canvas.getContext('2d')!;
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);
  if (!width || !height) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context.clearRect(0, 0, width, height);
  const wave = selection && previews.get(selection.path)?.waveform;
  if (!wave) return;
  const { start, span } = view();
  for (const [band, color] of [[wave.peak, '#666b8a'], [wave.low, '#795eff'], [wave.mid, '#34c7b6'], [wave.high, '#e4b768']] as const) {
    context.fillStyle = color;
    const stride = Math.max(1, Math.ceil(width / 1500));
    for (let x = 0; x < width; x += stride) {
      const first = Math.floor((start + span * x / width) * wave.perSec);
      const end = Math.ceil((start + span * (x + stride) / width) * wave.perSec);
      let peak = 0;
      for (let i = first; i < end && i < band.length; i++) peak = Math.max(peak, band[i]);
      context.fillRect(x, (1 - peak) * height / 2, stride, peak * height);
    }
  }
  const playhead = (player.currentTime - start) * width / span;
  context.fillStyle = '#fa6175';
  context.fillRect(playhead, 0, Math.max(1, devicePixelRatio), height);
}

function addImported(imported: Track[]) {
  for (const track of imported) tracks.set(track.path, track);
  filter();
  if (!selection && visible.length) select(visible[0]);
}

async function add(folder: boolean) {
  try {
    const imported = await core.invoke<Track[]>('import_tracks', { folder });
    addImported(imported);
  } catch (error) {
    status.textContent = String(error);
  }
}

get('files').onclick = () => void add(false);
get('folder').onclick = () => void add(true);
search.oninput = filter;
library.onscroll = renderRows;
library.onkeydown = (key) => {
  if (!['ArrowDown', 'ArrowUp'].includes(key.key) || !visible.length) return;
  key.preventDefault();
  const current = visible.findIndex((track) => track.path === selection?.path);
  const target = Math.max(0, Math.min(visible.length - 1, current + (key.key === 'ArrowDown' ? 1 : -1)));
  if (target * rowHeight < library.scrollTop) library.scrollTop = target * rowHeight;
  else if ((target + 1) * rowHeight > library.scrollTop + library.clientHeight) {
    library.scrollTop = (target + 1) * rowHeight - library.clientHeight;
  }
  select(visible[target]);
};
const sortLabel = () => copy('Titre', 'Title') + (descending ? ' ↓' : ' ↑');
get('sort').textContent = sortLabel();
get('sort').onclick = () => {
  descending = !descending;
  get('sort').textContent = sortLabel();
  filter();
};
theme.onclick = () => {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  theme.textContent = light ? copy('Thème sombre', 'Dark theme') : copy('Thème clair', 'Light theme');
};
theme.textContent = copy('Thème clair', 'Light theme');

analyze.onclick = async () => {
  if (!selection) return;
  const track = selection;
  analyze.disabled = true;
  cancel.disabled = false;
  status.textContent = copy('Analyse…', 'Analyzing…');
  try {
    const preview = await core.invoke<Preview>('analyze', { path: track.path });
    if (!previews.has(track.path) && previews.size >= 12) {
      const oldest = previews.keys().next().value;
      if (oldest) previews.delete(oldest);
    }
    previews.set(track.path, preview);
    if (selection?.path === track.path) showPreview();
    status.textContent = copy('Forme d’onde prête', 'Waveform ready');
  } catch (error) {
    status.textContent = String(error);
  } finally {
    analyze.disabled = false;
    cancel.disabled = true;
  }
};
cancel.onclick = () => { void core.invoke('cancel').catch((error) => { status.textContent = String(error); }); };
void event.listen<string>('analysis-stage', ({ payload }) => {
  if (payload === 'waveform') status.textContent = copy('Calcul de la forme d’onde…', 'Computing waveform…');
}).catch(() => { /* The command response remains the source of completion state. */ });
void core.invoke<Track[]>('initial_tracks').then(addImported).catch((error) => { status.textContent = String(error); });
void event.listen<Track[]>('tracks-imported', ({ payload }) => addImported(payload));
void event.listen<string>('import-error', ({ payload }) => { status.textContent = payload; });
player.ontimeupdate = draw;
zoom.oninput = draw;
position.oninput = draw;
canvas.onclick = (click) => {
  const { start, span } = view();
  if (span > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(player.duration, start + span * click.offsetX / canvas.clientWidth);
};
new ResizeObserver(draw).observe(canvas);
new ResizeObserver(renderRows).observe(library);


async function measureLibrary() {
  if (!await core.invoke<boolean>('library_benchmark_enabled')) return;
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const samples = [];
  for (const count of [10, 100, 1000, 10000]) {
    visible = Array.from({ length: count }, (_, index) => ({
      path: String(index), title: `Synthetic track ${index + 1}`,
    }));
    for (let trial = 0; trial < 10; trial++) {
      for (const virtualize of trial % 2 === 0 ? [false, true] : [true, false]) {
        rows.replaceChildren();
        await nextFrame();
        await nextFrame();
        const start = performance.now();
        paintRows(virtualize);
        // Force layout so that DOM and layout costs are measured at the call site.
        const height = rows.getBoundingClientRect().height;
        const layoutMs = performance.now() - start;
        const mounted = rows.childElementCount;
        if (height !== count * rowHeight || mounted === 0 || (!virtualize && mounted !== count)) {
          throw new Error(`Invalid benchmark layout for ${count} tracks (${height}px, ${mounted} nodes)`);
        }
        await nextFrame();
        await nextFrame();
        samples.push({ count, trial, virtualize, mounted, contentHeight: height, layoutMs, twoFramesMs: performance.now() - start });
      }
    }
    library.scrollTop = rows.scrollHeight;
    paintRows(true);
    if (rows.lastElementChild?.textContent !== visible[count - 1].title) {
      throw new Error(`The last track is unreachable with ${count} rows`);
    }
    library.scrollTop = 0;
  }
  await core.invoke('finish_library_benchmark', {
    result: JSON.stringify({ schemaVersion: 1, userAgent: navigator.userAgent, syntheticAudioFiles: 0, samples }),
  });
}
void measureLibrary().catch((error) => { status.textContent = String(error); });
