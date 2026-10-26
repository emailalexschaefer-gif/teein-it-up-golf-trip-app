# Original synthesised crowd applause + cheers. Generated from random noise and oscillators; no samples, no third-party audio.
import numpy as np
from scipy import signal
rng = np.random.default_rng(2610)   # fixed seed: reproducible
SR = 44100; DUR = 9.4; N = int(SR*DUR)
t = np.arange(N)/SR
def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos'); return signal.sosfilt(sos, x)
# crowd density (claps per second): swell in, sustain, die away
dens = np.interp(t, [0, 0.25, 1.4, 6.0, 9.4], [0, 30, 140, 120, 6])
# individual claps
out = np.zeros(N)
clap_t = []
x = 0.0
while x < DUR:
    d = np.interp(x, t, dens)
    x += rng.exponential(1.0/max(d, 1.0))
    if x < DUR: clap_t.append(x)
for ct in clap_t:
    L = int(rng.uniform(0.012, 0.05)*SR)
    n = rng.standard_normal(L) * np.exp(-np.arange(L)/(L*rng.uniform(0.12, 0.3)))
    c = rng.uniform(1100, 3200)
    sos = signal.butter(2, [c*0.6, min(c*1.9, 9000)], btype='band', fs=SR, output='sos')
    n = signal.sosfilt(sos, n) * rng.uniform(0.15, 1.0)
    i = int(ct*SR); j = min(N, i+L); out[i:j] += n[:j-i]
# diffuse wash from the crowd/room
wash = bp(rng.standard_normal(N), 500, 5000) * np.interp(t, [0, 1.0, 6.0, 9.4], [0, 0.22, 0.2, 0.01])*0.5
out = out/np.max(np.abs(out))*0.8 + wash
# light room reverb: decaying noise impulse
ir = rng.standard_normal(int(0.45*SR)) * np.exp(-np.arange(int(0.45*SR))/(0.12*SR)); ir /= np.sum(np.abs(ir))
out = 0.65*out + 0.35*signal.fftconvolve(out, ir)[:N]*3
# cheers: a few voiced "woo/yeah" glides through vowel formants
def cheer(start, f0a, f0b, dur, form, amp):
    L = int(dur*SR); tt = np.arange(L)/SR
    f0 = np.linspace(f0a, f0b, L) * (1 + 0.012*np.sin(2*np.pi*5.5*tt))
    ph = 2*np.pi*np.cumsum(f0)/SR
    src = signal.sawtooth(ph) + 0.03*rng.standard_normal(L)
    v = np.zeros(L)
    for fc, bw, g in form:
        sos = signal.butter(2, [max(fc-bw, 50), fc+bw], btype='band', fs=SR, output='sos'); v += g*signal.sosfilt(sos, src)
    env = np.minimum(1, tt/0.08) * np.minimum(1, (dur-tt)/0.25)
    v = v*env; v = v/np.max(np.abs(v))*amp
    i = int(start*SR); j = min(N, i+L); out[i:j] += v[:j-i]
OO = [(350, 90, 1.0), (800, 120, 0.4)]; AH = [(750, 110, 1.0), (1150, 150, 0.6)]
for s in rng.uniform(1.0, 6.2, 9):
    f = rng.uniform(150, 330) if rng.random() < .5 else rng.uniform(220, 420)
    cheer(s, f, f*rng.uniform(1.15, 1.5), rng.uniform(0.55, 1.1), OO if rng.random() < .6 else AH, rng.uniform(0.10, 0.2))
# fade tails, normalise to -3 dBFS peak
out *= np.minimum(1, t/0.03) * np.minimum(1, (DUR-t)/1.2)
out = out/np.max(np.abs(out)) * 0.708
st = np.stack([out, np.roll(out, 23)], 1)   # tiny inter-channel offset for width
pcm = (st*32767).astype('<i2')
open('applause.raw', 'wb').write(pcm.tobytes())
print('claps', len(clap_t), 'peak', float(np.max(np.abs(out))), 'rms', float(np.sqrt(np.mean(out**2))))
