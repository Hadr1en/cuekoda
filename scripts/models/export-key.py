from pathlib import Path
import argparse
import sys
import tempfile

import librosa
import numpy as np
import torch
from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static

# Public FMAK calibration files, separate from the 24 tracks used for confirmation.
CALIBRATION = (71504, 80076, 115361, 87235, 42756, 58237, 1091, 51430, 97882, 102157, 59198, 91089, 82866, 42744)

parser = argparse.ArgumentParser(description="Export and quantize OpenKeyScan 3")
parser.add_argument("upstream", type=Path, help="Pinned OpenKeyScan checkout")
parser.add_argument("calibration", type=Path, help="FMAK MP3s named by track id")
parser.add_argument("output", type=Path, help="Destination ONNX file")
args = parser.parse_args()
sys.path.insert(0, str(args.upstream.resolve()))
from model import KeyNet


def features(file):
    waveform, rate = librosa.load(file, sr=44100, mono=True)
    spec = librosa.cqt(waveform, sr=rate, hop_length=8820, n_bins=105, bins_per_octave=24, fmin=65)
    return np.ascontiguousarray(np.log1p(np.abs(spec[:, :-2]))[None, None], dtype="float32")


class Calibration(CalibrationDataReader):
    def __init__(self):
        self.examples = iter({"audio": features(args.calibration / f"{track}.mp3")} for track in CALIBRATION)

    def get_next(self):
        return next(self.examples, None)


torch.set_num_threads(1)
model = KeyNet(Nf=64)
weights = args.upstream / "checkpoints" / "openkeyscan3.pt"
model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
model.eval()
with tempfile.TemporaryDirectory() as scratch:
    fp32 = Path(scratch) / "openkeyscan-fp32.onnx"
    torch.onnx.export(
        model, torch.zeros(1, 1, 105, 480), fp32,
        input_names=["audio"], output_names=["logits"], opset_version=17, dynamo=False,
        dynamic_axes={"audio": {3: "frames"}},
    )
    quantize_static(
        fp32, args.output, Calibration(), quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QInt8, weight_type=QuantType.QInt8,
        per_channel=True, op_types_to_quantize=["Conv"],
    )
