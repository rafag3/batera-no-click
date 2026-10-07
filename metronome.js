// Aba Metrônomo: click com clock da Web Audio, tap tempo, speed trainer e BPM por upload.
import { ensureAC, ctx, clickAt, claim, release, setSound, setVolume, testBeep } from './audio.js';
import { keepAwake, allowSleep } from './wakelock.js';

const $ = id => document.getElementById(id);
let bpm = 120, running = false, sig = 4, sub = 1;
let nextT = 0, beat = 0, subI = 0, timer = null, uiQ = [], trainerBars = 0;

// Compassos em /8: o pulso forte cai no início de cada grupo (6/8 = 3+3, 7/8 = 2+2+3).
// Nos demais, todo tempo é forte.
const GROUP_STARTS = { 6: [0, 3], 7: [0, 2, 4] };
const strongBeat = b => (GROUP_STARTS[sig] ? GROUP_STARTS[sig].includes(b) : true);

function setBpm(v) { bpm = Math.min(300, Math.max(20, Math.round(v))); $('bpmNum').textContent = bpm; }

function buildPads() {
  const c = $('pads'); c.innerHTML = '';
  for (let b = 0; b < sig; b++) for (let s = 0; s < sub; s++) {
    const d = document.createElement('div');
    d.className = 'pad' + (s === 0 && strongBeat(b) ? ' beat' : ''); d.dataset.i = b * sub + s; c.appendChild(d);
  }
}

function trainerTick() {
  if (!$('stOn').checked) return;
  trainerBars++;
  const every = +$('stEvery').value || 4, inc = +$('stInc').value || 5, to = +$('stTo').value || 120;
  if (trainerBars >= every && bpm < to) { trainerBars = 0; setBpm(Math.min(to, bpm + inc)); }
  $('stLive').textContent = `Speed trainer: ${bpm} BPM, meta ${to}`;
}

function schedule() {
  const AC = ctx();
  while (nextT < AC.currentTime + 0.12) {
    const isOne = beat === 0 && subI === 0, isBeat = subI === 0 && strongBeat(beat);
    if (isOne && $('chkAccent').checked) clickAt(nextT, 'hi', 1);
    else if (isBeat) clickAt(nextT, 'mid', 0.9);
    else clickAt(nextT, 'low', 0.55);
    uiQ.push({ t: nextT, i: beat * sub + subI, one: isOne });
    nextT += 60 / bpm / sub;
    subI++; if (subI >= sub) { subI = 0; beat++; }
    if (beat >= sig) { beat = 0; trainerTick(); }
  }
}

let lastPad = null;
function uiLoop() {
  if (!running) return;
  const now = ctx().currentTime;
  while (uiQ.length && uiQ[0].t <= now) {
    const n = uiQ.shift();
    if (lastPad) lastPad.classList.remove('hit', 'one');
    lastPad = document.querySelector(`.pad[data-i="${n.i}"]`);
    if (lastPad) { lastPad.classList.add('hit'); if (n.one) lastPad.classList.add('one'); }
  }
  requestAnimationFrame(uiLoop);
}

function start() {
  const AC = ensureAC();
  if ($('stOn').checked) { setBpm(+$('stFrom').value || 80); trainerBars = 0; $('stLive').hidden = false; }
  claim('metro', stop);
  running = true; beat = 0; subI = 0; uiQ = [];
  nextT = AC.currentTime + 0.08;
  timer = setInterval(schedule, 25); schedule(); uiLoop();
  keepAwake('metro');
  $('btnStart').textContent = 'Parar'; $('btnStart').classList.add('stop');
}

export function stop() {
  if (!running) return;
  running = false; clearInterval(timer); uiQ = [];
  allowSleep('metro');
  if (lastPad) lastPad.classList.remove('hit', 'one');
  release('metro');
  $('btnStart').textContent = 'Tocar'; $('btnStart').classList.remove('stop');
  $('stLive').hidden = true;
}

// ---------- detecção de BPM (autocorrelação do envelope de energia) ----------
export function detectBPM(buf) {
  const ch = buf.getChannelData(0), sr = buf.sampleRate;
  const hop = 512, frames = Math.floor(ch.length / hop) - 2, fps = sr / hop;
  const env = new Float32Array(frames); let prev = 0;
  for (let i = 0; i < frames; i++) {
    let e = 0; const off = i * hop;
    for (let j = 0; j < hop; j++) { const v = ch[off + j]; e += v * v; }
    e = Math.sqrt(e / hop); env[i] = Math.max(0, e - prev); prev = e;
  }
  const a = Math.floor(frames * 0.15), b = Math.floor(frames * 0.85);
  let best = { bpm: 120, score: -1 }; const scores = [];
  for (let t = 60; t <= 200; t += 0.5) {
    const period = fps * 60 / t; let s = 0, n = 0;
    for (let i = a; i < b - period * 4; i += Math.floor(period)) {
      for (let k = 1; k <= 3; k++) { const idx = Math.round(i + period * k); if (idx < b) { s += env[i] * env[idx]; n++; } }
    }
    s = n ? s / n : 0; scores.push({ t, s });
    if (s > best.score) best = { bpm: Math.round(t), score: s };
  }
  let v = best.bpm;
  if (v < 80 && v * 2 <= 200) v *= 2;
  if (v > 170 && v % 2 === 0 && v / 2 >= 60) {
    const half = scores.find(x => Math.round(x.t) === v / 2);
    if (half && half.s > best.score * 0.6) v = v / 2;
  }
  const alts = [...new Set([Math.round(v / 2), Math.round(v * 2)])].filter(x => x >= 40 && x <= 300);
  return { bpm: v, alts };
}

export function initMetronome() {
  buildPads();
  $('btnStart').onclick = () => (running ? stop() : start());
  document.querySelectorAll('[data-d]').forEach(b => { b.onclick = () => setBpm(bpm + +b.dataset.d); });
  $('selSig').onchange = e => { sig = +e.target.value; beat = 0; subI = 0; buildPads(); };
  $('selSub').onchange = e => { sub = +e.target.value; beat = 0; subI = 0; buildPads(); };
  $('selSound').onchange = e => setSound(e.target.value);
  $('rngVol').oninput = e => setVolume(e.target.value / 100);
  $('btnTest').onclick = async () => {
    const b = $('btnTest'); b.textContent = 'Tocando…';
    const ok = await testBeep();
    b.textContent = ok ? 'Testar som' : 'Áudio bloqueado: toque de novo';
  };

  // arrastar o número
  const el = $('bpmNum'); let sx = 0, sb = 0, drag = false;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); drag = true; sx = e.clientX; sb = bpm; });
  el.addEventListener('pointermove', e => { if (drag) setBpm(sb + Math.round((e.clientX - sx) / 4)); });
  el.addEventListener('pointerup', () => { drag = false; });

  // tap tempo
  let taps = [];
  $('btnTap').onclick = () => {
    const AC = ensureAC(), t = performance.now();
    if (taps.length && t - taps[taps.length - 1] > 2200) taps = [];
    taps.push(t); if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const iv = []; for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
      setBpm(60000 / (iv.reduce((x, y) => x + y) / iv.length));
    }
    clickAt(AC.currentTime, 'mid', 0.7);
  };

  // atalhos de teclado (desktop): espaço toca/para, T marca o tap tempo
  document.addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !$('v-metro').classList.contains('on')) return;
    // campos de formulário ficam com o teclado; no botão Tocar o espaço já aciona o clique nativo
    if (e.target.closest('input, select, textarea, summary') || e.target === $('btnStart')) return;
    if (e.code === 'Space') { e.preventDefault(); running ? stop() : start(); }
    else if (e.code === 'KeyT') $('btnTap').click();
  });

  // upload
  $('fileAudio').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const AC = ensureAC(), st = $('bpmDetStatus');
    st.textContent = `Analisando "${f.name}"…`; $('bpmDetResult').hidden = true;
    try {
      const buf = await AC.decodeAudioData(await f.arrayBuffer());
      const r = detectBPM(buf);
      st.textContent = '';
      $('bpmDetValue').textContent = r.bpm + ' BPM';
      $('bpmDetAlt').textContent = 'Também pode ser: ' + r.alts.join(' ou ') + ' BPM';
      $('bpmDetResult').hidden = false;
      $('btnUseBpm').onclick = () => { setBpm(r.bpm); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    } catch (err) {
      st.textContent = 'Não foi possível ler esse arquivo. Use mp3, m4a ou wav.';
    }
  };
}
