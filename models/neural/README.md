# Local analysis models

The `scripts/models` directory contains the exporters. Python and the upstream runtimes are used for exporting only. CueKoda runs the shipped graphs locally using the CPU provider of ONNX Runtime.

- **DeepRhythm 0.7** comes from [bleugreen/deeprhythm at b1f6116](https://github.com/bleugreen/deeprhythm/tree/b1f6116e0fe993322a0b3df2def54eb0c8d352f7), under AGPL-3.0. The graph includes the constant-Q projection of the eight onset bands and the original classifier. The frontend uses the same eight-second snippets and feature layout. See the repository-level LICENSE.
- **OpenKeyScan 3** comes from [rekordcloud/openkeyscan-analyzer at 6a2915f](https://github.com/rekordcloud/openkeyscan-analyzer/tree/6a2915f43b3bf2c825ddf508e2a703ffd4df8fb6). The MIT notice is reproduced in LICENSE-openkeyscan. The classifier uses per-channel int8 quantization calibrated on public FMAK audio. The sparse constant-Q filters use the 44.1 kHz reference frontend in librosa 0.11.
- **MusiCNN voice/instrumental** is an ONNX translation of the MTG model already shipped with CueKoda. It uses the original weights and the same 187 × 96 log-mel input. The original TensorFlow.js graph remains available for fallback. The [original weights and attribution](../voice_instrumental-musicnn-msd-2/LICENSE) apply to the converted copy as well.

Run the exporters with Python 3.12 and the upstream package dependencies installed. The tempo exporter also uses nnAudio 0.3.3. The key exporter uses onnxruntime, librosa 0.11 and the FMAK audio files indicated in the script. Exporters write to the paths passed on the command line.
