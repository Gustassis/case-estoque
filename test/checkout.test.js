import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import autocannon from 'autocannon';
import pg from 'pg';

const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'loja',
  password: 'loja123',
  database: 'loja',
});

const PORTA = 3100;
const CONEXOES = 300;

async function resetar() {
  await pool.query('UPDATE produtos SET estoque = 1 WHERE id = 1');
  await pool.query('DELETE FROM pedidos');
}

function subir(arquivo) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [arquivo], {
      env: { ...process.env, PORT: String(PORTA) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    proc.stdout.once('data', () => resolve(proc));
    proc.once('error', reject);
  });
}

async function disparar() {
  return autocannon({
    url: `http://localhost:${PORTA}/checkout`,
    method: 'POST',
    connections: CONEXOES,
    amount: CONEXOES,
  });
}

async function rodar(arquivo) {
  await resetar();
  const proc = await subir(arquivo);
  try {
    const r = await disparar();
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM pedidos');
    const { rows: est } = await pool.query('SELECT estoque FROM produtos WHERE id = 1');
    console.log(`${arquivo}: 2xx=${r['2xx']} | pedidos=${rows[0].n} | estoque=${est[0].estoque}`);
    return rows[0].n;
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
}

after(async () => {
  await pool.end();
});

test('V1 ingenua: nao deve vender mais que o estoque (ESPERADO FALHAR)', async () => {
  const pedidos = await rodar('src/v1-ingenua.js');
  assert.equal(pedidos, 1, `V1 aceitou ${pedidos} pedidos para 1 item`);
});

test('V2 correta: vende exatamente 1', async () => {
  const pedidos = await rodar('src/v2-correta.js');
  assert.equal(pedidos, 1);
});