// Captura do microfone e detecção de ataques (onsets). Nada de áudio é gravado ou enviado.
import { ensureAC, ctx } from './audio.js';

let stream = null, proc = null, src = null, sink = null;
let collecting = false, onsets = [], noise = 0.005, lastT = -1, refr = 0.07, prevPeak = 0;
// Um ataque precisa subir em relação ao bloco anterior: assim a cauda de um toque forte
// (que decai ao longo de ~100 ms) não vira um toque falso depois do período refratário.
const RISE = 1.2;

export function micActive() { return !!stream; }

export async function ensureMic() {
  if (stream) return { ok: true };
  ensureAC();
  const AC = ctx();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, msg: 'Este navegador não libera o microfone. Abra o app pelo Safari ou Chrome, em https.' };
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    return { ok: false, msg: 'Sem permissão do microfone. Libere o acesso nas configurações do navegador e tente de novo.' };
  }
  src = AC.createMediaStreamSource(stream);
  proc = AC.createScriptProcessor(1024, 1, 1);
  sink = AC.createGain(); sink.gain.value = 0;
  src.connect(proc); proc.connect(sink); sink.connect(AC.destination);
  proc.onaudioprocess = e => {
    const d = e.inputBuffer.getChannelData(0);
    let peak = 0, pi = 0, rms = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]); rms += a * a;
      if (a > peak) { peak = a; pi = i; }
    }
    rms = Math.sqrt(rms / d.length);
    const thr = Math.max(0.04, noise * 5);
    if (peak < thr) noise = noise * 0.97 + rms * 0.03; // ruído de fundo adaptativo
    const rising = peak > prevPeak * RISE;
    prevPeak = peak;
    if (!collecting || peak < thr || !rising) return;
    const base = e.playbackTime > 0 ? e.playbackTime : AC.currentTime;
    const t = base + pi / AC.sampleRate; // atraso fixo é compensado pela calibração
    if (t - lastT > refr) { lastT = t; onsets.push({ t, peak }); }
  };
  return { ok: true };
}

export function startCollect(refractory = 0.07) {
  onsets = []; lastT = -1; refr = refractory; collecting = true;
}
export function stopCollect() {
  collecting = false;
  return onsets.slice();
}

// Libera o microfone (some o indicador laranja do iPhone)
export function releaseMic() {
  collecting = false;
  if (proc) { proc.onaudioprocess = null; try { proc.disconnect(); src.disconnect(); sink.disconnect(); } catch (e) { /* ignora */ } }
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = proc = src = sink = null;
  prevPeak = 0;
}
