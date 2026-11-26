const { build } = require('../package.json');
const windows = process.platform === 'win32';
const binary = windows ? 'cuekoda-core.exe' : 'cuekoda-core';

module.exports = {
  ...build,
  files: [...build.files, '!rust{,/**/*}'],
  appId: 'com.cuekoda.experiment.waveform',
  productName: 'CueKoda Waveform Experiment',
  directories: { ...build.directories, output: 'release/waveform-experiment' },
  extraResources: [{ from: `rust/cuekoda-core/target/release/${binary}`, to: binary }],
  mac: {
    ...build.mac,
    files: [...build.mac.files, '!rust{,/**/*}'],
    target: [{ target: 'dmg', arch: [process.arch] }],
  },
  win: { ...build.win, files: [...build.win.files, '!rust{,/**/*}'] },
  dmg: { ...build.dmg, artifactName: 'CueKoda-Waveform-Experiment-${version}-mac-${arch}.${ext}', title: 'CueKoda Waveform Experiment' },
  nsis: { ...build.nsis, shortcutName: 'CueKoda Waveform Experiment', artifactName: 'CueKoda-Waveform-Experiment-${version}-windows.${ext}' },
};
