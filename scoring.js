// Lógica pura de avaliação de timing. Sem acesso a áudio/DOM: testável em Node.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
export function median(a) {
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const noteInterval = (bpm, spb) => 60 / bpm / spb;
// janela de aceitação proporcional à velocidade
export const windowFor = interval => clamp(interval * 0.45, 0.04, 0.12);

export function starsFor(score) {
  return score >= 90 ? 3 : score >= 80 ? 2 : score >= 70 ? 1 : 0;
}

// Remove onsets que são o próprio click vazando do alto-falante pro microfone.
export function gateLeak(onsets, clickTimes, calib) {
  if (!calib || calib.leakLatency == null) return onsets;
  return onsets.filter(o => !clickTimes.some(c =>
    Math.abs(o.t - (c + calib.leakLatency)) < 0.015 && o.peak < calib.leakPeak * 1.8));
}

// Casamento 1:1 entre notas esperadas e toques detectados (menor desvio primeiro).
export function matchOnsets(expTimes, onTimes, win) {
  const pairs = [];
  for (let i = 0; i < expTimes.length; i++) {
    for (let j = 0; j < onTimes.length; j++) {
      const d = onTimes[j] - expTimes[i];
      if (Math.abs(d) < win) pairs.push([Math.abs(d), i, j, d]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const devs = new Array(expTimes.length).fill(null), used = new Set();
  for (const [, i, j, d] of pairs) {
    if (devs[i] !== null || used.has(j)) continue;
    devs[i] = d; used.add(j);
  }
  return { devs, extras: onTimes.length - used.size };
}

/**
 * expected: [{t, pos, muted?}] em segundos (clock do AudioContext)
 * onsets:   [{t, peak}]
 */
export function scoreTake({ expected, onsets, clickTimes = [], calib = null, interval }) {
  const total = expected.length;
  const win = windowFor(interval);
  const offset = calib && typeof calib.offset === 'number' ? calib.offset : 0;
  const first = expected[0].t, last = expected[total - 1].t;
  const ons = gateLeak(onsets, clickTimes, calib)
    .map(o => o.t - offset)
    .filter(t => t > first - win && t < last + win);
  const { devs, extras } = matchOnsets(expected.map(e => e.t), ons, win);
  const hit = devs.filter(d => d !== null);
  const base = { total, hits: hit.length, extras, devs, win };
  if (hit.length === 0) {
    return { ...base, score: 0, hitRate: 0, consistency: null, meanAbsMs: null, tendencyMs: null, worst: null };
  }
  const hitRate = hit.length / total;
  const acc = mean(hit.map(d => Math.max(0, 1 - Math.abs(d) / win)));
  const penalty = Math.min(0.1, (extras / total) * 0.3);
  const score = Math.round(100 * hitRate * acc * (1 - penalty));

  // consistência: quão regulares são os intervalos entre toques consecutivos
  const rel = [];
  for (let i = 0; i < total - 1; i++) {
    if (devs[i] === null || devs[i + 1] === null) continue;
    const expIoi = expected[i + 1].t - expected[i].t;
    const actIoi = expIoi + devs[i + 1] - devs[i];
    rel.push(Math.abs(actIoi - expIoi) / expIoi);
  }
  const consistency = rel.length >= 3 ? Math.round(100 * Math.max(0, 1 - 2 * mean(rel))) : null;

  // pior posição do padrão (onde o desvio médio é maior)
  const byPos = {};
  expected.forEach((e, i) => {
    if (devs[i] === null || e.muted) return;
    (byPos[e.pos] = byPos[e.pos] || []).push(devs[i]);
  });
  let worst = null;
  for (const pos of Object.keys(byPos)) {
    const arr = byPos[pos];
    if (arr.length < 2) continue;
    const avg = mean(arr);
    if (Math.abs(avg) >= 0.012 && (!worst || Math.abs(avg) > Math.abs(worst.avg))) worst = { pos: +pos, avg };
  }

  const res = {
    ...base, score, hitRate,
    consistency,
    meanAbsMs: Math.round(mean(hit.map(Math.abs)) * 1000),
    tendencyMs: Math.round(mean(hit) * 1000),
    worst: worst ? { pos: worst.pos, avgMs: Math.round(worst.avg * 1000) } : null,
  };

  // gap click: deriva nos compassos sem click
  const mutedDevs = expected.map((e, i) => (e.muted ? devs[i] : undefined)).filter(d => d !== undefined);
  if (mutedDevs.length) {
    const mh = mutedDevs.filter(d => d !== null);
    res.gap = {
      hits: mh.length, total: mutedDevs.length,
      tendencyMs: mh.length ? Math.round(mean(mh) * 1000) : null,
      meanAbsMs: mh.length ? Math.round(mean(mh.map(Math.abs)) * 1000) : null,
    };
  }
  return res;
}

// Diagnóstico em linguagem de baterista
export function describe(res, rud) {
  if (!res || res.hits === 0) {
    return { title: 'Nenhum toque detectado', text: 'Aproxime o celular do pad, toque mais firme e evite barulho no ambiente.' };
  }
  if (res.gap && res.gap.tendencyMs !== null && Math.abs(res.gap.tendencyMs) >= 10) {
    const dir = res.gap.tendencyMs < 0 ? 'acelera' : 'atrasa';
    return { title: `Sem o click você ${dir}`, text: `Nos compassos mudos seus toques ficaram em média ${Math.abs(res.gap.tendencyMs)} ms ${res.gap.tendencyMs < 0 ? 'adiantados' : 'atrasados'}. Conte os tempos em voz alta durante o silêncio.` };
  }
  if (res.worst) {
    const tok = rud.tokens[res.worst.pos] || {};
    const beat = Math.floor(res.worst.pos / rud.spb) + 1;
    const late = res.worst.avgMs > 0;
    return {
      title: late ? `Você atrasa no tempo ${beat}` : `Você corre no tempo ${beat}`,
      text: `A nota ${res.worst.pos + 1} do padrão (${tok.hand || '?'}) chega em média ${Math.abs(res.worst.avgMs)} ms ${late ? 'atrasada' : 'adiantada'}. Toque mais devagar e mire essa nota.`,
    };
  }
  if (res.tendencyMs !== null && Math.abs(res.tendencyMs) >= 8) {
    return res.tendencyMs < 0
      ? { title: 'Você está correndo', text: `Seus toques chegam em média ${-res.tendencyMs} ms antes do click. Relaxe e deixe o click vir até você.` }
      : { title: 'Você está atrasando', text: `Seus toques chegam em média ${res.tendencyMs} ms depois do click. Antecipe levemente o movimento.` };
  }
  if (res.hitRate < 0.85) {
    return { title: 'Notas faltando', text: `Detectei ${res.hits} de ${res.total} notas. Toques fracos (como o 2º do diddle) podem não ser captados: deixe-os mais definidos.` };
  }
  return { title: 'Timing equilibrado', text: 'Sem tendência clara de correr ou atrasar. Se a precisão estiver alta, é hora de subir o BPM.' };
}

// ---------- calibração ----------
// Fase 1, em silêncio: mede se (e com que atraso/volume) o click vaza pro microfone.
export function analyzeSilent(clickTimes, onsets) {
  const delays = [], peaks = [];
  for (const c of clickTimes) {
    const o = onsets.find(x => x.t - c > 0 && x.t - c < 0.25);
    if (o) { delays.push(o.t - c); peaks.push(o.peak); }
  }
  if (delays.length >= Math.ceil(clickTimes.length / 2)) {
    return { leakLatency: median(delays), leakPeak: Math.max(...peaks) };
  }
  return { leakLatency: null, leakPeak: 0 };
}
// Fase 2, tocando junto: mede a latência do microfone (offset médio dos toques).
export function analyzePlay(clickTimes, onsets, leak) {
  const ons = gateLeak(onsets, clickTimes, leak).map(o => o.t);
  const { devs } = matchOnsets(clickTimes, ons, 0.2);
  const hit = devs.filter(d => d !== null);
  if (hit.length < 4) return null;
  return median(hit);
}

// Decide o offset de latência. Quando o click vaza pro microfone, o atraso do vazamento
// é a latência real do aparelho (saída + entrada) e não carrega o vício de tempo de quem
// tocou na calibração. Sem vazamento (fone), só resta a medida tocada.
// Retorna também o viés de quem tocou (negativo = correu), quando dá pra separar.
export function resolveCalibration(playOffset, leak) {
  if (playOffset == null) return null;
  if (leak && leak.leakLatency != null) {
    return { offset: leak.leakLatency, source: 'leak', biasMs: Math.round((playOffset - leak.leakLatency) * 1000) };
  }
  return { offset: playOffset, source: 'play', biasMs: null };
}
