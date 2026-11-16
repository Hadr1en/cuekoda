from pathlib import Path
import argparse
import sys

parser = argparse.ArgumentParser(description="Export DeepRhythm and its fixed CQT to ONNX")
parser.add_argument("upstream", type=Path, help="Pinned DeepRhythm checkout")
parser.add_argument("output", type=Path, help="Destination ONNX file")
args = parser.parse_args()
sys.path.insert(0, str(args.upstream.resolve() / "src"))

import torch
from torch import nn
from deeprhythm.audio_proc.hcqm import make_kernels
from deeprhythm.model.frame_cnn import DeepRhythmModel

torch.set_num_threads(1)
_, filters, cqts=make_kernels(device='cpu')
network=DeepRhythmModel()
weights = args.upstream / 'weights' / 'deeprhythm-0.7.pth'
network.load_state_dict(torch.load(weights,map_location='cpu',weights_only=True))
width=345
index=torch.arange(width)
proj=[]
for cqt in cqts:
    window=cqt.kernel_width
    gains=cqt.lenghts.sqrt().reshape(240,1)
    for start in [window//2,window//2-cqt.hop_length]:
        pos=index+start
        inside=(pos>=0)&(pos<window)
        take=pos.clamp(0,window-1)
        proj.extend([cqt.cqt_kernels_real[:,0,take]*inside*gains,
                     cqt.cqt_kernels_imag[:,0,take]*inside*gains])
class Model(nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer('projection',torch.cat(proj,dim=0).T.contiguous())
        self.network = network
    def forward(self,onsets):
        series=torch.matmul(onsets,self.projection).reshape(-1,8,6,2,2,240)
        hcqm=series.square().sum(4).sqrt().mean(3).permute(0,1,3,2).reshape(-1,240,8,6).permute(0,3,1,2)
        return self.network(hcqm)
model=Model().eval()
path = args.output
torch.onnx.export(model,torch.rand(5,8,345),path,input_names=['onsets'],output_names=['logits'],opset_version=17,dynamo=False,dynamic_axes={'onsets':{0:'clips'},'logits':{0:'clips'}})
print(path.stat().st_size,[c.kernel_width for c in cqts],flush=True)
