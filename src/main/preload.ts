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
  reanalyze: (paths, force) => ipcRenderer.invoke('reanalyze', paths, force),
  setOverrides: (p, ov) => ipcRenderer.invoke('set-overrides', p, ov),
  saveTrack: (r) => ipcRenderer.invoke('save-track', r),
  removeTracks: (paths) => ipcRenderer.invoke('remove', paths),
  clear: () => ipcRenderer.invoke('clear'),
  pause: () => ipcRenderer.invoke('pause'),
  resume: () => ipcRenderer.invoke('resume'),
  cancel: (paths) => ipcRenderer.invoke('cancel', paths),
  retryErrors: () => ipcRenderer.invoke('retry'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  learningEvent: (e) => ipcRenderer.send('learning-event', e),
  resetLearning: () => ipcRenderer.invoke('reset-learning'),
  exportPreview: (f, paths, opts) => ipcRenderer.invoke('export-preview', f, paths, opts),
  exportCollection: (f, paths, opts) => ipcRenderer.invoke('export', f, paths, opts),
  addWatchFolder: () => ipcRenderer.invoke('add-watch-folder'),
  peaks: (p) => ipcRenderer.invoke('peaks', p),
  revealInFolder: (p) => ipcRenderer.send('reveal', p),
  onTrack: on('track'),
  onQueue: on('queue'),
  onSummary: on('summary'),
  onWatch: on('watch'),
};

contextBridge.exposeInMainWorld('cuekoda', api);
