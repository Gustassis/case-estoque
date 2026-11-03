import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';

const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'loja',
  password: 'loja123',
  database: 'loja',
});

const PORTA = 3101;
const BASE = `http://localhost:${PORTA}`;
let proc;

function subir() {
  return new Promise((resolve, reject) => {
    const p = spawn('node', ['src/v3-reserva.js'], {
      env: { ...process.env, PORT: String(PORTA), RESERVA_SEGUNDOS: '600' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    p.stdout.once('data', () => resolve(p));
    p.once('error', reject);
  });
}

async function post(caminho, corpo) {
  const r = await fetch(BASE + caminho, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo ?? {}),
  });
  return r.json();
}

async function resetar() {
  await pool.query('UPDATE produtos SET estoque = 1 WHERE id = 1');
  await pool.query('DELETE FROM eventos_pagamento');
  await pool.query('DELETE FROM pedidos');
}

before(async () => {
  proc = await subir();
});

after(async () => {
  proc.kill();
  await new Promise((r) => setTimeout(r, 500));
  await pool.end();
});

test('webhook "pago" disparado 5 vezes tem efeito unico', async () => {
  await resetar();
  const { pedido } = await post('/checkout');

  const respostas = [];
  for (let i = 0; i < 5; i++) {
    respostas.push(
      await post('/webhook/pagamento', {
        evento_id: 'evt_pago_1',
        pedido_id: pedido.id,
        tipo: 'pago',
      })
    );
  }

  const processados = respostas.filter((r) => r.processado).length;
  const duplicados = respostas.filter((r) => r.duplicado).length;
  const { rows: ped } = await pool.query('SELECT status FROM pedidos WHERE id = $1', [pedido.id]);
  const { rows: ev } = await pool.query('SELECT count(*)::int AS n FROM eventos_pagamento');
  const { rows: est } = await pool.query('SELECT estoque FROM produtos WHERE id = 1');

  console.log(`pago x5: processados=${processados} | duplicados=${duplicados} | status=${ped[0].status} | eventos=${ev[0].n} | estoque=${est[0].estoque}`);

  assert.equal(processados, 1);
  assert.equal(duplicados, 4);
  assert.equal(ped[0].status, 'pago');
  assert.equal(ev[0].n, 1);
  assert.equal(est[0].estoque, 0);
});

test('webhook "falhou" disparado 5 vezes libera a reserva uma vez so', async () => {
  await resetar();
  const { pedido } = await post('/checkout');

  for (let i = 0; i < 5; i++) {
    await post('/webhook/pagamento', {
      evento_id: 'evt_falha_1',
      pedido_id: pedido.id,
      tipo: 'falhou',
    });
  }

  const { rows: ped } = await pool.query('SELECT status FROM pedidos WHERE id = $1', [pedido.id]);
  const { rows: est } = await pool.query('SELECT estoque FROM produtos WHERE id = 1');

  console.log(`falhou x5: status=${ped[0].status} | estoque=${est[0].estoque}`);

  assert.equal(ped[0].status, 'cancelado');
  assert.equal(est[0].estoque, 1);
});