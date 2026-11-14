// Dev-only: mocked window.cuekoda API so the real renderer runs in a plain browser (see make-preview.mjs).
// Data = real analysis results (window.__RESULTS__). No audio playback (file:// is blocked over http).
(() => {
  const results = window.__RESULTS__ || [];
  const cbs = { track: () => {}, queue: () => {}, summary: () => {}, watch: () => {} };
  const tracks = results.map((r, i) => ({ path: r.path, fileName: r.fileName, status: 'done', result: structuredClone(r), addedAt: i }));
  const builtin = window.__PROFILES__ || [{ id: 'edm', name: 'EDM', builtin: true, colors: {}, cuePriority: [], excludeKinds: [], loopBeats: [16], loopKinds: [] }];
  let settings = {
    profileId: 'edm', customProfiles: [], maxWorkers: 3, watchFolders: [], watchPaused: false,
    autoAnalyzeWatched: true, learningEnabled: true, exportOptions: { memoryCues: true, loops: 'accepted' }, theme: 'dark',
  };
  const adapters = window.__ADAPTERS__ || [];
  window.cuekoda = {
    init: async () => ({ tracks, settings, builtinProfiles: builtin, queue: { pending: 0, running: 0, paused: false, maxWorkers: 3 }, adapters, learning: [], cores: 8, references: {} }),
    pathsForFiles: () => [],
    pick: async () => [],
    addPaths: async () => [],
    reanalyze: async () => {},
    setOverrides: async () => {},
    saveTrack: async () => {},
    removeTracks: async () => {},
    clear: async () => {},
    pause: async () => {},
    resume: async () => {},
    cancel: async () => {},
    retryErrors: async () => {},
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    learningEvent: () => {},
    resetLearning: async () => [],
    exportPreview: async (id, paths) => [`${paths.length} morceau(x) (aperçu simulé)`],
    exportCollection: async () => ({ ok: true, file: '/tmp/demo.xml' }),
    addWatchFolder: async () => settings,
    saveReference: async () => ({}),
    exportReferences: async () => ({ ok: false, canceled: true }),
    peaks: async () => null,
    revealInFolder: () => {},
    onTrack: (f) => (cbs.track = f),
    onQueue: (f) => (cbs.queue = f),
    onSummary: (f) => (cbs.summary = f),
    onWatch: (f) => (cbs.watch = f),
  };
})();
