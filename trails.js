// Trilhas por nível. Só usam rudimentos avaliáveis pelo microfone.
// Etapa normal: { id, rud, bpm } · Prova: { id, prova: true, takes: [{rud, bpm}], min }
export const TRAILS = [
  {
    id: 'iniciante', name: 'Iniciante', color: '#5BE38A',
    stages: [
      { id: 'i1', rud: 'pulso', bpm: 60 },
      { id: 'i2', rud: 'single-stroke-roll', bpm: 60 },
      { id: 'i3', rud: 'single-stroke-roll', bpm: 80 },
      { id: 'i4', rud: 'double-stroke-open-roll', bpm: 60 },
      { id: 'i5', rud: 'single-paradiddle', bpm: 60 },
      { id: 'i6', rud: 'single-paradiddle', bpm: 80 },
      { id: 'i7', rud: 'double-stroke-open-roll', bpm: 80 },
      { id: 'i8', prova: true, min: 75, takes: [
        { rud: 'single-stroke-roll', bpm: 80 },
        { rud: 'double-stroke-open-roll', bpm: 70 },
        { rud: 'single-paradiddle', bpm: 75 },
      ]},
    ],
    tracked: ['single-stroke-roll', 'double-stroke-open-roll', 'single-paradiddle'],
    gap: { on: 3, off: 1 },
  },
  {
    id: 'intermediario', name: 'Intermediário', color: '#5B9BFF',
    stages: [
      { id: 'm1', rud: 'five-stroke-roll', bpm: 70 },
      { id: 'm2', rud: 'seven-stroke-roll', bpm: 70 },
      { id: 'm3', rud: 'single-paradiddle-diddle', bpm: 70 },
      { id: 'm4', rud: 'double-paradiddle', bpm: 80 },
      { id: 'm5', rud: 'triple-stroke-roll', bpm: 70 },
      { id: 'm6', rud: 'nine-stroke-roll', bpm: 80 },
      { id: 'm7', rud: 'single-paradiddle-diddle', bpm: 90 },
      { id: 'm8', prova: true, min: 78, takes: [
        { rud: 'five-stroke-roll', bpm: 90 },
        { rud: 'double-paradiddle', bpm: 90 },
        { rud: 'triple-stroke-roll', bpm: 80 },
      ]},
    ],
    tracked: ['double-stroke-open-roll', 'single-paradiddle-diddle', 'triple-stroke-roll'],
    gap: { on: 2, off: 2 },
  },
  {
    id: 'avancado', name: 'Avançado', color: '#B98CFF',
    stages: [
      { id: 'a1', rud: 'single-stroke-four', bpm: 110 },
      { id: 'a2', rud: 'single-stroke-seven', bpm: 110 },
      { id: 'a3', rud: 'triple-paradiddle', bpm: 100 },
      { id: 'a4', rud: 'thirteen-stroke-roll', bpm: 100 },
      { id: 'a5', rud: 'single-stroke-roll', bpm: 130 },
      { id: 'a6', rud: 'double-stroke-open-roll', bpm: 115 },
      { id: 'a7', rud: 'single-paradiddle', bpm: 130 },
      { id: 'a8', prova: true, min: 80, takes: [
        { rud: 'single-stroke-roll', bpm: 140 },
        { rud: 'double-stroke-open-roll', bpm: 120 },
        { rud: 'triple-paradiddle', bpm: 110 },
      ]},
    ],
    tracked: ['single-stroke-roll', 'double-stroke-open-roll', 'single-paradiddle'],
    gap: { on: 2, off: 2 },
  },
];

export function getTrail(id) { return TRAILS.find(t => t.id === id) || TRAILS[0]; }
export function trailIndex(id) { return TRAILS.findIndex(t => t.id === id); }
export function findStage(stageId) {
  for (const t of TRAILS) {
    const i = t.stages.findIndex(s => s.id === stageId);
    if (i >= 0) return { trail: t, stage: t.stages[i], index: i };
  }
  return null;
}
