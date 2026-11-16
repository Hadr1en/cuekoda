import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { CueKodaApi } from '../shared/api';

const on = (channel: string) => (cb: (payload: never) => void) => {
  ipcRenderer.on(channel, (_e, payload) => cb(payload as never));
};

const api: CueKodaApi = {
  init: () => ipcRenderer.invoke('init'),
  pathsForFiles: (files) => files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  pick: (kind) => ipcRenderer.invoke('pick', kind),
  addPaths: (paths) => ipcRenderer.invoke('add-paths', paths),
  updateCrates: (action) => ipcRenderer.invoke('crates-update', action),
  onCrates: on('crates'),
  reanalyze: (paths, force) => ipcRenderer.invoke('reanalyze', paths, force),
  applyPreparationProfile: (paths) => ipcRenderer.invoke('apply-preparation-profile', paths),
  analysisComparison: (p) => ipcRenderer.invoke('analysis-comparison', p),
  restoreAnalysis: (p) => ipcRenderer.invoke('restore-analysis', p),
  setOverrides: (p, ov) => ipcRenderer.invoke('set-overrides', p, ov),
  saveTrackEdits: (p, hash, edits) => ipcRenderer.sendSync('save-track-edits', p, hash, edits),
  removeTracks: (paths) => ipcRenderer.invoke('remove', paths),
  clear: () => ipcRenderer.invoke('clear'),
  pause: () => ipcRenderer.invoke('pause'),
  resume: () => ipcRenderer.invoke('resume'),
  cancel: (paths) => ipcRenderer.invoke('cancel', paths),
  retryErrors: () => ipcRenderer.invoke('retry'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  learningEvent: (e) => ipcRenderer.send('learning-event', e),
  resetLearning: () => ipcRenderer.invoke('reset-learning'),
  traktorPlan: (p, loops) => ipcRenderer.invoke('traktor-plan', p, loops),
  exportPreview: (f, paths, opts) => ipcRenderer.invoke('export-preview', f, paths, opts),
  exportCollection: (f, paths, opts) => ipcRenderer.invoke('export', f, paths, opts),
  importCollection: () => ipcRenderer.invoke('import-collection'),
  setReviewed: (paths, reviewed) => ipcRenderer.invoke('set-reviewed', paths, reviewed),
  addWatchFolder: () => ipcRenderer.invoke('add-watch-folder'),
  saveReference: (p, rating) => ipcRenderer.invoke('reference-save', p, rating),
  exportReferences: () => ipcRenderer.invoke('references-export'),
  peaks: (p) => ipcRenderer.invoke('peaks', p),
  revealInFolder: (p) => ipcRenderer.send('reveal', p),
  onTrack: on('track'),
  onQueue: on('queue'),
  onSummary: on('summary'),
  onWatch: on('watch'),
  onRemoved: on('removed'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onUpdate: on('update'),
};

contextBridge.exposeInMainWorld('cuekoda', api);
