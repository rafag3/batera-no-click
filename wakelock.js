// Mantém a tela acesa durante treino e metrônomo: com a tela apagada o take se perde.
// Cada parte do app pede pelo próprio nome; a tela só pode apagar quando ninguém mais precisa.
const holders = new Set();
let lock = null;

async function acquire() {
  if (lock || !holders.size || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) { /* bateria fraca, permissão negada etc.: segue sem */ }
}

export function keepAwake(name) { holders.add(name); acquire(); }
export function allowSleep(name) {
  holders.delete(name);
  if (!holders.size && lock) { lock.release().catch(() => {}); lock = null; }
}

// o navegador solta o bloqueio quando a aba fica oculta; pede de novo ao voltar
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
