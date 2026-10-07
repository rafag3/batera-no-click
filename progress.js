// Progressão local: XP, nível, streak, recordes e trilhas. Funções puras sobre o objeto de estado.
import { TRAILS, getTrail, trailIndex } from './trails.js';
import { starsFor, clamp } from './scoring.js';

export const XP_DAILY_CAP = 300;
export const CLEAN_MIN = 85; // precisão mínima pra contar como "BPM limpo"

export function newState() {
  return {
    v: 1, xp: 0, xpDay: { day: null, xp: 0 },
    streak: { count: 0, last: null, freezeWeek: null },
    stages: {}, trail: 'iniciante', unlocked: ['iniciante'],
    records: {}, placed: false, calib: null, today: null, sessions: 0,
  };
}

export function levelInfo(xp) {
  let level = 1, base = 0, cost = 100;
  while (xp >= base + cost) { base += cost; level++; cost = 100 + 50 * (level - 1); }
  return { level, into: xp - base, need: cost };
}

// ---------- datas (sempre no fuso local) ----------
export function dayKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const toDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export function dayDiff(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
export function addDays(k, n) { const d = toDate(k); d.setDate(d.getDate() + n); return dayKey(d); }
export function isoWeek(k) {
  const d = toDate(k); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  const w = 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${w}`;
}

// ---------- streak: 1 sessão avaliada por dia, 1 dia de folga perdoado por semana ----------
export function touchStreak(state, today) {
  const s = state.streak;
  if (s.last === today) return;
  const d = s.last ? dayDiff(s.last, today) : null;
  if (d === 1) s.count++;
  else if (d === 2 && s.freezeWeek !== isoWeek(today)) { s.count++; s.freezeWeek = isoWeek(today); }
  else s.count = 1;
  s.last = today;
}
export function currentStreak(state, today) {
  const s = state.streak;
  if (!s.last) return 0;
  const d = dayDiff(s.last, today);
  if (d <= 1) return s.count;
  if (d === 2 && s.freezeWeek !== isoWeek(today)) return s.count;
  return 0;
}

// ---------- XP ----------
export function sessionXp({ score, bpm, spb }) {
  const mult = clamp(1 + (bpm * spb - 120) / 240, 0.8, 2.5);
  return Math.round(10 + (score / 10) * mult);
}

// Aplica uma sessão avaliada ao estado. Retorna o que mudou (pra tela de resultado).
export function applyScored(state, sess, today) {
  const rec = state.records[sess.rud] || (state.records[sess.rud] = { clean: 0, best: 0 });
  rec.best = Math.max(rec.best, sess.score);
  let newRecord = false, bonus = 0;
  if (sess.score >= CLEAN_MIN && sess.bpm > rec.clean) {
    if (rec.clean > 0) bonus = 25;
    newRecord = true;
    rec.clean = sess.bpm;
  }
  const want = sessionXp(sess) + bonus;
  if (state.xpDay.day !== today) state.xpDay = { day: today, xp: 0 };
  const gained = Math.max(0, Math.min(want, XP_DAILY_CAP - state.xpDay.xp));
  const before = levelInfo(state.xp).level;
  state.xp += gained;
  state.xpDay.xp += gained;
  state.sessions++;
  touchStreak(state, today);
  const after = levelInfo(state.xp).level;
  return { xp: gained, capped: gained < want, newRecord, cleanBpm: rec.clean, levelUp: after > before, level: after };
}

// ---------- trilhas ----------
export function stageWork(state, stage) {
  if (!state.stages[stage.id]) {
    const clean = stage.rud && state.records[stage.rud] ? state.records[stage.rud].clean : 0;
    const start = stage.prova ? null : (clean >= stage.bpm ? stage.bpm : Math.max(40, stage.bpm - 8));
    state.stages[stage.id] = { stars: 0, best: 0, bpm: start, hist: [] };
  }
  return state.stages[stage.id];
}

export function stageUnlocked(state, trail, index) {
  if (!state.unlocked.includes(trail.id)) return false;
  if (index === 0) return true;
  const prev = state.stages[trail.stages[index - 1].id];
  return !!prev && prev.stars >= 1;
}

export function currentStage(state, trail) {
  const st = trail.stages;
  for (let i = 0; i < st.length; i++) {
    if (!stageUnlocked(state, trail, i)) break;
    const w = state.stages[st[i].id];
    if (!w || w.stars === 0) return { stage: st[i], index: i };
  }
  for (let i = 0; i < st.length; i++) {
    const w = state.stages[st[i].id];
    if (stageUnlocked(state, trail, i) && (!w || w.stars < 3)) return { stage: st[i], index: i };
  }
  return { stage: st[st.length - 1], index: st.length - 1 };
}

export function trailProgress(state, trail) {
  let done = 0, stars = 0;
  for (const s of trail.stages) {
    const w = state.stages[s.id];
    if (w && w.stars > 0) { done++; stars += w.stars; }
  }
  return { done, stars, totalStages: trail.stages.length, totalStars: trail.stages.length * 3 };
}

// Resultado de uma etapa normal: estrelas só valem na meta de BPM; BPM de trabalho se adapta.
export function applyStageResult(state, stage, score, bpmPlayed) {
  const w = stageWork(state, stage);
  w.hist = [...w.hist, score].slice(-3);
  let stars = 0, gotNew = false, adapt = null;
  if (bpmPlayed >= stage.bpm) {
    stars = starsFor(score);
    if (stars > w.stars) { w.stars = stars; gotNew = true; }
    w.best = Math.max(w.best, score);
  }
  const last2 = w.hist.slice(-2);
  if (score < 75) {
    w.bpm = Math.max(40, Math.round(w.bpm * 0.9)); w.hist = []; adapt = 'down';
  } else if (w.bpm < stage.bpm && last2.length === 2 && last2.every(s => s >= 90)) {
    w.bpm = Math.min(stage.bpm, w.bpm + 4); w.hist = []; adapt = 'up';
  }
  return { stars, gotNew, adapt, workBpm: w.bpm, target: stage.bpm };
}

export function applyProva(state, trail, stage, scores) {
  const w = stageWork(state, stage);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const stars = avg >= stage.min ? starsFor(avg) : 0;
  let gotNew = false, unlockedTrail = null;
  if (stars > w.stars) { w.stars = stars; gotNew = true; }
  w.best = Math.max(w.best, avg);
  if (stars >= 1) {
    const next = TRAILS[trailIndex(trail.id) + 1];
    if (next && !state.unlocked.includes(next.id)) {
      state.unlocked.push(next.id); state.trail = next.id; unlockedTrail = next;
    }
  }
  return { avg, stars, gotNew, unlockedTrail };
}

// Diagnóstico inicial: define a trilha de partida.
// Refazer o diagnóstico nunca rebaixa: quem já liberou uma trilha mais alta continua nela
// (pra voltar a uma trilha anterior existe a escolha manual na aba Trilha).
export function applyPlacement(state, scores) {
  const wasPlaced = state.placed;
  state.placed = true;
  const ok = scores.length && scores.every(s => s >= 85);
  if (ok && !state.unlocked.includes('intermediario')) state.unlocked.push('intermediario');
  const placed = ok ? 'intermediario' : 'iniciante';
  if (!wasPlaced || trailIndex(placed) > trailIndex(state.trail)) state.trail = placed;
  return { trail: getTrail(state.trail), placed: getTrail(placed) };
}

// Troca manual da trilha ativa (só entre trilhas já liberadas)
export function chooseTrail(state, id) {
  if (!state.unlocked.includes(id) || state.trail === id) return false;
  state.trail = id;
  return true;
}
