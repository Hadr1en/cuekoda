from pathlib import Path
import argparse
import json
import numpy as np
import librosa,librosa.core.constantq as cqt
parser = argparse.ArgumentParser(description="Export the sparse constant-Q filters used by OpenKeyScan")
parser.add_argument("output", type=Path, help="Destination filter JSON")
args = parser.parse_args()
sr=44100
basis=[]
def response(y,n_fft,hop_length,fft_basis,*args,**kwargs):
    basis.append((n_fft,hop_length,fft_basis.copy()))
    return actual(y,n_fft,hop_length,fft_basis,*args,**kwargs)
actual=cqt.__cqt_response
cqt.__cqt_response=response
kwargs=dict(sr=sr,hop_length=8820,n_bins=105,bins_per_octave=24,fmin=65)
audio=np.random.default_rng(972).uniform(-.7,.7,sr*15).astype('float32')
ref=librosa.cqt(audio,**kwargs)
freqs=librosa.cqt_frequencies(105,fmin=65,bins_per_octave=24)
lengths,_=librosa.filters.wavelet_lengths(freqs=freqs,sr=sr,window='hann',gamma=0)
output=[]
end=len(freqs)
for size,hop,filters in basis:
    filters=filters[-end:] if end<filters.shape[0] else filters
    begin=end-filters.shape[0]
    kernels=[]
    for j in range(filters.shape[0]):
        src=filters.getrow(j)
        z=src.data/np.sqrt(lengths[begin+j])
        kernels.append(dict(bin=begin+j,indices=src.indices.tolist(),real=z.real.tolist(),imag=z.imag.tolist()))
    output.append(dict(size=size,hop=hop,kernels=kernels))
    end=begin
args.output.write_text(json.dumps(output, separators=(',', ':')))
