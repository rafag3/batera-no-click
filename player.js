// Execução de exercícios: guia em loop, take avaliado e sequência de calibração.
// Também desenha a partitura (células) e o palco com as baquetas.
import { ensureAC, ctx, clickAt, handAt, claim, release, createBus } from './audio.js';
import { startCollect, stopCollect } from './mic.js';

// ---------- desenho ----------
export function renderCells(el, rud, { hideCounts = false } = {}) {
  el.innerHTML = '';
  let grp = null;
  const cells = [];
  rud.tokens.forEach((p, i) => {
    if (i % rud.spb === 0) {
      grp = document.createElement('div'); grp.className = 'bgroup';
      if (!hideCounts) {
        const n = document.createElement('span'); n.className = 'bnum'; n.textContent = i / rud.spb + 1; grp.appendChild(n);
      }
      el.appendChild(grp);
    }
    const c = document.createElement('div');
    if (p.rest) {
      c.className = 'cell rest';
      c.innerHTML = '<span class="acc"></span><span class="hand">·</span><span class="grace"></span>';
    } else {
      c.className = 'cell ' + p.hand + (p.acc ? ' accented' : '');
      const gl = p.hand === 'R' ? 'l' : 'r';
      const g = p.buzz ? 'zzz' : p.grace === 1 ? gl : p.grace === 2 ? gl + ' ' + gl : '';
      c.innerHTML = `<span class="acc">${p.acc ? '&gt;' : ''}</span><span class="hand">${p.hand}</span><span class="grace">${g}</span>`;
    }
    grp.appendChild(c); cells.push(c);
  });
  let cur = null;
  return {
    highlight(i) {
      if (cur) cur.classList.remove('now');
      cur = i == null ? null : cells[i];
      if (cur) cur.classList.add('now');
    },
  };
}

export function renderStage(el) {
  el.innerHTML = `
    <svg viewBox="0 0 300 140" aria-hidden="true">
      <ellipse cx="150" cy="104" rx="88" ry="26" fill="#23202E" stroke="#2E2940" stroke-width="2"/>
      <ellipse cx="150" cy="100" rx="80" ry="22" fill="#1B1824" stroke="#3A3450" stroke-width="1.5"/>
      <circle class="flash" cx="150" cy="98" r="16" fill="none" stroke-width="3"/>
      <g class="stick L"><line x1="70" y1="28" x2="146" y2="90" stroke="#3EB8F0" stroke-width="6" stroke-linecap="round"/><circle cx="149" cy="93" r="5.5" fill="#3EB8F0"/></g>
      <g class="stick R"><line x1="230" y1="28" x2="154" y2="90" stroke="#FF8A2B" stroke-width="6" stroke-linecap="round"/><circle cx="151" cy="93" r="5.5" fill="#FF8A2B"/></g>
    </svg>`;
  const sticks = { R: el.querySelector('.stick.R'), L: el.querySelector('.stick.L') };
  const flash = el.querySelector('.flash');
  const to = { R: null, L: null };
  return {
    strike(hand, acc) {
      const s = sticks[hand]; if (!s) return;
      clearTimeout(to[hand]);
      s.classList.remove('hit', 'acc'); void s.getBBox();
      s.classList.add('hit'); if (acc) s.classList.add('acc');
      if (acc) { flash.setAttribute('stroke', hand === 'R' ? '#FF8A2B' : '#3EB8F0'); flash.classList.add('on'); }
      to[hand] = setTimeout(() => { s.classList.remove('hit', 'acc'); flash.classList.remove('on'); }, 90);
    },
  };
}

function scheduleTok(tok, t, dest) {
  if (tok.rest) return;
  if (tok.buzz) { for (let k = 0; k < 5; k++) handAt(t + k * 0.018, tok.hand, 0.25, dest); return; }
  const gh = tok.hand === 'R' ? 'L' : 'R';
  for (let k = tok.grace; k > 0; k--) handAt(t - k * 0.028, gh, 0.3, dest);
  handAt(t, tok.hand, tok.acc ? 1 : 0.55, dest);
}

// Dispara callbacks de UI no momento em que cada evento soa
function uiPump(queue, isAlive, fn) {
  const AC = ctx();
  const tick = () => {
    if (!isAlive()) return;
    const now = AC.currentTime;
    while (queue.length && queue[0].t <= now) fn(queue.shift());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- guia em loop (ouvir / aquecimento) ----------
export function playLoop(rud, bpm, { onStep, owner = 'loop' } = {}) {
  const AC = ensureAC();
  const dt = 60 / bpm / rud.spb, L = rud.tokens.length;
  let idx = 0, next = AC.currentTime + 0.1, alive = true;
  const q = [], bus = createBus();
  const sched = () => {
    while (next < AC.currentTime + 0.12) {
      const i = idx % L, tok = rud.tokens[i];
      scheduleTok(tok, next, bus);
      if (idx % rud.spb === 0) clickAt(next, i === 0 ? 'hi' : 'mid', 0.45, bus);
      q.push({ t: next, i, tok });
      next += dt; idx++;
    }
  };
  sched();
  const timer = setInterval(sched, 25);
  uiPump(q, () => alive, n => onStep && onStep(n.i, n.tok));
  const stop = () => {
    if (!alive) return;
    alive = false; clearInterval(timer);
    try { bus.disconnect(); } catch (e) { /* ignora */ }
    release(owner);
    if (onStep) onStep(null, null);
  };
  claim(owner, stop);
  return { stop };
}

// ---------- take avaliado ----------
// Durante a avaliação só o click soa (o som das mãos confundiria o microfone).
export function repsFor(rud, gap) {
  const L = rud.tokens.length;
  if (gap) return Math.ceil(((gap.on + gap.off) * 2 * 4 * rud.spb) / L); // 2 ciclos de compassos
  return Math.max(2, Math.ceil(16 / (L / rud.spb)));
}

export function runTake(rud, bpm, { gap = null, onStep, onCount, onMuted, signal } = {}) {
  return new Promise(resolve => {
    const AC = ensureAC();
    const spb = rud.spb, dt = 60 / bpm / spb, beat = 60 / bpm, L = rud.tokens.length;
    const reps = repsFor(rud, gap), total = L * reps;
    const bus = createBus();
    const t0 = AC.currentTime + 0.35, start = t0 + 4 * beat;
    const expected = [], clickTimes = [], q = [];
    let alive = true;

    for (let i = 0; i < 4; i++) {
      const t = t0 + i * beat;
      clickAt(t, i === 0 ? 'hi' : 'mid', 0.9, bus); clickTimes.push(t);
      q.push({ t, count: 4 - i });
    }
    for (let n = 0; n < total; n++) {
      const t = start + n * dt, tok = rud.tokens[n % L];
      const bar = Math.floor(n / spb / 4);
      const muted = !!gap && bar % (gap.on + gap.off) >= gap.on;
      if (n % spb === 0 && !muted) {
        clickAt(t, n % (spb * 4) === 0 ? 'hi' : 'mid', 0.8, bus); clickTimes.push(t);
      }
      if (!tok.rest && !tok.buzz) expected.push({ t, pos: n % L, muted });
      q.push({ t, i: n % L, tok, muted });
    }
    const end = start + total * dt;

    startCollect(Math.min(0.07, dt * 0.6));
    const finish = ok => {
      if (!alive) return;
      alive = false; clearTimeout(timer);
      try { bus.disconnect(); } catch (e) { /* ignora */ }
      const onsets = stopCollect();
      release('take');
      if (onStep) onStep(null, null);
      resolve(ok ? { expected, clickTimes, onsets, interval: dt } : null);
    };
    const timer = setTimeout(() => finish(true), (end - AC.currentTime + 0.5) * 1000);
    claim('take', () => finish(false));
    if (signal) signal.addEventListener('abort', () => finish(false), { once: true });

    let lastMuted = false;
    uiPump(q, () => alive, ev => {
      if (ev.count) { onCount && onCount(ev.count); return; }
      if (ev.muted !== lastMuted) { lastMuted = ev.muted; onMuted && onMuted(ev.muted); }
      if (onStep) onStep(ev.muted ? null : ev.i, ev.muted ? null : ev.tok);
    });
  });
}

// ---------- clicks simples (calibração) ----------
export function runClicks(n, bpm, { onClick, signal } = {}) {
  return new Promise(resolve => {
    const AC = ensureAC();
    const beat = 60 / bpm, bus = createBus(), t0 = AC.currentTime + 0.6;
    const clickTimes = [], q = [];
    let alive = true;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * beat;
      clickAt(t, 'mid', 1, bus); clickTimes.push(t); q.push({ t, i });
    }
    startCollect(0.1);
    const finish = ok => {
      if (!alive) return;
      alive = false; clearTimeout(timer);
      try { bus.disconnect(); } catch (e) { /* ignora */ }
      const onsets = stopCollect();
      release('calib');
      resolve(ok ? { clickTimes, onsets } : null);
    };
    const timer = setTimeout(() => finish(true), (t0 + n * beat - AC.currentTime + 0.6) * 1000);
    claim('calib', () => finish(false));
    if (signal) signal.addEventListener('abort', () => finish(false), { once: true });
    uiPump(q, () => alive, ev => onClick && onClick(ev.i));
  });
}
