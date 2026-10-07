// Rodar: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTake, matchOnsets, gateLeak, analyzeSilent, analyzePlay, resolveCalibration, windowFor } from '../scoring.js';

// take sintético: n notas a cada `iv` segundos, começando em t0
const grid = (n, iv, t0 = 1) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * iv, pos: i % 4 }));
const hitsAt = (exp, devFn) => exp.map((e, i) => ({ t: e.t + devFn(i), peak: 0.5 }));

test('toques perfeitos dão nota 100', () => {
  const exp = grid(16, 0.25);
  const r = scoreTake({ expected: exp, onsets: hitsAt(exp, () => 0), interval: 0.25 });
  assert.equal(r.score, 100);
  assert.equal(r.hits, 16);
  assert.equal(r.extras, 0);
  assert.equal(r.tendencyMs, 0);
});

test('offset da calibração é descontado', () => {
  const exp = grid(16, 0.25);
  const r = scoreTake({ expected: exp, onsets: hitsAt(exp, () => 0.08), interval: 0.25, calib: { offset: 0.08, leakLatency: null } });
  assert.equal(r.score, 100);
});

test('atraso constante aparece como tendência positiva e baixa a nota', () => {
  const exp = grid(16, 0.25);
  const r = scoreTake({ expected: exp, onsets: hitsAt(exp, () => 0.03), interval: 0.25 });
  assert.equal(r.tendencyMs, 30);
  assert.ok(r.score < 100 && r.score > 50, `nota ${r.score}`);
});

test('nota faltando reduz acerto; toque extra é contado e penaliza', () => {
  const exp = grid(16, 0.25);
  const ons = hitsAt(exp, () => 0).filter((_, i) => i !== 5);
  ons.push({ t: exp[2].t + 0.125, peak: 0.5 }); // toque no meio de duas notas
  const r = scoreTake({ expected: exp, onsets: ons, interval: 0.25 });
  assert.equal(r.hits, 15);
  assert.equal(r.extras, 1);
  assert.ok(r.score < 94);
});

test('sem toques: nota zero e sem estatísticas', () => {
  const r = scoreTake({ expected: grid(8, 0.25), onsets: [], interval: 0.25 });
  assert.equal(r.score, 0);
  assert.equal(r.hits, 0);
  assert.equal(r.meanAbsMs, null);
});

test('matchOnsets casa 1:1 pelo menor desvio', () => {
  const { devs, extras } = matchOnsets([1, 2], [1.01, 1.02, 2.0], 0.1);
  assert.deepEqual(devs.map(d => Math.round(d * 1000)), [10, 0]);
  assert.equal(extras, 1);
});

test('janela de aceitação fica entre 40 e 120 ms', () => {
  assert.equal(windowFor(0.05), 0.04);
  assert.equal(windowFor(1), 0.12);
});

test('gateLeak remove só o vazamento fraco no atraso do click', () => {
  const calib = { leakLatency: 0.05, leakPeak: 0.1 };
  const ons = [{ t: 1.05, peak: 0.1 }, { t: 1.05, peak: 0.5 }, { t: 1.2, peak: 0.1 }];
  assert.deepEqual(gateLeak(ons, [1], calib).map(o => o.peak), [0.5, 0.1]);
});

test('calibração: vazamento detectado vira a latência; sem vazamento usa o tocado', () => {
  const clicks = [1, 2, 3, 4, 5, 6];
  const leak = analyzeSilent(clicks, clicks.map(c => ({ t: c + 0.06, peak: 0.08 })));
  assert.equal(Math.round(leak.leakLatency * 1000), 60);
  assert.equal(analyzeSilent(clicks, []).leakLatency, null);

  // quem calibrou correu 20 ms: a latência continua 60 e o viés aparece separado
  const play = analyzePlay(clicks, clicks.map(c => ({ t: c + 0.04, peak: 0.6 })), leak);
  const cal = resolveCalibration(play, leak);
  assert.equal(cal.source, 'leak');
  assert.equal(Math.round(cal.offset * 1000), 60);
  assert.equal(cal.biasMs, -20);

  const noLeak = resolveCalibration(0.09, { leakLatency: null });
  assert.equal(noLeak.source, 'play');
  assert.equal(noLeak.offset, 0.09);
  assert.equal(resolveCalibration(null, leak), null);
});
