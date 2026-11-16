from pathlib import Path
from types import SimpleNamespace
import argparse
import base64
import json
import math
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
torch.set_num_threads(1)
parser = argparse.ArgumentParser(description="Export the bundled MusiCNN graph to ONNX")
parser.add_argument("source", type=Path, help="Directory containing model.json and its weights")
parser.add_argument("output", type=Path, help="Destination ONNX file")
args = parser.parse_args()
source = args.source
model=json.loads((source/'model.json').read_text())
weights={}
for manifest in model['weightsManifest']:
    payload=b''.join((source/name).read_bytes() for name in manifest['paths'])
    offset=0
    for info in manifest['weights']:
        dtype={'float32':'<f4','int32':'<i4'}[info['dtype']]
        size=math.prod(info['shape'])
        value=np.frombuffer(payload,dtype,count=size,offset=offset).reshape(info['shape']).copy()
        weights[info['name']]=value
        offset+=value.nbytes
    assert offset==len(payload)

def attrs(value):
    if 'i'in value:return int(value['i'])
    if 'b'in value:return value['b']
    if 's'in value:return base64.b64decode(value['s']).decode()
    if 'list'in value:
        v=value['list']
        if 'i'in v:return tuple(int(x) for x in v['i'])
        if 's'in v:return tuple(base64.b64decode(x).decode() for x in v['s'])
    return None

class Voice(nn.Module):
    def __init__(self):
        super().__init__()
        self.mapping={}
        self.graph=[]
        for i,(name, weight) in enumerate(weights.items()):
            if weight.dtype==np.dtype('float32'):
                buffer=f'w{i}'
                self.mapping[name]=buffer
                self.register_buffer(buffer,torch.from_numpy(weight))
        for n in model['modelTopology']['node']:
            name,op=n['name'],n['op']
            if op in ('Placeholder','Const','Shape','StridedSlice','Pack'):continue
            config={name:attrs(v) for name,v in n.get('attr',{}).items()}
            self.graph.append((name,op,n.get('input',[]),SimpleNamespace(**config)))

    def forward(self,x):
        values={'model/Placeholder':x}
        values.update((k,getattr(self,v)) for k,v in self.mapping.items())
        def dims(name):return tuple(int(x) for x in weights[name].reshape(-1))
        for name,op,a,p in self.graph:
            x=values[a[0]]
            if op=='ExpandDims':q=x.unsqueeze(dims(a[1])[0])
            elif op=='Squeeze':q=x.squeeze(p.squeeze_dims[0])
            elif op=='Mul':q=x*values[a[1]]
            elif op in ('Add','AddV2'):q=x+values[a[1]]
            elif op=='Transpose':q=x.permute(dims(a[1]))
            elif op=='Pad':
                q=F.pad(x,tuple(v for part in list(zip(*[iter(dims(a[1]))]*2))[::-1] for v in part))
            elif op=='MaxPool':
                q=F.max_pool2d(x.permute(0,3,1,2),p.ksize[1:3],p.strides[1:3]).permute(0,2,3,1)
            elif op=='ConcatV2':
                q=torch.cat([values[n] for n in a[:-1]],dim=dims(a[-1])[0])
            elif op=='Max':q=x.amax(dims(a[1]))
            elif op=='Mean':q=x.mean(dims(a[1]),keepdim=p.keep_dims)
            elif op=='Reshape':q=x.reshape(x.shape[0],-1)
            elif op=='_FusedConv2D':
                assert p.strides==(1,1,1,1) and p.fused_ops==('BiasAdd','Relu')
                conv=x.permute(0,3,1,2)
                kernel=values[a[1]].permute(3,2,0,1)
                if p.padding=='SAME':
                    h,w=weights[a[1]].shape[:2]
                    conv=F.pad(conv,((w-1)//2,w//2,(h-1)//2,h//2))
                q=F.conv2d(conv,kernel,values[a[2]]).relu().permute(0,2,3,1)
            elif op=='_FusedMatMul':
                assert not p.transpose_a and not p.transpose_b
                q=x@values[a[1]]+values[a[2]]
                if 'Relu' in p.fused_ops:q=q.relu()
            elif op=='Sigmoid':q=x.sigmoid()
            else:raise ValueError(op)
            values[name]=q
        return values['model/Sigmoid']

path = args.output
m=Voice().eval()
torch.onnx.export(m,torch.rand(4,187,96),path,input_names=['mel'],output_names=['logits'],
    opset_version=17,dynamo=False,dynamic_axes={'mel':{0:'patches'},'logits':{0:'patches'}})
print(path.stat().st_size)
