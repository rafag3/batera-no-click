// Batera no Click — orquestração das telas e do fluxo de treino.
import { CATEGORIES, getRud } from './rudiments-data.js';
import { TRAILS, getTrail, findStage } from './trails.js';
import { scoreTake, describe, analyzeSilent, analyzePlay } from './scoring.js';
import {
  newState, levelInfo, dayKey, currentStreak, applyScored, stageWork, stageUnlocked,
  currentStage, trailProgress, applyStageResult, applyProva, applyPlacement,
} from './progress.js';
import { buildWorkout, cleanHistory } from './workout.js';
import { kvGet, kvSet, addSession, allSessions, clearAll, isVolatile, requestPersist } from './storage.js';
import { ensureAC, stopAll } from './audio.js';
import { ensureMic, releaseMic } from './mic.js';
import { renderCells, renderStage, playLoop, runTake, runClicks, repsFor } from './player.js';
import { initMetronome } from './metronome.js';

const $ = s => document.querySelector(s);
const today = () => dayKey();
let state = newState(), sessions = [];
let view = 'hoje', trailView = null, rudDetail = null, rudBpm = 60, volatile = false;

// ---------- utilidades de UI ----------
const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 6h3a3 3 0 0 1-3 3M7 6H4a3 3 0 0 0 3 3"/></svg>',
};
const STAR = '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/>';
const starsHtml = (n, big = false) =>
  `<div class="stars${big ? ' big' : ''}" aria-label="${n} de 3 estrelas">${[0, 1, 2].map(k => `<svg viewBox="0 0 24 24" class="${k < n ? 'on' : ''}" aria-hidden="true">${STAR}</svg>`).join('')}</div>`;
const scoreColor = s => (s >= 85 ? 'var(--ok)' : s >= 70 ? 'var(--xp)' : 'var(--bad)');
const tendLabel = ms => (ms == null ? '—' : Math.abs(ms) < 8 ? 'No ponto' : ms < 0 ? 'Correndo' : 'Atrasando');
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}
async function save() { await kvSet('state', state); }
function setLevelColor() { document.documentElement.style.setProperty('--lv', getTrail(state.trail).color); }

function ensureToday() {
  if (!state.today || state.today.day !== today()) {
    state.today = buildWorkout(state, sessions, today());
    save();
  }
  return state.today;
}

// ---------- navegação ----------
function show(v) {
  view = v;
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  stopAll();
  render();
  window.scrollTo(0, 0);
}

function render() {
  setLevelColor();
  const st = currentStreak(state, today());
  $('#streakNum').textContent = plural(st, 'dia', 'dias');
  $('#streakChip').classList.toggle('off', st === 0);
  if (view === 'hoje') renderHoje();
  else if (view === 'trilha') renderTrilha();
  else if (view === 'rud') renderRud();
  else if (view === 'perfil') renderPerfil();
}

// ---------- HOJE ----------
function blockSub(b) {
  if (b.kind === 'prova') { const { stage } = findStage(b.stageId); return `Três rudimentos, precisão mínima ${stage.min}`; }
  if (b.kind === 'gap') return `Colcheias a ${b.bpm} BPM, o click some ${plural(b.gap.off, 'compasso', 'compassos')} a cada ${b.gap.on + b.gap.off}`;
  const r = getRud(b.rud);
  let s = `${r.n} a ${b.bpm} BPM`;
  if (b.kind === 'foco' && b.bpm < b.target) s += `, meta ${b.target}`;
  if (b.kind === 'warm') s += ', sem avaliação';
  return s;
}
function blockMinutes(b) {
  if (b.kind === 'warm') return 2;
  const take = (rud, bpm, gap) => { const r = getRud(rud); return ((4 + (repsFor(r, gap) * r.tokens.length) / r.spb) * 60) / bpm + 40; };
  if (b.kind === 'prova') { const { stage } = findStage(b.stageId); return Math.round(stage.takes.reduce((a, t) => a + take(t.rud, t.bpm), 0) / 60); }
  return Math.max(1, Math.round(take(b.rud, b.bpm, b.gap) / 60));
}
function focusTitle(w) {
  const f = w.blocks[1];
  return f.kind === 'prova' ? 'Prova da trilha' : `${getRud(f.rud).n} a ${f.bpm}`;
}
function sparkline(points) {
  const max = Math.max(...points), min = Math.min(...points.filter(p => p > 0), max);
  const span = Math.max(1, max - min);
  const pts = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100;
    const y = p === 0 ? 24 : 22 - ((p - min) / span) * 18;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--ok)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderHoje() {
  const el = $('#v-hoje');
  const tr = getTrail(state.trail);
  const lv = levelInfo(state.xp);
  const w = ensureToday();
  const nextIdx = w.blocks.findIndex(b => !b.done);
  const allDone = nextIdx < 0;
  const anyDone = w.blocks.some(b => b.done);
  const mins = w.blocks.reduce((a, b) => a + blockMinutes(b), 0);
  let h = '';

  if (!state.placed) {
    h += `<div class="card onboard">
      <div class="h2">Comece pelo diagnóstico</div>
      <p class="muted small" style="margin-top:6px">Três minutos: o app calibra o microfone, mede seu timing em dois rudimentos e escolhe a trilha certa pra você.</p>
      <div class="stack"><button class="btn-primary" data-act="diag">Fazer diagnóstico</button>
      <button class="btn-ghost" data-act="skipdiag">Pular e começar no Iniciante</button></div></div>`;
  }

  h += `<div class="card">
    <div class="lv-row"><span class="chip-lv">NÍVEL ${lv.level} · ${tr.name.toUpperCase()}</span>
    <span class="muted small" style="font-weight:600">${lv.into} / ${lv.need} XP</span></div>
    <div class="xpbar"><div style="width:${Math.round((lv.into / lv.need) * 100)}%"></div></div>
    <p class="muted small" style="margin-top:8px">Faltam ${lv.need - lv.into} XP pro nível ${lv.level + 1}</p></div>`;

  h += `<div class="card workout"><div class="head"><div>
      <div class="kicker" style="color:var(--lv)">TREINO DO DIA</div>
      <div class="h2" style="margin-top:4px">${focusTitle(w)}</div></div>
      <span class="muted small" style="font-weight:600;white-space:nowrap">~${mins} min</span></div>
    <div class="stack">${w.blocks.map((b, i) => `
      <div class="blk${b.done ? ' done' : ''}${i === nextIdx ? ' next' : ''}">
        <div class="ix">${b.done ? ICON.check : i + 1}</div>
        <div class="t"><b>${b.label}</b><span>${blockSub(b)}</span></div>
        ${b.done && b.score != null ? `<span class="sc" style="color:${scoreColor(b.score)}">${b.score}</span>` : `<span class="muted small">${blockMinutes(b)} min</span>`}
      </div>`).join('')}</div>
    <div style="margin-top:16px">${allDone
      ? `<button class="btn-primary" disabled>Treino de hoje concluído</button>
         <p class="muted small" style="margin-top:8px;text-align:center">Volte amanhã pro próximo. Se quiser praticar mais, use a aba Rudimentos.</p>`
      : `<button class="btn-primary" data-act="daily">${anyDone ? 'Continuar treino' : 'Começar treino'}</button>`}</div></div>`;

  const last = [...sessions].reverse().find(s => s.diagTitle);
  if (last) {
    h += `<div class="card diag">${ICON.clock}<div><b>${last.diagTitle}</b>
      <p class="muted small" style="margin-top:3px">${getRud(last.rud).n}: ${last.diagText}</p></div></div>`;
  }

  h += `<div class="sec-head"><span class="kicker">BPM LIMPO</span><span class="muted small">últimos 30 dias</span></div>
    <div class="clean-grid">${tr.tracked.map(id => {
      const ch = cleanHistory(sessions, id, today());
      const name = getRud(id).n.replace(' Stroke', '').replace(' Open Roll', '').replace(' Roll', '');
      return `<div class="clean"><div class="n">${name}</div>
        <div class="v">${ch.current || '—'}</div>${ch.current ? sparkline(ch.points) : '<svg viewBox="0 0 100 26"></svg>'}
        <div class="d${ch.delta ? '' : ' zero'}">${ch.current ? (ch.delta ? '+' + ch.delta : 'estável') : 'sem registro'}</div></div>`;
    }).join('')}</div>
    <p class="muted small" style="margin-top:10px">BPM limpo é o maior andamento em que você tocou o rudimento com 85 ou mais de precisão.</p>`;

  el.innerHTML = h;
  el.onclick = e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'daily') runDaily();
    if (a.dataset.act === 'diag') runDiagnostic();
    if (a.dataset.act === 'skipdiag') { state.placed = true; save(); render(); }
  };
}

// ---------- TRILHA ----------
function renderTrilha() {
  const el = $('#v-trilha');
  if (!trailView) trailView = state.trail;
  const tr = getTrail(trailView);
  const open = state.unlocked.includes(tr.id);
  const pg = trailProgress(state, tr);
  const cur = open ? currentStage(state, tr).index : -1;
  let h = `<div class="trail-tabs">${TRAILS.map(t => {
    const un = state.unlocked.includes(t.id), on = t.id === tr.id;
    return `<button data-trail="${t.id}" class="${on ? 'on' : ''}" style="${on ? `background:${t.color}` : ''}">${un ? '' : ICON.lock}${t.name}</button>`;
  }).join('')}</div>
  <div style="margin-top:18px"><div class="kicker" style="color:${tr.color}">TRILHA</div>
    <div class="h1" style="margin-top:4px">${tr.name}</div>
    <p class="muted small" style="margin-top:6px;font-weight:600">${pg.done} de ${pg.totalStages} etapas, ${pg.stars} de ${pg.totalStars} estrelas</p>
    <div class="xpbar" style="height:8px;margin-top:10px"><div style="width:${Math.round((pg.done / pg.totalStages) * 100)}%;background:${tr.color}"></div></div></div>`;
  if (!open) h += `<div class="card"><b>Trilha bloqueada</b><p class="muted small" style="margin-top:4px">Passe na prova da trilha anterior pra liberar.</p></div>`;
  h += `<div class="stages" style="--lv:${tr.color}">${tr.stages.map((s, i) => {
    const w = state.stages[s.id], un = stageUnlocked(state, tr, i);
    const cls = !un ? 'lock' : i === cur ? 'cur' : w && w.stars > 0 ? 'done' : '';
    const title = s.prova ? 'Prova da trilha' : getRud(s.rud).n;
    const sub = s.prova ? `Três rudimentos, precisão mínima ${s.min}`
      : w && w.bpm && w.bpm < s.bpm ? `Meta ${s.bpm} BPM, você está em ${w.bpm}` : `${s.bpm} BPM`;
    const node = !un ? ICON.lock : cls === 'done' ? ICON.check : s.prova ? ICON.trophy : i + 1;
    return `<button class="stage-row ${cls}" data-stage="${s.id}" ${un ? '' : 'disabled'} aria-label="${title}, ${sub}">
      <div class="node">${node}</div><div class="t"><b>${title}</b><span class="muted small">${sub}</span></div>
      ${starsHtml(w ? w.stars : 0)}</button>`;
  }).join('')}</div>
  <div class="card free-note"><b>Treino livre: flams e drags</b>
    <p class="muted small" style="margin-top:4px">Ficam na aba Rudimentos com guia visual e sonoro, sem pontuação: o microfone não consegue avaliar apojaturas com precisão.</p></div>`;
  el.innerHTML = h;
  el.onclick = e => {
    const t = e.target.closest('[data-trail]');
    if (t) { trailView = t.dataset.trail; renderTrilha(); return; }
    const s = e.target.closest('[data-stage]');
    if (s && !s.disabled) runStage(s.dataset.stage);
  };
}

// ---------- RUDIMENTOS ----------
const spbName = spb => ({ 1: 'base semínima', 2: 'base colcheia', 3: 'base tercina', 4: 'base semicolcheia' }[spb]);
let detailLoop = null;
function renderRud() {
  const el = $('#v-rud');
  if (detailLoop) { detailLoop.stop(); detailLoop = null; }
  if (!rudDetail) {
    el.innerHTML = `<div class="h1">Rudimentos</div>
      <p class="muted small" style="margin-top:6px">Os 40 rudimentos PAS e dois exercícios de base. Toque em um pra ouvir, ver o sticking e avaliar seu timing.</p>
      ${CATEGORIES.map(c => `<div class="cat">${c.cat.toUpperCase()}</div>${c.list.map(r => {
        const rec = state.records[r.id];
        const tag = !r.scorable ? '<span class="tag">treino livre</span>' : rec && rec.clean ? `<span class="tag rec">${rec.clean} limpo</span>` : '';
        return `<button class="rud-item" data-rud="${r.id}"><div><b>${r.n}</b><span>${r.pt}</span></div>${tag}</button>`;
      }).join('')}`).join('')}`;
    el.onclick = e => {
      const b = e.target.closest('[data-rud]'); if (!b) return;
      rudDetail = b.dataset.rud;
      const rec = state.records[rudDetail];
      rudBpm = rec && rec.clean ? rec.clean : 60;
      renderRud(); window.scrollTo(0, 0);
    };
    return;
  }
  const r = getRud(rudDetail);
  el.innerHTML = `<button class="back" data-act="back">‹ Rudimentos</button>
    <div class="h1" style="margin-top:4px">${r.n}</div>
    <p class="muted small" style="margin-top:4px">${r.pt}, ${spbName(r.spb)}</p>
    <div class="stage" id="rStage"></div>
    <div class="sheet"><div class="cells" id="rCells"></div>
      <div class="legend"><span><b class="r">R</b> direita</span><span><b class="l">L</b> esquerda</span><span>&gt; acento</span><span>letra pequena: apojatura</span></div></div>
    <div class="bpm-ctl"><button data-d="-5">−5</button><button data-d="-1">−1</button>
      <div class="v" id="rBpm">${rudBpm}<small>BPM</small></div><button data-d="1">+1</button><button data-d="5">+5</button></div>
    <div class="stack"><button class="btn-ghost" data-act="listen" id="rListen">Ouvir</button>
    ${r.scorable ? '<button class="btn-primary" data-act="eval">Avaliar meu timing</button>'
      : '<p class="muted small">Este rudimento tem apojaturas ou buzz, que o microfone não avalia com precisão. Use o guia pra praticar.</p>'}</div>`;
  const cells = renderCells($('#rCells'), r);
  const stg = renderStage($('#rStage'));
  el.onclick = e => {
    const a = e.target.closest('[data-act],[data-d]'); if (!a) return;
    if (a.dataset.d) {
      rudBpm = Math.min(240, Math.max(30, rudBpm + +a.dataset.d));
      $('#rBpm').innerHTML = `${rudBpm}<small>BPM</small>`;
      if (detailLoop) { detailLoop.stop(); startListen(); }
      return;
    }
    if (a.dataset.act === 'back') { rudDetail = null; renderRud(); return; }
    if (a.dataset.act === 'listen') { if (detailLoop) { detailLoop.stop(); detailLoop = null; $('#rListen').textContent = 'Ouvir'; } else startListen(); }
    if (a.dataset.act === 'eval') { if (detailLoop) { detailLoop.stop(); detailLoop = null; } runFree(r.id, rudBpm); }
  };
  function startListen() {
    ensureAC();
    detailLoop = playLoop(r, rudBpm, { owner: 'detail', onStep: (i, t) => { cells.highlight(i); if (t) stg.strike(t.hand, t.acc); } });
    $('#rListen').textContent = 'Parar';
  }
}

// ---------- PERFIL ----------
async function renderPerfil() {
  const el = $('#v-perfil');
  const lv = levelInfo(state.xp), tr = getTrail(state.trail);
  const recs = Object.entries(state.records).filter(([, v]) => v.clean > 0).sort((a, b) => b[1].clean - a[1].clean);
  const c = state.calib;
  el.innerHTML = `<div class="card"><div class="kicker">PERFIL</div>
      <div class="h1" style="margin-top:4px">Nível ${lv.level}</div>
      <div style="margin-top:8px"><span class="chip-lv">TRILHA ${tr.name.toUpperCase()}</span></div>
      <div class="xpbar"><div style="width:${Math.round((lv.into / lv.need) * 100)}%"></div></div>
      <p class="muted small" style="margin-top:8px">${lv.into} / ${lv.need} XP neste nível, ${state.xp} XP no total</p></div>
    <div class="card">
      <div class="kv"><span>Sequência atual</span><b style="color:var(--streak-t)">${plural(currentStreak(state, today()), 'dia', 'dias')}</b></div>
      <div class="kv"><span>Avaliações feitas</span><b>${state.sessions}</b></div>
      <div class="kv"><span>XP hoje</span><b>${state.xpDay.day === today() ? state.xpDay.xp : 0} / 300</b></div></div>
    <div class="card"><div class="kicker">BPM LIMPO POR RUDIMENTO</div>
      ${recs.length ? recs.map(([id, v]) => `<div class="kv"><span>${getRud(id).n}</span><b>${v.clean} BPM</b></div>`).join('')
        : '<p class="muted small" style="margin-top:8px">Faça avaliações com 85 ou mais de precisão pra registrar seu BPM limpo.</p>'}</div>
    <div class="card"><div class="kicker">MICROFONE</div>
      <p class="small" style="margin-top:8px">${c ? `Calibrado em ${new Date(c.at).toLocaleDateString('pt-BR')}, latência compensada de ${Math.round(c.offset * 1000)} ms.` : 'Ainda não calibrado.'}</p>
      ${c && c.leakLatency != null ? '<p class="muted small" style="margin-top:6px">O click vaza do alto-falante pro microfone. O app descarta esse som, mas com fone com fio a avaliação fica mais precisa.</p>' : ''}
      <div class="stack"><button class="btn-ghost" data-act="calib">${c ? 'Calibrar de novo' : 'Calibrar agora'}</button></div></div>
    <div class="card"><div class="kicker">SEUS DADOS</div>
      <p class="muted small" style="margin-top:8px">O progresso fica salvo só neste aparelho. Apagar o atalho da tela inicial ou os dados do navegador apaga o progresso junto. Nenhum áudio é gravado.</p>
      ${volatile ? '<p class="small" style="margin-top:8px;color:var(--bad)">Este navegador não permite salvar dados (modo privado?). O progresso some ao fechar.</p>' : ''}
      <div class="stack"><button class="btn-ghost" data-act="rediag">Refazer diagnóstico</button>
      <button class="btn-ghost danger" data-act="wipe">Apagar meus dados</button></div></div>`;
  el.onclick = async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'calib') runCalibOnly();
    if (a.dataset.act === 'rediag') runDiagnostic();
    if (a.dataset.act === 'wipe' && confirm('Apagar todo o progresso deste aparelho? Não dá pra desfazer.')) {
      await clearAll(); state = newState(); sessions = []; trailView = null; await save(); toast('Dados apagados'); render();
    }
  };
}

// =================== FLUXO DE TREINO (overlay) ===================
const S = { ctl: null, waiters: new Set() };
function openOverlay() {
  ensureAC(); stopAll();
  S.ctl = new AbortController();
  $('#session').hidden = false; document.body.style.overflow = 'hidden';
  $('#sDots').innerHTML = ''; $('#sStep').textContent = '';
}
function closeOverlay() {
  if (S.ctl) S.ctl.abort();
  S.waiters.forEach(r => r('close')); S.waiters.clear();
  stopAll(); releaseMic();
  $('#session').hidden = true; document.body.style.overflow = '';
  render();
}
$('#sClose').onclick = closeOverlay;
const aborted = () => !S.ctl || S.ctl.signal.aborted;

function choose(actions) {
  return new Promise(res => {
    const box = $('#sActions'); box.innerHTML = '';
    const done = id => { S.waiters.delete(done); res(id); };
    S.waiters.add(done);
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = a.primary ? 'btn-primary' : 'btn-ghost'; b.textContent = a.label;
      b.onclick = () => { box.innerHTML = ''; done(a.id); };
      box.appendChild(b);
    });
  });
}
function setStatus(txt, cls = '') { const s = $('#sStatus'); if (s) { s.textContent = txt; s.className = 'status ' + cls; } }
function setDots(n, cur) {
  $('#sDots').innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < cur ? 'done' : i === cur ? 'cur' : ''}"></i>`).join('');
}
function screen(kicker, title, sub, withExercise = true) {
  $('#sBody').innerHTML = `<div class="kicker" style="color:var(--lv)">${kicker}</div>
    <div class="h1" style="margin-top:4px">${title}</div>
    <p class="muted small" style="margin-top:4px" id="sSub">${sub}</p>
    ${withExercise ? '<div class="stage" id="sStage"></div><div class="sheet"><div class="cells" id="sCells"></div></div>' : ''}
    <div class="status" id="sStatus"></div><div id="sResult"></div><div class="actions" id="sActions"></div>`;
  window.scrollTo(0, 0); $('#session').scrollTop = 0;
}

// ---------- calibração ----------
async function calibrate() {
  screen('ANTES DE COMEÇAR', 'Calibrar o microfone', 'Leva 30 segundos e só precisa ser feito uma vez neste aparelho.', false);
  const mic = await ensureMic();
  if (aborted()) return false;
  if (!mic.ok) {
    setStatus(mic.msg);
    const a = await choose([{ id: 'retry', label: 'Tentar de novo', primary: true }]);
    return a === 'retry' ? calibrate() : false;
  }
  for (;;) {
    $('#sSub').textContent = 'Passo 1 de 2: fique em silêncio. O app toca 6 clicks pra medir se o som do alto-falante chega no microfone.';
    setStatus('');
    if ((await choose([{ id: 'go', label: 'Começar', primary: true }])) !== 'go') return false;
    setStatus('Silêncio…');
    const r1 = await runClicks(6, 100, { signal: S.ctl.signal });
    if (!r1) return false;
    const leak = analyzeSilent(r1.clickTimes, r1.onsets);

    $('#sSub').textContent = 'Passo 2 de 2: toque no pad junto com os 8 clicks, bem no tempo.';
    setStatus('');
    if ((await choose([{ id: 'go', label: 'Começar', primary: true }])) !== 'go') return false;
    const r2 = await runClicks(8, 90, { signal: S.ctl.signal, onClick: i => setStatus(String(i + 1), 'count') });
    if (!r2) return false;
    const off = analyzePlay(r2.clickTimes, r2.onsets, leak);
    if (off == null || Math.abs(off) > 0.3) {
      setStatus('Detectei poucos toques. Toque mais firme, com o celular perto do pad.');
      if ((await choose([{ id: 'retry', label: 'Repetir calibração', primary: true }])) !== 'retry') return false;
      continue;
    }
    state.calib = { offset: off, leakLatency: leak.leakLatency, leakPeak: leak.leakPeak, at: Date.now() };
    await save();
    $('#sSub').textContent = `Pronto. Latência compensada: ${Math.round(off * 1000)} ms.` +
      (leak.leakLatency != null ? ' O click está vazando do alto-falante pro microfone. O app descarta esse som, mas com fone com fio a avaliação fica mais precisa.' : '');
    setStatus('');
    return (await choose([{ id: 'ok', label: 'Continuar', primary: true }])) === 'ok';
  }
}
async function ensureReady() {
  if (!state.calib) return calibrate();
  const mic = await ensureMic();
  if (mic.ok) return true;
  screen('MICROFONE', 'Sem acesso ao microfone', mic.msg, false);
  const a = await choose([{ id: 'retry', label: 'Tentar de novo', primary: true }]);
  return a === 'retry' ? ensureReady() : false;
}

// ---------- um take avaliado ----------
async function doTake(rud, bpm, { kicker, title, sub, gap = null, skippable = false }) {
  screen(kicker, title, sub);
  const cells = renderCells($('#sCells'), rud);
  const stg = renderStage($('#sStage'));
  const intro = gap ? 'Toque colcheias com o click. Quando ele sumir, continue no mesmo tempo.'
    : 'Contagem de 4, depois toque junto com o click. Durante a avaliação só o click soa.';
  for (;;) {
    setStatus(intro);
    const acts = [{ id: 'go', label: 'Começar', primary: true }, { id: 'listen', label: 'Ouvir antes' }];
    if (skippable) acts.push({ id: 'skip', label: 'Pular bloco' });
    const a = await choose(acts);
    if (a === 'close' || aborted()) return null;
    if (a === 'skip') return { skipped: true };
    if (a === 'listen') {
      setStatus('Ouvindo o guia');
      const lp = playLoop(rud, bpm, { onStep: (i, t) => { cells.highlight(i); if (t) stg.strike(t.hand, t.acc); } });
      const b = await choose([{ id: 'stop', label: 'Parar de ouvir', primary: true }]);
      lp.stop();
      if (b === 'close') return null;
      continue;
    }
    $('#sResult').innerHTML = '';
    let playing = false;
    const take = await runTake(rud, bpm, {
      gap, signal: S.ctl.signal,
      onCount: n => setStatus(String(n), 'count'),
      onMuted: m => setStatus(m ? 'Sem click: continue no tempo' : 'Click de volta', m ? 'mutedbar' : ''),
      onStep: (i, t) => {
        cells.highlight(i);
        if (t) { stg.strike(t.hand, t.acc); if (!playing) { playing = true; if (!gap) setStatus('Tocando'); } }
      },
    });
    if (!take || aborted()) return null;
    setStatus('');
    const res = scoreTake({ ...take, calib: state.calib });
    if (res.hits === 0) {
      const d = describe(res, rud);
      $('#sResult').innerHTML = `<div class="card diag">${ICON.clock}<div><b>${d.title}</b><p class="muted small" style="margin-top:3px">${d.text}</p></div></div>`;
      const b = await choose([{ id: 'retry', label: 'Tentar de novo', primary: true }, ...(skippable ? [{ id: 'skip', label: 'Pular bloco' }] : [])]);
      if (b === 'skip') return { skipped: true };
      if (b !== 'retry') return null;
      continue;
    }
    return { res };
  }
}

async function recordSession(kind, rud, bpm, res, stageId = null) {
  const diag = describe(res, rud);
  const sess = {
    ts: Date.now(), day: today(), kind, rud: rud.id, bpm, spb: rud.spb,
    score: res.score, consistency: res.consistency, meanAbsMs: res.meanAbsMs, tendencyMs: res.tendencyMs,
    diagTitle: diag.title, diagText: diag.text, stageId, gap: res.gap || null,
  };
  const gain = applyScored(state, sess, today());
  sess.id = await addSession(sess);
  sessions.push(sess);
  await save();
  if (gain.levelUp) toast(`Nível ${gain.level}!`);
  return { sess, gain, diag };
}

function drawDev(canvas, devs, win) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 320, h = 110;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  const mid = h / 2, slot = w / devs.length, bw = Math.max(3, Math.min(14, slot - 3));
  g.strokeStyle = '#3A3450'; g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
  devs.forEach((d, i) => {
    const x = (i + 0.5) * slot - bw / 2;
    if (d === null) { g.fillStyle = '#4A4458'; g.fillRect(x, mid - 2, bw, 4); return; }
    const len = Math.min(1, Math.abs(d) / win) * (mid - 6);
    g.fillStyle = d > 0 ? '#FF8A2B' : '#3EB8F0';
    if (d > 0) g.fillRect(x, mid - len, bw, len); // atrasado pra cima
    else g.fillRect(x, mid, bw, len);              // adiantado pra baixo
  });
}

function showResult(res, rud, { gain, diag, stageInfo }) {
  const third = res.gap
    ? `<div><div class="v">${tendLabel(res.gap.tendencyMs)}</div><div class="k">SEM CLICK</div></div>`
    : `<div><div class="v">${tendLabel(res.tendencyMs)}</div><div class="k">TENDÊNCIA</div></div>`;
  let starBox = '';
  if (stageInfo) {
    starBox = `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">${starsHtml(stageInfo.stars, true)}
      <span class="muted small">${stageInfo.stars ? (stageInfo.stars < 3 ? '3ª estrela com 90+' : 'Etapa completa') : stageInfo.target > (stageInfo.playedBpm || 0) ? `Estrelas valem a ${stageInfo.target} BPM` : '1ª estrela com 70+'}</span></div>`;
  }
  let adapt = '';
  if (stageInfo && stageInfo.adapt === 'up') adapt = `Duas vezes acima de 90: o próximo treino desta etapa sobe pra ${stageInfo.workBpm} BPM.`;
  if (stageInfo && stageInfo.adapt === 'down') adapt = `Abaixo de 75: o próximo treino desta etapa desce pra ${stageInfo.workBpm} BPM pra limpar o movimento.`;
  const lv = levelInfo(state.xp);
  $('#sResult').innerHTML = `
    <div class="card result"><div class="scorebox"><div><div class="kicker">PRECISÃO</div>
      <div class="score" style="color:${scoreColor(res.score)}">${res.score}</div></div>${starBox}</div>
      <div class="chart-legend"><span class="late">atrasado</span><span>desvio por nota</span></div>
      <canvas class="dev" id="devChart" aria-label="Gráfico de desvio por nota"></canvas>
      <div class="chart-legend" style="margin-top:4px"><span class="early">adiantado</span><span>${res.hits} de ${res.total} notas</span></div>
      <div class="stats3"><div><div class="v">${res.consistency == null ? '—' : res.consistency + '%'}</div><div class="k">CONSISTÊNCIA</div></div>
        <div><div class="v">${res.meanAbsMs} ms</div><div class="k">DESVIO MÉDIO</div></div>${third}</div></div>
    <div class="card diag">${ICON.clock}<div><b>${diag.title}</b><p class="muted small" style="margin-top:3px">${diag.text}</p></div></div>
    <div class="reward-grid"><div class="reward xp"><div class="v">+${gain.xp} XP</div>
      <div class="muted small">${gain.capped ? 'Teto diário de XP atingido' : `${lv.into} / ${lv.need} pro nível ${lv.level + 1}`}</div></div>
      <div class="reward st"><div class="v">${plural(currentStreak(state, today()), 'dia', 'dias')}</div><div class="muted small">sequência</div></div></div>
    ${gain.newRecord ? `<div class="card note-ok"><b>Novo BPM limpo: ${rud.n} a ${gain.cleanBpm}</b></div>` : ''}
    ${adapt ? `<p class="muted small" style="margin-top:10px">${adapt}</p>` : ''}`;
  drawDev($('#devChart'), res.devs, res.win);
  $('#sResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- blocos ----------
async function runWarm(b) {
  const rud = getRud(b.rud);
  screen('AQUECIMENTO', rud.n, `${b.bpm} BPM. Toque junto com o guia, sem avaliação. Uns 2 minutos bastam.`);
  const cells = renderCells($('#sCells'), rud), stg = renderStage($('#sStage'));
  const a = await choose([{ id: 'play', label: 'Tocar guia', primary: true }, { id: 'skip', label: 'Pular aquecimento' }]);
  if (a === 'close') return 'close';
  if (a === 'play') {
    const lp = playLoop(rud, b.bpm, { onStep: (i, t) => { cells.highlight(i); if (t) stg.strike(t.hand, t.acc); } });
    const c = await choose([{ id: 'done', label: 'Concluir aquecimento', primary: true }]);
    lp.stop();
    if (c === 'close') return 'close';
  }
  b.done = true; await save();
  return 'next';
}

async function runScoredBlock(b, isLast, gains, standalone = false) {
  for (;;) {
    const rud = getRud(b.rud);
    const stage = b.stageId ? findStage(b.stageId).stage : null;
    const kicker = b.label.toUpperCase();
    const sub = b.kind === 'gap' ? `${b.bpm} BPM, ${plural(b.gap.off, 'compasso', 'compassos')} sem click a cada ${b.gap.on + b.gap.off}`
      : `${b.bpm} BPM${stage && b.bpm < stage.bpm ? `, meta ${stage.bpm}` : ''}`;
    const out = await doTake(rud, b.bpm, { kicker, title: rud.n, sub, gap: b.gap || null, skippable: !standalone });
    if (!out) return 'close';
    if (out.skipped) { b.done = true; b.score = null; await save(); return 'next'; }
    const kind = b.kind === 'stage' ? 'foco' : b.kind;
    const { gain, diag } = await recordSession(kind, rud, b.bpm, out.res, b.stageId || null);
    gains.push({ ...gain, score: out.res.score, rud: rud.n });
    let stageInfo = null;
    if (stage) { stageInfo = { ...applyStageResult(state, stage, out.res.score, b.bpm), playedBpm: b.bpm }; await save(); }
    b.done = true; b.score = out.res.score; await save();
    showResult(out.res, rud, { gain, diag, stageInfo });
    const a = await choose([
      { id: 'next', label: standalone ? 'Concluir' : isLast ? 'Ver resumo do treino' : 'Próximo bloco', primary: true },
      { id: 'again', label: 'Repetir' },
    ]);
    if (a === 'close') return 'close';
    if (a === 'next') return 'next';
    if (stage && stageInfo) b.bpm = stageInfo.workBpm; // repetição já usa o BPM adaptado
  }
}

async function runProvaBlock(b, gains, standalone = false) {
  const { trail, stage } = findStage(b.stageId);
  for (;;) {
    const scores = [];
    for (let k = 0; k < stage.takes.length; k++) {
      const t = stage.takes[k], rud = getRud(t.rud);
      const out = await doTake(rud, t.bpm, { kicker: `PROVA ${k + 1} DE ${stage.takes.length}`, title: rud.n, sub: `${t.bpm} BPM, média mínima ${stage.min} nas três` });
      if (!out || out.skipped) return 'close';
      const { gain } = await recordSession('prova', rud, t.bpm, out.res, stage.id);
      gains.push({ ...gain, score: out.res.score, rud: rud.n });
      scores.push(out.res.score);
    }
    const pr = applyProva(state, trail, stage, scores);
    b.done = true; b.score = pr.avg; await save();
    screen('PROVA DA TRILHA', pr.stars ? 'Aprovado' : 'Ainda não', `Média ${pr.avg}, mínimo ${stage.min}. Notas: ${scores.join(', ')}.`, false);
    $('#sResult').innerHTML = `<div class="card" style="display:flex;justify-content:center">${starsHtml(pr.stars, true)}</div>
      ${pr.unlockedTrail ? `<div class="card note-ok"><b>Trilha ${pr.unlockedTrail.name} liberada</b><p class="muted small" style="margin-top:4px">Seus próximos treinos já seguem a trilha nova.</p></div>` : ''}
      ${!pr.stars ? '<p class="muted small" style="margin-top:10px">Revise os rudimentos da trilha e tente de novo amanhã.</p>' : ''}`;
    if (pr.unlockedTrail) { trailView = null; setLevelColor(); }
    const a = await choose([{ id: 'next', label: standalone ? 'Concluir' : 'Continuar', primary: true }, { id: 'again', label: 'Refazer a prova' }]);
    if (a !== 'again') return a === 'close' ? 'close' : 'next';
  }
}

async function runBlock(b, isLast, gains, standalone = false) {
  if (b.kind === 'warm') return runWarm(b);
  if (!(await ensureReady())) return 'close';
  if (b.kind === 'prova') return runProvaBlock(b, gains, standalone);
  return runScoredBlock(b, isLast, gains, standalone);
}

// ---------- treino do dia ----------
async function runDaily() {
  const w = ensureToday();
  openOverlay();
  const gains = [];
  for (let i = 0; i < w.blocks.length; i++) {
    const b = w.blocks[i];
    if (b.done) continue;
    setDots(w.blocks.length, i);
    $('#sStep').textContent = `Bloco ${i + 1} de ${w.blocks.length}`;
    const r = await runBlock(b, i === w.blocks.length - 1, gains);
    if (r === 'close' || aborted()) { if (!aborted()) closeOverlay(); return; }
  }
  setDots(w.blocks.length, w.blocks.length);
  $('#sStep').textContent = '';
  await showSummary(w, gains);
}

async function showSummary(w, gains) {
  const xp = gains.reduce((a, g) => a + g.xp, 0);
  const scored = w.blocks.filter(b => b.score != null);
  const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length) : null;
  const recs = gains.filter(g => g.newRecord);
  const tr = getTrail(state.trail), { stage } = currentStage(state, tr);
  const next = stage.prova ? 'Prova da trilha' : `${getRud(stage.rud).n} a ${stageWork(state, stage).bpm} BPM`;
  await save();
  $('#sBody').innerHTML = `<div class="done-hero"><div class="check">${ICON.check}</div>
      <div class="h1" style="margin-top:14px">Treino concluído</div>
      <p class="muted small" style="margin-top:4px">${plural(scored.length, 'bloco avaliado', 'blocos avaliados')}</p></div>
    ${avg != null ? `<div class="card" style="text-align:center"><div class="kicker">PRECISÃO MÉDIA</div><div class="score" style="font-family:var(--display);font-size:52px;color:${scoreColor(avg)}">${avg}</div></div>` : ''}
    <div class="reward-grid"><div class="reward xp"><div class="v">+${xp} XP</div><div class="muted small">neste treino</div></div>
      <div class="reward st"><div class="v">${plural(currentStreak(state, today()), 'dia', 'dias')}</div><div class="muted small">sequência mantida</div></div></div>
    ${recs.map(r => `<div class="card note-ok"><b>Novo BPM limpo: ${r.rud} a ${r.cleanBpm}</b></div>`).join('')}
    <div class="card"><div class="kicker">AMANHÃ</div><p style="margin-top:6px;line-height:1.45">${next}.</p></div>
    <div class="actions" id="sActions"></div>`;
  $('#session').scrollTop = 0;
  await choose([{ id: 'end', label: 'Encerrar por hoje', primary: true }]);
  closeOverlay();
}

// ---------- etapa avulsa (pela trilha) ----------
async function runStage(stageId) {
  const { stage } = findStage(stageId);
  openOverlay(); setDots(1, 0);
  const b = stage.prova
    ? { kind: 'prova', label: 'Prova da trilha', stageId }
    : { kind: 'foco', label: 'Etapa da trilha', rud: stage.rud, bpm: stageWork(state, stage).bpm, stageId };
  await runBlock(b, true, [], true);
  // se for a etapa de foco de hoje, conta no treino do dia
  const w = state.today;
  if (w && w.day === today() && b.done) {
    const f = w.blocks.find(x => x.stageId === stageId && !x.done);
    if (f) { f.done = true; f.score = b.score; await save(); }
  }
  if (!aborted()) closeOverlay(); else render();
}

// ---------- avaliação livre (aba Rudimentos) ----------
async function runFree(rudId, bpm) {
  openOverlay(); setDots(1, 0);
  await runBlock({ kind: 'livre', label: 'Treino livre', rud: rudId, bpm }, true, [], true);
  if (!aborted()) closeOverlay(); else render();
}

async function runCalibOnly() {
  openOverlay();
  await calibrate();
  if (!aborted()) closeOverlay();
}

// ---------- diagnóstico inicial ----------
async function runDiagnostic() {
  openOverlay();
  const takes = [{ rud: 'single-stroke-roll', bpm: 70 }, { rud: 'double-stroke-open-roll', bpm: 60 }];
  setDots(takes.length + 1, 0);
  if (!(await ensureReady())) { if (!aborted()) closeOverlay(); return; }
  const scores = [];
  for (let k = 0; k < takes.length; k++) {
    setDots(takes.length + 1, k + 1);
    const rud = getRud(takes[k].rud);
    const out = await doTake(rud, takes[k].bpm, { kicker: `DIAGNÓSTICO ${k + 1} DE ${takes.length}`, title: rud.n, sub: `${takes[k].bpm} BPM. Toque como você toca hoje, sem pressão.` });
    if (!out || out.skipped) { if (!aborted()) closeOverlay(); return; }
    await recordSession('diag', rud, takes[k].bpm, out.res);
    scores.push(out.res.score);
  }
  const tr = applyPlacement(state, scores);
  state.today = null; trailView = null;
  await save(); setLevelColor();
  setDots(takes.length + 1, takes.length + 1);
  screen('DIAGNÓSTICO', `Sua trilha: ${tr.name}`, `Notas: ${scores.join(' e ')}. ${tr.id === 'iniciante' ? 'A trilha Iniciante constrói a base de singles, doubles e paradiddle.' : 'Sua base está firme: você começa direto na trilha Intermediário.'}`, false);
  await choose([{ id: 'ok', label: 'Ver meu treino do dia', primary: true }]);
  closeOverlay();
}

// ---------- inicialização ----------
async function boot() {
  try {
    const saved = await kvGet('state');
    if (saved) state = Object.assign(newState(), saved);
    sessions = await allSessions();
    volatile = await isVolatile();
  } catch (e) { console.error('Falha ao carregar dados', e); }
  requestPersist();
  initMetronome();
  document.querySelectorAll('.tabbar button').forEach(b => { b.onclick = () => show(b.dataset.view); });
  $('#streakChip').onclick = () => show('perfil');
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
boot();
