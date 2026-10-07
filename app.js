// Batera no Click — orquestração das telas e do fluxo de treino.
import { CATEGORIES, getRud } from './rudiments-data.js';
import { TRAILS, getTrail, findStage } from './trails.js';
import { scoreTake, describe, analyzeSilent, analyzePlay, resolveCalibration } from './scoring.js';
import {
  newState, levelInfo, dayKey, dayDiff, currentStreak, applyScored, stageWork, stageUnlocked,
  currentStage, trailProgress, applyStageResult, applyProva, applyPlacement, chooseTrail,
} from './progress.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { buildWorkout, cleanHistory } from './workout.js';
import { kvGet, kvSet, addSession, allSessions, clearAll, isVolatile, requestPersist } from './storage.js';
import { ensureAC, stopAll } from './audio.js';
import { ensureMic, releaseMic } from './mic.js';
import { renderCells, renderStage, playLoop, runTake, runClicks, repsFor } from './player.js';
import { initMetronome } from './metronome.js';
import { FEEDBACK_KEY } from './config.js';

const $ = s => document.querySelector(s);
const today = () => dayKey();
let state = newState(), sessions = [];
let view = 'hoje', trailView = null, rudDetail = null, rudBpm = 60, volatile = false, introTimer = null, feedbackFrom = 'perfil';

// Eventos anônimos de uso (Vercel Web Analytics). Sem dado pessoal: só o nome do passo e números.
function track(name, data) {
  try { if (window.va) window.va('event', data ? { name, data } : { name }); } catch (e) { /* ignora */ }
}

// texto vindo de backup importado nunca entra cru no HTML
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const UA = navigator.userAgent;
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(UA);
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

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
function show(v, anchor) {
  view = v;
  clearInterval(introTimer); introTimer = null;
  document.body.classList.toggle('intro-mode', v === 'intro');
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  stopAll();
  render();
  const target = anchor && document.getElementById(anchor);
  if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
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
  else if (view === 'intro') renderIntro();
  else if (view === 'feedback') renderFeedback();
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
  // duas colunas no desktop; no celular a ordem visual é dada por `order` no CSS
  let h = '', side = '';

  if ((IS_IOS || IS_ANDROID) && !IS_STANDALONE) {
    h += `<div class="card banner"><div style="flex:1"><b>Instale o app na tela inicial</b>
      <p>${IS_IOS ? 'No Safari, o iPhone apaga os dados de sites que ficam 7 dias sem uso. Instalado, seu progresso fica protegido.' : 'Assim ele abre em tela cheia e seu progresso fica protegido.'}</p></div>
      <button data-act="install">Como?</button></div>`;
  }

  if (!state.placed) {
    h += `<div class="card onboard">
      <div class="h2">Comece pelo diagnóstico</div>
      <p class="muted small" style="margin-top:6px">Três minutos: o app calibra o microfone, mede seu timing em dois rudimentos e escolhe a trilha certa pra você.</p>
      <div class="stack"><button class="btn-primary" data-act="diag">Fazer diagnóstico</button>
      <button class="btn-ghost" data-act="skipdiag">Pular e começar no Iniciante</button></div></div>`;
  }

  side += `<div class="card lv-card">
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
    h += `<div class="card diag">${ICON.clock}<div><b>${esc(last.diagTitle)}</b>
      <p class="muted small" style="margin-top:3px">${getRud(last.rud).n}: ${esc(last.diagText)}</p></div></div>`;
  }

  side += `<div class="clean-sec"><div class="sec-head"><span class="kicker">BPM LIMPO</span><span class="muted small">últimos 30 dias</span></div>
    <div class="clean-grid">${tr.tracked.map(id => {
      const ch = cleanHistory(sessions, id, today());
      const name = getRud(id).n.replace(' Stroke', '').replace(' Open Roll', '').replace(' Roll', '');
      return `<div class="clean"><div class="n">${name}</div>
        <div class="v">${ch.current || '—'}</div>${ch.current ? sparkline(ch.points) : '<svg viewBox="0 0 100 26"></svg>'}
        <div class="d${ch.delta ? '' : ' zero'}">${ch.current ? (ch.delta ? '+' + ch.delta : 'estável') : 'sem registro'}</div></div>`;
    }).join('')}</div>
    <p class="muted small" style="margin-top:10px">BPM limpo é o maior andamento em que você tocou o rudimento com 85 ou mais de precisão.</p>
    ${FEEDBACK_KEY ? '<div style="text-align:center;margin-top:18px"><button class="link-btn" data-act="feedback">Achou um erro ou tem uma sugestão? Fale comigo</button></div>' : ''}</div>`;

  el.innerHTML = `<div class="hoje-cols"><div class="col">${h}</div><div class="col">${side}</div></div>`;
  el.onclick = e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'daily') runDaily();
    if (a.dataset.act === 'diag') runDiagnostic();
    if (a.dataset.act === 'skipdiag') { state.placed = true; save(); track('diag_skip'); render(); }
    if (a.dataset.act === 'install') { track('install_help'); show('intro', 'install'); }
    if (a.dataset.act === 'feedback') { feedbackFrom = 'hoje'; show('feedback'); }
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
  else if (tr.id === state.trail) h += `<p class="muted small" style="margin-top:12px">Esta é a sua trilha ativa: o treino do dia segue as etapas dela.</p>`;
  else h += `<div class="card"><b>Treinar nesta trilha?</b>
    <p class="muted small" style="margin-top:4px">Hoje o treino do dia segue a trilha ${getTrail(state.trail).name}. Você pode trocar quando quiser: o progresso das duas fica salvo.</p>
    <div class="stack"><button class="btn-ghost" data-act="usetrail">Usar a trilha ${tr.name} no treino do dia</button></div></div>`;
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
    if (e.target.closest('[data-act=usetrail]') && chooseTrail(state, tr.id)) {
      // treino de hoje ainda não começado: remonta já na trilha nova; senão a troca vale a partir de amanhã
      const started = state.today && state.today.blocks.some(b => b.done);
      if (!started) state.today = null;
      save(); track('trail_switch', { trail: tr.id });
      toast(started ? `Trilha ${tr.name} ativa a partir do treino de amanhã` : `Treino do dia agora segue a trilha ${tr.name}`);
      render(); return;
    }
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
      ${CATEGORIES.map(c => `<div class="cat">${c.cat.toUpperCase()}</div><div class="rud-list">${c.list.map(r => {
        const rec = state.records[r.id];
        const tag = !r.scorable ? '<span class="tag">treino livre</span>' : rec && rec.clean ? `<span class="tag rec">${rec.clean} limpo</span>` : '';
        return `<button class="rud-item" data-rud="${r.id}"><div><b>${r.n}</b><span>${r.pt}</span></div>${tag}</button>`;
      }).join('')}</div>`).join('')}`;
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
    <div class="rud-detail"><div>
    <div class="stage" id="rStage"></div>
    <div class="sheet"><div class="cells" id="rCells"></div>
      <div class="legend"><span><b class="r">R</b> direita</span><span><b class="l">L</b> esquerda</span><span>&gt; acento</span><span>letra pequena: apojatura</span></div></div>
    </div><div>
    <div class="bpm-ctl"><button data-d="-5">−5</button><button data-d="-1">−1</button>
      <div class="v" id="rBpm">${rudBpm}<small>BPM</small></div><button data-d="1">+1</button><button data-d="5">+5</button></div>
    <div class="stack"><button class="btn-ghost" data-act="listen" id="rListen">Ouvir</button>
    ${r.scorable ? '<button class="btn-primary" data-act="eval">Avaliar meu timing</button>'
      : '<p class="muted small">Este rudimento tem apojaturas ou buzz, que o microfone não avalia com precisão. Use o guia pra praticar.</p>'}</div>
    </div></div>`;
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
      <p class="muted small" style="margin-top:8px">O progresso fica salvo só neste aparelho. Apagar o atalho da tela inicial ou os dados do navegador apaga o progresso junto. Faça um backup de vez em quando: o arquivo também serve pra levar o progresso pra outro celular.</p>
      ${volatile ? '<p class="small" style="margin-top:8px;color:var(--bad)">Este navegador não permite salvar dados (modo privado?). O progresso some ao fechar.</p>' : ''}
      <div class="stack"><button class="btn-ghost" data-act="export">Fazer backup</button>
      <button class="btn-ghost" data-act="import">Restaurar backup</button>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      <button class="btn-ghost" data-act="rediag">Refazer diagnóstico</button>
      <button class="btn-ghost danger" data-act="wipe">Apagar meus dados</button></div></div>
    <div class="card"><div class="kicker">SOBRE</div>
      <div class="stack">${FEEDBACK_KEY ? '<button class="btn-ghost" data-act="feedback">Enviar feedback</button>' : ''}
      <button class="btn-ghost" data-act="intro">Conhecer o app</button></div></div>
    <div class="card"><div class="kicker">PRIVACIDADE</div>
      <p class="muted small" style="margin-top:8px">O áudio do microfone é analisado na hora e descartado: nada é gravado nem enviado. O progresso fica só neste aparelho. As visitas e o uso (por exemplo, treino concluído e nota da avaliação) são contados de forma anônima e sem cookies (Vercel Web Analytics), sem nada que identifique você. ${FEEDBACK_KEY ? 'O feedback só sai quando você toca em Enviar, e vai por e-mail pelo serviço Web3Forms.' : ''}</p></div>`;
  const inp = $('#importFile');
  inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) importBackup(f); };
  el.onclick = async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'calib') runCalibOnly();
    if (a.dataset.act === 'rediag') runDiagnostic();
    if (a.dataset.act === 'feedback') { feedbackFrom = 'perfil'; show('feedback'); }
    if (a.dataset.act === 'intro') show('intro');
    if (a.dataset.act === 'export') exportBackup();
    if (a.dataset.act === 'import') $('#importFile').click();
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
  keepAwake('session');
}
function closeOverlay() {
  if (S.ctl) S.ctl.abort();
  S.waiters.forEach(r => r('close')); S.waiters.clear();
  stopAll(); releaseMic(); allowSleep('session');
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
    $('#sResult').innerHTML = `<div class="card tip"><b>Pad ou bateria?</b>
      <p class="muted small" style="margin-top:4px">No pad, o alto-falante do celular basta. Na bateria acústica, use fone com fio: no volume da bateria o click do alto-falante some. Evite fone Bluetooth, que atrasa o som e piora a avaliação.</p>
      <p class="muted small" style="margin-top:6px">Trocou de fone ou de aparelho? Calibre de novo pelo Perfil.</p></div>`;
    setStatus('');
    if ((await choose([{ id: 'go', label: 'Começar', primary: true }])) !== 'go') return false;
    $('#sResult').innerHTML = '';
    setStatus('Silêncio…');
    const r1 = await runClicks(6, 100, { signal: S.ctl.signal });
    if (!r1) return false;
    const leak = analyzeSilent(r1.clickTimes, r1.onsets);

    $('#sSub').textContent = 'Passo 2 de 2: toque no pad junto com os 8 clicks, bem no tempo.';
    setStatus('');
    if ((await choose([{ id: 'go', label: 'Começar', primary: true }])) !== 'go') return false;
    const r2 = await runClicks(8, 90, { signal: S.ctl.signal, onClick: i => setStatus(String(i + 1), 'count') });
    if (!r2) return false;
    const cal = resolveCalibration(analyzePlay(r2.clickTimes, r2.onsets, leak), leak);
    if (!cal || Math.abs(cal.offset) > 0.3) {
      setStatus(cal ? 'A latência passou de 300 ms: provavelmente é fone Bluetooth. Use fone com fio ou o alto-falante e repita.'
        : 'Detectei poucos toques. Toque mais firme, com o celular perto do pad.');
      if ((await choose([{ id: 'retry', label: 'Repetir calibração', primary: true }])) !== 'retry') return false;
      continue;
    }
    state.calib = { offset: cal.offset, source: cal.source, biasMs: cal.biasMs, leakLatency: leak.leakLatency, leakPeak: leak.leakPeak, at: Date.now() };
    await save();
    track('calib_done', { source: cal.source, ms: Math.round(cal.offset * 1000) });
    const notes = [];
    if (cal.biasMs != null && Math.abs(cal.biasMs) >= 15) {
      notes.push(`Na calibração você tocou em média ${Math.abs(cal.biasMs)} ms ${cal.biasMs < 0 ? 'adiantado' : 'atrasado'}. Isso não entra na compensação: o app mediu a latência pelo próprio click, então a avaliação vai mostrar essa tendência.`);
    }
    if (leak.leakLatency != null) notes.push('O click está vazando do alto-falante pro microfone. O app descarta esse som, mas com fone com fio a avaliação fica mais precisa.');
    if (cal.source === 'play' && cal.offset > 0.15) notes.push('A latência está alta, o que é típico de fone Bluetooth. Com fone com fio a avaliação fica mais precisa.');
    $('#sSub').textContent = `Pronto. Latência compensada: ${Math.round(cal.offset * 1000)} ms.`;
    $('#sResult').innerHTML = notes.map(n => `<p class="muted small" style="margin-top:8px">${n}</p>`).join('');
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
  track('take', { kind, score: res.score, bpm });
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
      <div class="chart-legend" style="margin-top:4px"><span class="early">adiantado</span><span>${res.hits} de ${res.total} notas ouvidas</span></div>
      ${res.extras ? `<p class="muted small" style="margin-top:8px">${plural(res.extras, 'toque a mais foi ouvido', 'toques a mais foram ouvidos')} fora do padrão. Se você não tocou isso, pode ser barulho no ambiente ou o som do pad ressoando: afaste o celular de outras fontes de som.</p>` : ''}
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
  track('workout_done', { avg: avg == null ? -1 : avg, streak: currentStreak(state, today()) });
  const tr = getTrail(state.trail), { stage } = currentStage(state, tr);
  let next = 'Prova da trilha';
  if (!stage.prova) {
    const wb = stageWork(state, stage).bpm;
    next = `${getRud(stage.rud).n} a ${wb} BPM` + (wb < stage.bpm ? `, rumo à meta de ${stage.bpm}` : '');
  }
  await save();
  $('#sBody').innerHTML = `<div class="done-hero"><div class="check">${ICON.check}</div>
      <div class="h1" style="margin-top:14px">Treino concluído</div>
      <p class="muted small" style="margin-top:4px">${plural(scored.length, 'bloco avaliado', 'blocos avaliados')}</p></div>
    ${avg != null ? `<div class="card" style="text-align:center"><div class="kicker">PRECISÃO MÉDIA</div><div class="score" style="font-family:var(--display);font-size:52px;color:${scoreColor(avg)}">${avg}</div></div>` : ''}
    <div class="reward-grid"><div class="reward xp"><div class="v">+${xp} XP</div><div class="muted small">neste treino</div></div>
      <div class="reward st"><div class="v">${plural(currentStreak(state, today()), 'dia', 'dias')}</div><div class="muted small">${currentStreak(state, today()) === 1 ? 'sequência iniciada' : 'sequência mantida'}</div></div></div>
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
  const { trail: tr, placed } = applyPlacement(state, scores);
  state.today = null; trailView = null;
  await save(); setLevelColor();
  track('diag_done', { placed: placed.id, min: Math.min(...scores) });
  setDots(takes.length + 1, takes.length + 1);
  const why = tr.id !== placed.id ? `Você já tinha liberado a trilha ${tr.name}, então continua nela. Pra voltar a uma trilha anterior, use a aba Trilha.`
    : tr.id === 'iniciante' ? 'A trilha Iniciante constrói a base de singles, doubles e paradiddle.'
    : 'Sua base está firme: você começa direto na trilha Intermediário.';
  screen('DIAGNÓSTICO', `Sua trilha: ${tr.name}`, `Notas: ${scores.join(' e ')}. ${why}`, false);
  await choose([{ id: 'ok', label: 'Ver meu treino do dia', primary: true }]);
  closeOverlay();
}

// =================== APRESENTAÇÃO ===================
const FEAT_ICON = {
  day: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  path: '<svg viewBox="0 0 24 24"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/></svg>',
  drum: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="15" rx="9" ry="4"/><path d="M3 15v-3c0-2.2 4-4 9-4s9 1.8 9 4v3M6 3l5 7M18 3l-5 7"/></svg>',
  metro: '<svg viewBox="0 0 24 24"><path d="M9 3h6l4 18H5z"/><path d="M12 15l5-8"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};
function featCard(icon, color, title, text, extra = '') {
  return `<div class="card"><div class="feat"><div class="ic" style="background:${color}">${FEAT_ICON[icon]}</div>
    <div style="flex:1"><b>${title}</b><p>${text}</p></div></div>${extra}</div>`;
}
function renderIntro() {
  const el = $('#v-intro');
  const bars = [6, -4, 9, -14, 3, 7, -5, -12, -2, 4, 8, -15, 6, -3, 2, -11];
  const chart = `<svg class="feat-chart" viewBox="0 0 320 64" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="32" x2="320" y2="32" stroke="#3A3450"/>${bars.map((d, i) => {
      const x = 8 + i * 19.4, hgt = Math.abs(d) * 1.8;
      return `<rect x="${x}" y="${d > 0 ? 32 - hgt : 32}" width="11" height="${hgt}" rx="2" fill="${d > 0 ? '#FF8A2B' : '#3EB8F0'}"/>`;
    }).join('')}</svg>`;
  let install;
  if (IS_STANDALONE) install = '<p class="ok" style="margin-top:8px">Você já está usando o app instalado.</p>';
  else if (IS_IOS) install = `<ol><li>Abra este site no <b>Safari</b>.</li><li>Toque no botão <b>Compartilhar</b> (quadrado com seta pra cima).</li><li>Escolha <b>Adicionar à Tela de Início</b> e confirme.</li></ol>`;
  else if (IS_ANDROID) install = `<ol><li>Abra este site no <b>Chrome</b>.</li><li>Toque no menu <b>⋮</b> no canto superior.</li><li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li></ol>`;
  else install = `<p class="muted small" style="margin-top:8px">No celular, abra este endereço e adicione à tela inicial: no iPhone pelo botão Compartilhar do Safari, no Android pelo menu do Chrome.</p>`;

  el.innerHTML = `<div class="hero">
      <div class="kicker">METRÔNOMO · RUDIMENTOS · TREINO DIÁRIO</div>
      <h1>Um treino de bateria por dia, que ouve você tocar</h1>
      <p>O Batera no Click monta seu treino, escuta seus toques pelo microfone e mostra onde você corre ou atrasa. Grátis, direto no navegador, sem cadastro.</p>
      <div class="hero-demo"><div class="stage" id="introStage"></div>
      <div class="sheet"><div class="cells" id="introCells"></div></div></div>
      <div class="stack"><button class="btn-primary" data-act="start">Começar</button>
      <button class="btn-ghost" data-act="explore">Só explorar</button></div></div>

    <div class="sec-title">Como funciona</div>
    <div class="steps">
      <div class="step"><span class="n">1</span><div><b>Calibre o microfone</b><p>30 segundos, com o celular perto do pad ou da caixa.</p></div></div>
      <div class="step"><span class="n">2</span><div><b>Faça o treino do dia</b><p>Uns 10 minutos: aquecimento, foco da trilha, ponto fraco e um desafio.</p></div></div>
      <div class="step"><span class="n">3</span><div><b>Acompanhe sua evolução</b><p>Nota de precisão, diagnóstico de onde você erra e seu BPM limpo subindo semana a semana.</p></div></div>
    </div>

    <div class="sec-title">O que tem no app</div>
    <div class="feat-grid">${featCard('day', 'var(--ok)', 'Treino do dia', 'Quatro blocos montados pra você, que se ajustam ao seu resultado: acertou, o BPM sobe; errou, ele desce.')}
    ${featCard('mic', 'var(--L)', 'Avaliação de timing', 'O app ouve cada toque e mostra nota a nota se você adiantou ou atrasou, e em qual tempo do padrão.', chart)}
    ${featCard('path', '#B98CFF', 'Trilhas por nível', 'Iniciante, Intermediário e Avançado, com estrelas por etapa e uma prova pra liberar o próximo nível.')}
    ${featCard('drum', 'var(--R)', 'Os 40 rudimentos', 'Todos os rudimentos PAS com baquetas animadas, sticking colorido e acentos destacados.')}
    ${featCard('metro', 'var(--xp)', 'Metrônomo completo', 'Compassos, subdivisões, speed trainer, tap tempo e detecção do BPM de uma música.')}</div>

    <div class="sec-title">Seu áudio não sai do celular</div>
    ${featCard('lock', 'var(--streak)', 'Privacidade', 'O microfone só mede o momento de cada toque: nada é gravado nem enviado. Seu progresso fica salvo no próprio aparelho.')}

    <div class="sec-title" id="install">Instale na tela inicial</div>
    <div class="card install"><p class="muted small">Instalado, o app abre em tela cheia, funciona sem internet e o seu progresso fica protegido.</p>${install}</div>

    <div class="stack" style="margin:28px 0 12px"><button class="btn-primary" data-act="start">Começar agora</button></div>`;

  // demonstração silenciosa: paradiddle animado
  const rud = getRud('single-paradiddle');
  const cells = renderCells($('#introCells'), rud);
  const stg = renderStage($('#introStage'));
  let i = 0;
  introTimer = setInterval(() => {
    const k = i % rud.tokens.length, t = rud.tokens[k];
    cells.highlight(k); stg.strike(t.hand, t.acc); i++;
  }, 190);

  el.onclick = e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    state.seenIntro = true; save();
    track('intro_' + a.dataset.act);
    if (a.dataset.act === 'start' && !state.placed) { show('hoje'); runDiagnostic(); }
    else show('hoje');
  };
}

// =================== FEEDBACK ===================
let fbCooldown = 0;
function techInfo() {
  const c = state.calib;
  const last = sessions.slice(-5).map(x => `${x.rud} ${x.bpm}bpm nota ${x.score}`).join('; ');
  return [
    `Navegador: ${UA}`,
    `Instalado: ${IS_STANDALONE ? 'sim' : 'não'}`,
    `Calibração: ${c ? `${Math.round(c.offset * 1000)} ms, vazamento ${c.leakLatency != null ? 'sim' : 'não'}` : 'não feita'}`,
    `Trilha: ${state.trail}, avaliações: ${state.sessions}`,
    `Últimas: ${last || 'nenhuma'}`,
  ].join('\n');
}
function renderFeedback() {
  const el = $('#v-feedback');
  el.innerHTML = `<button class="back" data-act="back">‹ Voltar</button>
    <div class="h1" style="margin-top:4px">Enviar feedback</div>
    <p class="muted small" style="margin-top:6px">Vai direto pro criador do app. Nota que pareceu injusta, erro, ideia: tudo ajuda.</p>
    <div class="form">
      <label>Assunto<select id="fbType">
        <option>A nota da avaliação pareceu errada</option><option>Encontrei um erro</option>
        <option>Sugestão</option><option>Outro</option></select></label>
      <label>Mensagem<textarea id="fbMsg" maxlength="2000" placeholder="Conte o que aconteceu ou o que você gostaria de ver no app"></textarea></label>
      <label>Seu contato (opcional)<input id="fbContact" maxlength="120" autocomplete="email" placeholder="E-mail ou @instagram, se quiser resposta"></label>
      <label class="check"><input type="checkbox" id="fbTech" checked> Incluir dados técnicos (navegador, calibração e últimas notas)</label>
      <input type="checkbox" id="fbBot" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn-primary" data-act="send" id="fbSend">Enviar</button>
      <p class="small" id="fbStatus" role="status"></p>
      <p class="muted small">O envio usa o serviço Web3Forms. Vai só o que estiver neste formulário; o contato é opcional.</p>
    </div>`;
  el.onclick = async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'back') { show(feedbackFrom); return; }
    if (a.dataset.act === 'send') sendFeedback();
  };
}
async function sendFeedback() {
  const st = $('#fbStatus'), btn = $('#fbSend');
  const msg = $('#fbMsg').value.trim(), contact = $('#fbContact').value.trim();
  const say = (t, ok) => { st.textContent = t; st.style.color = ok ? 'var(--ok)' : 'var(--bad)'; };
  if (!FEEDBACK_KEY) { say('O formulário ainda não foi configurado.', false); return; }
  if (msg.length < 5) { say('Escreva pelo menos uma frase.', false); return; }
  if (Date.now() < fbCooldown) { say('Aguarde um minuto antes de enviar de novo.', false); return; }
  const body = {
    access_key: FEEDBACK_KEY,
    subject: 'Batera no Click: ' + $('#fbType').value,
    from_name: 'Batera no Click',
    assunto: $('#fbType').value,
    mensagem: msg,
    contato: contact || '(não informado)',
    dados_tecnicos: $('#fbTech').checked ? techInfo() : '(não incluídos)',
    botcheck: $('#fbBot').checked,
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) body.replyto = contact;
  btn.disabled = true; say('Enviando…', true);
  try {
    const r = await fetch('https://api.web3forms.com/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) throw new Error(j.message || 'falha');
    fbCooldown = Date.now() + 60000;
    track('feedback_sent');
    $('#fbMsg').value = ''; $('#fbContact').value = '';
    say('Enviado. Obrigado pelo retorno!', true);
  } catch (err) {
    say(navigator.onLine ? 'Não foi possível enviar agora. Tente de novo em instantes.' : 'Sem internet. Conecte e tente de novo.', false);
  } finally { btn.disabled = false; }
}

// =================== BACKUP ===================
async function exportBackup() {
  const data = { app: 'batera-no-click', v: 1, exportedAt: new Date().toISOString(), state, sessions };
  const name = `batera-no-click-backup-${today()}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup do Batera no Click' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('Backup salvo');
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const validRud = id => { try { getRud(id); return true; } catch (e) { return false; } };
function cleanState(raw) {
  const st = newState();
  if (!raw || typeof raw !== 'object') return st;
  if (isNum(raw.xp) && raw.xp >= 0) st.xp = Math.floor(raw.xp);
  if (raw.xpDay && isNum(raw.xpDay.xp) && typeof raw.xpDay.day === 'string') st.xpDay = { day: raw.xpDay.day, xp: raw.xpDay.xp };
  if (raw.streak && isNum(raw.streak.count)) st.streak = { count: raw.streak.count, last: typeof raw.streak.last === 'string' ? raw.streak.last : null, freezeWeek: typeof raw.streak.freezeWeek === 'string' ? raw.streak.freezeWeek : null };
  const trailIds = TRAILS.map(t => t.id);
  if (trailIds.includes(raw.trail)) st.trail = raw.trail;
  if (Array.isArray(raw.unlocked)) st.unlocked = [...new Set(['iniciante', ...raw.unlocked.filter(x => trailIds.includes(x))])];
  if (!st.unlocked.includes(st.trail)) st.trail = 'iniciante';
  for (const [id, w] of Object.entries(raw.stages || {})) {
    if (findStage(id) && w && isNum(w.stars)) st.stages[id] = { stars: Math.min(3, Math.max(0, w.stars)), best: isNum(w.best) ? w.best : 0, bpm: isNum(w.bpm) ? w.bpm : null, hist: Array.isArray(w.hist) ? w.hist.filter(isNum).slice(-3) : [] };
  }
  for (const [id, r] of Object.entries(raw.records || {})) {
    if (validRud(id) && r && isNum(r.clean)) st.records[id] = { clean: r.clean, best: isNum(r.best) ? r.best : 0 };
  }
  st.placed = raw.placed === true;
  st.seenIntro = true;
  if (typeof raw.firstDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.firstDay)) st.firstDay = raw.firstDay;
  if (raw.calib && isNum(raw.calib.offset)) st.calib = { offset: raw.calib.offset, leakLatency: isNum(raw.calib.leakLatency) ? raw.calib.leakLatency : null, leakPeak: isNum(raw.calib.leakPeak) ? raw.calib.leakPeak : 0, at: isNum(raw.calib.at) ? raw.calib.at : Date.now() };
  return st;
}
function cleanSession(x) {
  if (!x || typeof x !== 'object' || !validRud(x.rud) || !isNum(x.bpm) || !isNum(x.score) || typeof x.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.day)) return null;
  const str = v => (typeof v === 'string' ? v.slice(0, 300) : null);
  return {
    ts: isNum(x.ts) ? x.ts : Date.now(), day: x.day, kind: str(x.kind) || 'livre', rud: x.rud, bpm: x.bpm, spb: isNum(x.spb) ? x.spb : getRud(x.rud).spb,
    score: x.score, consistency: isNum(x.consistency) ? x.consistency : null, meanAbsMs: isNum(x.meanAbsMs) ? x.meanAbsMs : null,
    tendencyMs: isNum(x.tendencyMs) ? x.tendencyMs : null, diagTitle: str(x.diagTitle), diagText: str(x.diagText),
    stageId: findStage(x.stageId) ? x.stageId : null, gap: null,
  };
}
async function importBackup(file) {
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('grande');
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'batera-no-click' || !Array.isArray(data.sessions)) throw new Error('formato');
    const list = data.sessions.map(cleanSession).filter(Boolean);
    if (!confirm(`Substituir o progresso deste aparelho pelo backup (${list.length} avaliações)? O progresso atual será apagado.`)) return;
    await clearAll();
    state = cleanState(data.state);
    for (const x of list) await addSession(x);
    sessions = await allSessions();
    state.sessions = sessions.length; // o contador de avaliações acompanha o histórico restaurado
    trailView = null;
    await save();
    toast('Backup restaurado');
    render();
  } catch (e) {
    toast('Arquivo inválido. Use um backup gerado pelo Batera no Click.');
  }
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
  // retenção: em que dia de uso a pessoa está (faixas, nunca a data em si)
  if (!state.firstDay) { state.firstDay = today(); save(); }
  const d = dayDiff(state.firstDay, today());
  track('open', { since: d === 0 ? 'd0' : d === 1 ? 'd1' : d <= 7 ? 'd2-7' : d <= 30 ? 'd8-30' : 'd30+', installed: IS_STANDALONE ? 'sim' : 'nao' });
  initMetronome();
  document.querySelectorAll('.tabbar button').forEach(b => { b.onclick = () => show(b.dataset.view); });
  $('#streakChip').onclick = () => show('perfil');
  if (!state.seenIntro) show('intro'); else render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
boot();
