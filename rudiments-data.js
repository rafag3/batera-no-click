// Biblioteca de rudimentos. Notação: r/l toque · R/L acento · f flam · g drag · z buzz · "-" pausa.
// spb = notas por tempo.
const RAW = [
  { cat: 'Fundamentos', list: [
    { n: 'Pulso', pt: 'Semínimas alternadas', spb: 1, p: 'r l r l' },
    { n: 'Colcheias', pt: 'Colcheias alternadas', spb: 2, p: 'r l r l' },
  ]},
  { cat: 'Rulos de toque simples', list: [
    { n: 'Single Stroke Roll', pt: 'Toque simples alternado', spb: 4, p: 'r l r l r l r l' },
    { n: 'Single Stroke Four', pt: 'Quatro toques simples', spb: 3, p: 'r l r L - - l r l R - -' },
    { n: 'Single Stroke Seven', pt: 'Sete toques simples', spb: 3, p: 'r l r l r l R - -' },
  ]},
  { cat: 'Rulos múltiplos e duplos', list: [
    { n: 'Multiple Bounce Roll', pt: 'Rulo de pressão (buzz)', spb: 2, p: 'zr zl zr zl' },
    { n: 'Triple Stroke Roll', pt: 'Toque triplo', spb: 3, p: 'r r r l l l' },
    { n: 'Double Stroke Open Roll', pt: 'Toque duplo (papa-mama)', spb: 4, p: 'r r l l r r l l' },
    { n: 'Five Stroke Roll', pt: 'Rulo de 5', spb: 4, p: 'r r l l R - - - l l r r L - - -' },
    { n: 'Six Stroke Roll', pt: 'Rulo de 6', spb: 4, p: 'R l l r r L - -' },
    { n: 'Seven Stroke Roll', pt: 'Rulo de 7', spb: 4, p: 'r r l l r r L -' },
    { n: 'Nine Stroke Roll', pt: 'Rulo de 9', spb: 4, p: 'r r l l r r l l R - - -' },
    { n: 'Ten Stroke Roll', pt: 'Rulo de 10', spb: 4, p: 'r r l l r r l l R L - -' },
    { n: 'Eleven Stroke Roll', pt: 'Rulo de 11', spb: 4, p: 'r r l l r r l l r r L -' },
    { n: 'Thirteen Stroke Roll', pt: 'Rulo de 13', spb: 4, p: 'r r l l r r l l r r l l R - - -' },
    { n: 'Fifteen Stroke Roll', pt: 'Rulo de 15', spb: 4, p: 'r r l l r r l l r r l l r r L -' },
    { n: 'Seventeen Stroke Roll', pt: 'Rulo de 17', spb: 4, p: 'r r l l r r l l r r l l r r l l R - - -' },
  ]},
  { cat: 'Diddles', list: [
    { n: 'Single Paradiddle', pt: 'Paradiddle simples', spb: 4, p: 'R l r r L r l l' },
    { n: 'Double Paradiddle', pt: 'Paradiddle duplo', spb: 3, p: 'R l r l r r L r l r l l' },
    { n: 'Triple Paradiddle', pt: 'Paradiddle triplo', spb: 4, p: 'R l r l r l r r L r l r l r l l' },
    { n: 'Single Paradiddle-Diddle', pt: 'Paradiddle-diddle', spb: 3, p: 'R l r r l l' },
  ]},
  { cat: 'Flams', list: [
    { n: 'Flam', pt: 'Flam alternado', spb: 1, p: 'fR fL' },
    { n: 'Flam Accent', pt: 'Flam accent (tercina)', spb: 3, p: 'fR l r fL r l' },
    { n: 'Flam Tap', pt: 'Flam tap', spb: 4, p: 'fR r fL l' },
    { n: 'Flamacue', pt: 'Flamacue', spb: 4, p: 'fr L r l fR - - -' },
    { n: 'Flam Paradiddle', pt: 'Flam paradiddle', spb: 4, p: 'fR l r r fL r l l' },
    { n: 'Single Flammed Mill', pt: 'Flammed mill', spb: 4, p: 'fR r l r fL l r l' },
    { n: 'Flam Paradiddle-Diddle', pt: 'Flam paradiddle-diddle', spb: 3, p: 'fR l r r l l fL r l l r r' },
    { n: 'Pataflafla', pt: 'Pataflafla', spb: 4, p: 'fR l r fL' },
    { n: 'Swiss Army Triplet', pt: 'Tercina suíça', spb: 3, p: 'fR r l fL l r' },
    { n: 'Inverted Flam Tap', pt: 'Flam tap invertido', spb: 4, p: 'fR l fL r' },
    { n: 'Flam Drag', pt: 'Flam drag', spb: 3, p: 'fR gl r fL gr l' },
  ]},
  { cat: 'Drags', list: [
    { n: 'Drag (Ruff)', pt: 'Drag / ruff', spb: 1, p: 'gR gL' },
    { n: 'Single Drag Tap', pt: 'Drag tap simples', spb: 2, p: 'gr L gl R' },
    { n: 'Double Drag Tap', pt: 'Drag tap duplo', spb: 3, p: 'gr gr L gl gl R' },
    { n: 'Lesson 25', pt: 'Lesson 25', spb: 4, p: 'gr l R - gl r L -' },
    { n: 'Single Dragadiddle', pt: 'Dragadiddle simples', spb: 4, p: 'gR l r r gL r l l' },
    { n: 'Drag Paradiddle #1', pt: 'Drag paradiddle nº 1', spb: 4, p: 'R - - - gr l r r L - - - gl r l l' },
    { n: 'Drag Paradiddle #2', pt: 'Drag paradiddle nº 2', spb: 4, p: 'R - - - gr - - - gr l r r L - - - gl - - - gl r l l' },
    { n: 'Single Ratamacue', pt: 'Ratamacue simples', spb: 3, p: 'gl r l R - - gr l r L - -' },
    { n: 'Double Ratamacue', pt: 'Ratamacue duplo', spb: 3, p: 'gl - - gl r l R - - gr - - gr l r L - -' },
    { n: 'Triple Ratamacue', pt: 'Ratamacue triplo', spb: 3, p: 'gl - - gl - - gl r l R - - gr - - gr - - gr l r L - -' },
  ]},
];

export function slug(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseTok(t) {
  if (t === '-') return { rest: true };
  let grace = 0, buzz = false, i = 0;
  if (t[0] === 'f') { grace = 1; i = 1; }
  else if (t[0] === 'g') { grace = 2; i = 1; }
  else if (t[0] === 'z') { buzz = true; i = 1; }
  const ch = t[i];
  return { rest: false, hand: ch.toUpperCase(), acc: ch === ch.toUpperCase(), grace, buzz };
}

export const CATEGORIES = RAW.map(c => ({
  cat: c.cat,
  list: c.list.map(r => {
    const tokens = r.p.split(/\s+/);
    return {
      id: slug(r.n), n: r.n, pt: r.pt, spb: r.spb, p: r.p,
      tokens: tokens.map(parseTok),
      // o mic só mede timing: apojatura (flam/drag) e buzz não são avaliáveis
      scorable: !/(^|\s)[fgz]/.test(r.p),
    };
  }),
}));

const BY_ID = {};
CATEGORIES.forEach(c => c.list.forEach(r => { BY_ID[r.id] = r; }));

export function getRud(id) {
  const r = BY_ID[id];
  if (!r) throw new Error('Rudimento desconhecido: ' + id);
  return r;
}
export function allRuds() { return Object.values(BY_ID); }
