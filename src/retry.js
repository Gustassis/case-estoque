// Tenta executar fn ate 'tentativas' vezes, com espera crescente + jitter
export async function comRetry(fn, { tentativas = 5, baseMs = 100, maxMs = 2000 } = {}) {
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn(i);
    } catch (err) {
      ultimoErro = err;
      if (i === tentativas) break;
      const espera = Math.min(maxMs, baseMs * 2 ** (i - 1));
      const jitter = Math.random() * espera * 0.3;
      console.log(`tentativa ${i} falhou (${err.message}), nova tentativa em ${Math.round(espera + jitter)}ms`);
      await new Promise((r) => setTimeout(r, espera + jitter));
    }
  }
  throw ultimoErro;
}