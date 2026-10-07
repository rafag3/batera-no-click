// Rodar: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newState, levelInfo, touchStreak, currentStreak, applyScored, applyStageResult,
  applyPlacement, chooseTrail, applyProva, stageWork,
} from '../progress.js';
import { buildWorkout } from '../workout.js';
import { TRAILS, findStage } from '../trails.js';

test('níveis: 100 XP pro nível 2, depois +50 por nível', () => {
  assert.deepEqual(levelInfo(0), { level: 1, into: 0, need: 100 });
  assert.equal(levelInfo(100).level, 2);
  assert.equal(levelInfo(249).level, 2);
  assert.equal(levelInfo(250).level, 3);
});

test('streak: dia seguido soma, 1 folga por semana é perdoada, 2 dias zera', () => {
  const s = newState();
  touchStreak(s, '2026-10-05'); touchStreak(s, '2026-10-06');
  assert.equal(s.streak.count, 2);
  touchStreak(s, '2026-10-08'); // pulou 07: usa a folga da semana
  assert.equal(s.streak.count, 3);
  assert.equal(currentStreak(s, '2026-10-09'), 3);
  assert.equal(currentStreak(s, '2026-10-11'), 0);
});

test('XP diário tem teto de 300', () => {
  const s = newState();
  let total = 0;
  for (let i = 0; i < 40; i++) total += applyScored(s, { rud: 'single-stroke-roll', score: 95, bpm: 200, spb: 4 }, '2026-10-06').xp;
  assert.equal(total, 300);
});

test('BPM limpo só conta com 85+', () => {
  const s = newState();
  assert.equal(applyScored(s, { rud: 'pulso', score: 84, bpm: 90, spb: 1 }, '2026-10-06').newRecord, false);
  assert.equal(applyScored(s, { rud: 'pulso', score: 85, bpm: 90, spb: 1 }, '2026-10-06').newRecord, true);
});

test('etapa: abaixo de 75 desce o BPM; dois 90+ sobem até a meta', () => {
  const s = newState();
  const { stage } = findStage('i2'); // single stroke a 60
  stageWork(s, stage).bpm = 52;
  assert.equal(applyStageResult(s, stage, 70, 52).adapt, 'down');
  assert.equal(s.stages.i2.bpm, 47);
  applyStageResult(s, stage, 92, 47);
  assert.equal(applyStageResult(s, stage, 93, 47).adapt, 'up');
  assert.equal(s.stages.i2.bpm, 51);
});

test('diagnóstico: coloca no Intermediário com 85+ nas duas notas', () => {
  const s = newState();
  assert.equal(applyPlacement(s, [90, 88]).trail.id, 'intermediario');
  const b = newState();
  assert.equal(applyPlacement(b, [90, 70]).trail.id, 'iniciante');
});

test('refazer o diagnóstico nunca rebaixa a trilha ativa', () => {
  const s = newState();
  s.placed = true; s.unlocked = ['iniciante', 'intermediario', 'avancado']; s.trail = 'avancado';
  const r = applyPlacement(s, [60, 50]);
  assert.equal(s.trail, 'avancado');
  assert.equal(r.placed.id, 'iniciante');
});

test('refazer o diagnóstico pode promover quem pulou no Iniciante', () => {
  const s = newState(); s.placed = true;
  applyPlacement(s, [90, 90]);
  assert.equal(s.trail, 'intermediario');
});

test('troca manual de trilha só entre trilhas liberadas', () => {
  const s = newState();
  assert.equal(chooseTrail(s, 'avancado'), false);
  s.unlocked.push('intermediario');
  assert.equal(chooseTrail(s, 'intermediario'), true);
  assert.equal(s.trail, 'intermediario');
});

test('passar na prova libera e ativa a próxima trilha', () => {
  const s = newState();
  const trail = TRAILS[0], stage = trail.stages.find(x => x.prova);
  const r = applyProva(s, trail, stage, [80, 80, 80]);
  assert.equal(r.unlockedTrail.id, 'intermediario');
  assert.equal(s.trail, 'intermediario');
});

test('1º treino do iniciante não pede rudimento ainda bloqueado', () => {
  const s = newState(); s.placed = true;
  const w = buildWorkout(s, [], '2026-10-06');
  const review = w.blocks.find(b => b.kind === 'fraco');
  assert.equal(review.rud, 'colcheias');
  assert.equal(w.blocks.length, 4);
});

test('treino de trilha avançada usa a etapa anterior como revisão', () => {
  const s = newState(); s.placed = true;
  s.unlocked = ['iniciante', 'intermediario']; s.trail = 'intermediario';
  s.stages.m1 = { stars: 2, best: 85, bpm: 70, hist: [] };
  const w = buildWorkout(s, [], '2026-10-06');
  assert.equal(w.blocks[1].rud, 'seven-stroke-roll'); // foco = m2
  assert.equal(w.blocks.find(b => b.kind === 'fraco').rud, 'five-stroke-roll'); // revisão = m1
});
