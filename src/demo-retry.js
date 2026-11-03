import { comRetry } from './retry.js';

let chamadas = 0;

// Gateway ficticio: falha nas 2 primeiras chamadas, responde na 3a
async function gatewayFicticio() {
  chamadas++;
  if (chamadas <= 2) throw new Error('gateway indisponivel');
  return { status: 'aprovado' };
}

const resultado = await comRetry(() => gatewayFicticio());
console.log('resultado final:', resultado, '| chamadas feitas:', chamadas);