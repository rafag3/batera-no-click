// Monta o treino do dia (4 blocos) a partir do estado e do histórico. Função pura.
import { getTrail } from './trails.js';
import { currentStage, stageWork, stageUnlocked, dayDiff, addDays, CLEAN_MIN } from './progress.js';
import { clamp } from './scoring.js';

const EVAL_KINDS = ['foco', 'fraco', 'recorde', 'livre', 'prova', 'diag'];

function recentScored(sessions, today, days) {
  return sessions.filter(s => s.score != null && EVAL_KINDS.includes(s.kind) && dayDiff(s.day, today) <= days);
}

export function pickWeak(sessions, today, excludeRud) {
  const byRud = {};
  for (const s of recentScored(sessions, today, 14)) {
    if (s.rud === excludeRud || s.rud === 'pulso' || s.rud === 'colcheias') continue;
    (byRud[s.rud] = byRud[s.rud] || []).push(s);
  }
  let worst = null;
  for (const rud of Object.keys(byRud)) {
    const last = byRud[rud].slice(-3);
    const avg = last.reduce((a, s) => a + s.score, 0) / last.length;
    if (avg < 88 && (!worst || avg < worst.avg)) {
      const l = last[last.length - 1];
      worst = { rud, avg, bpm: l.score < 75 ? Math.round(l.bpm * 0.9) : l.bpm };
    }
  }
  return worst;
}

export function recentTendency(sessions) {
  const s = sessions.filter(x => x.tendencyMs != null && x.kind !== 'gap').slice(-5);
  if (s.length < 3) return 0;
  return s.reduce((a, x) => a + x.tendencyMs, 0) / s.length;
}

const even2 = n => Math.round(n / 2) * 2;

export function buildWorkout(state, sessions, today) {
  const trail = getTrail(state.trail);
  const { stage, index } = currentStage(state, trail);
  const blocks = [];

  const single = state.records['single-stroke-roll'];
  blocks.push({
    kind: 'warm', label: 'Aquecimento', rud: 'single-stroke-roll',
    bpm: clamp(even2(single && single.clean ? single.clean * 0.7 : 60), 50, 100),
  });

  let focusRud, focusBpm;
  if (stage.prova) {
    blocks.push({ kind: 'prova', label: 'Prova da trilha', stageId: stage.id });
    focusRud = stage.takes[0].rud; focusBpm = stage.takes[0].bpm;
  } else {
    const w = stageWork(state, stage);
    blocks.push({ kind: 'foco', label: 'Foco da trilha', rud: stage.rud, bpm: w.bpm, target: stage.bpm, stageId: stage.id });
    focusRud = stage.rud; focusBpm = w.bpm;
  }

  const weak = pickWeak(sessions, today, focusRud);
  if (weak) {
    blocks.push({ kind: 'fraco', label: 'Ponto fraco', rud: weak.rud, bpm: clamp(weak.bpm, 40, 220) });
  } else {
    // sem histórico suficiente: revisa a etapa anterior já liberada
    const prev = trail.stages.slice(0, index).reverse().find((s, k) => !s.prova && stageUnlocked(state, trail, index - 1 - k));
    const rud = prev ? prev.rud : trail.tracked.find(r => r !== focusRud && r !== 'single-stroke-roll') || trail.tracked[0];
    const bpm = prev ? prev.bpm : focusBpm;
    blocks.push({ kind: 'fraco', label: 'Revisão', rud, bpm });
  }

  const odd = dayDiff('2026-01-01', today) % 2 === 1;
  if (Math.abs(recentTendency(sessions)) >= 10 || odd) {
    blocks.push({ kind: 'gap', label: 'Desafio: gap click', rud: 'colcheias', bpm: clamp(even2(focusBpm), 60, 120), gap: trail.gap });
  } else {
    const rec = state.records[focusRud];
    const base = rec && rec.clean ? rec.clean : focusBpm;
    blocks.push({ kind: 'recorde', label: 'Desafio: recorde', rud: focusRud, bpm: base + 5 });
  }

  return { day: today, blocks: blocks.map(b => ({ ...b, done: false, score: null })) };
}

// Evolução do BPM limpo de um rudimento nos últimos N dias (máximo acumulado por dia)
export function cleanHistory(sessions, rud, today, days = 30) {
  const start = addDays(today, -(days - 1));
  let run = 0;
  for (const s of sessions) {
    if (s.rud === rud && s.score >= CLEAN_MIN && dayDiff(s.day, start) > 0) run = Math.max(run, s.bpm);
  }
  const startVal = run;
  const points = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    for (const s of sessions) if (s.rud === rud && s.day === d && s.score >= CLEAN_MIN) run = Math.max(run, s.bpm);
    points.push(run);
  }
  return { current: run, delta: run - startVal, points };
}
