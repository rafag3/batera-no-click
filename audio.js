// Motor de áudio: contexto único, sons sintetizados e controle de "quem está tocando".
let AC = null, master = null, vol = 0.8, soundKey = 'wood', owner = null, noiseBuf = null;

const SOUNDS = {
  wood: { wave: 'triangle', hi: 1650, mid: 1080, low: 760, noise: 1.0, dec: 0.07 },
  beep: { wave: 'square', hi: 1760, mid: 1175, low: 880, noise: 0.2, dec: 0.08 },
  rim:  { wave: 'square', hi: 2300, mid: 1700, low: 1250, noise: 1.6, dec: 0.05 },
};

export function ctx() { return AC; }

export function ensureAC() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = vol; master.connect(AC.destination);
    const len = Math.floor(AC.sampleRate * 0.03);
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.25));
  }
  if (AC.state === 'suspended') AC.resume();
  // desbloqueio no iOS: buffer mudo dentro do gesto do usuário
  try {
    const b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
    s.buffer = b; s.connect(AC.destination); s.start(0);
  } catch (e) { /* ignora */ }
  return AC;
}

export function setVolume(v) { vol = v; if (master) master.gain.value = v; }
export function setSound(k) { if (SOUNDS[k]) soundKey = k; }

// Barramento descartável: desconectar cancela tudo que já foi agendado nele.
export function createBus() {
  const g = AC.createGain(); g.gain.value = 1; g.connect(master);
  return g;
}

// Só uma fonte toca por vez (metrônomo, loop de rudimento, avaliação).
export function claim(name, stop) {
  if (owner && owner.name !== name) { const o = owner; owner = null; try { o.stop(); } catch (e) { /* ignora */ } }
  owner = { name, stop };
}
export function release(name) { if (owner && owner.name === name) owner = null; }
export function stopAll() { if (owner) { const o = owner; owner = null; try { o.stop(); } catch (e) { /* ignora */ } } }

function env(g, time, gain, dec) {
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dec);
}

// kind: hi (acento) · mid (tempo) · low (subdivisão)
export function clickAt(time, kind, gain = 1, dest = master) {
  const s = SOUNDS[soundKey];
  const g = AC.createGain(); env(g, time, gain, s.dec); g.connect(dest);
  const o = AC.createOscillator(); o.type = s.wave; o.frequency.value = s[kind];
  o.connect(g); o.start(time); o.stop(time + s.dec + 0.02);
  const g2 = AC.createGain(); env(g2, time, gain * 0.5, s.dec * 0.7); g2.connect(dest);
  const o2 = AC.createOscillator(); o2.type = 'sine'; o2.frequency.value = s[kind] * 2;
  o2.connect(g2); o2.start(time); o2.stop(time + s.dec + 0.02);
  if (s.noise > 0) {
    const src = AC.createBufferSource(); src.buffer = noiseBuf;
    const ng = AC.createGain(); ng.gain.value = gain * 0.5 * s.noise;
    src.connect(ng); ng.connect(dest); src.start(time);
  }
}

// Som de mão: direita aguda à direita do estéreo, esquerda grave à esquerda.
export function handAt(time, hand, gain = 1, dest = master) {
  const R = hand === 'R';
  const g = AC.createGain(); env(g, time, gain, 0.06);
  let out = g;
  if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = R ? 0.5 : -0.5; g.connect(p); out = p; }
  out.connect(dest);
  const o = AC.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(R ? 540 : 390, time);
  o.frequency.exponentialRampToValueAtTime(R ? 300 : 220, time + 0.05);
  o.connect(g); o.start(time); o.stop(time + 0.09);
}

export function testBeep() {
  ensureAC();
  const t = AC.currentTime + 0.05, o = AC.createOscillator(), g = AC.createGain();
  o.type = 'square'; o.frequency.value = 880;
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + 0.55);
  return new Promise(r => setTimeout(() => r(AC.state === 'running'), 700));
}
