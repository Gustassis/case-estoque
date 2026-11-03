import express from 'express';
import pg from 'pg';

const RESERVA_SEGUNDOS = Number(process.env.RESERVA_SEGUNDOS ?? 600);
const JOB_INTERVALO_MS = Number(process.env.JOB_INTERVALO_MS ?? 5000);

const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'loja',
  password: 'loja123',
  database: 'loja',
  max: 20,
});

const app = express();
app.use(express.json());

// Cria a reserva: baixa atomica + pedido 'reservado' com prazo
app.post('/checkout', async (req, res) => {
  const produtoId = req.body?.produto_id ?? 1;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const baixa = await client.query(
      'UPDATE produtos SET estoque = estoque - 1 WHERE id = $1 AND estoque > 0',
      [produtoId]
    );
    if (baixa.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'sem estoque' });
    }
    const pedido = await client.query(
      `INSERT INTO pedidos (produto_id, status, expira_em)
       VALUES ($1, 'reservado', now() + ($2 || ' seconds')::interval)
       RETURNING id, expira_em`,
      [produtoId, String(RESERVA_SEGUNDOS)]
    );
    await client.query('COMMIT');
    res.status(201).json({ ok: true, pedido: pedido.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ erro: 'falha interna' });
  } finally {
    client.release();
  }
});

// Libera uma reserva: muda status E devolve estoque, so se ainda estiver 'reservado'
async function liberarReserva(pedidoId, novoStatus) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE pedidos SET status = $2
       WHERE id = $1 AND status = 'reservado'
       RETURNING produto_id`,
      [pedidoId, novoStatus]
    );
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return false; // ja foi pago, cancelado ou expirado
    }
    await client.query(
      'UPDATE produtos SET estoque = estoque + 1 WHERE id = $1',
      [r.rows[0].produto_id]
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Webhook idempotente: evento_id unico garante efeito unico
app.post('/webhook/pagamento', async (req, res) => {
  const { evento_id, pedido_id, tipo } = req.body ?? {};
  if (!evento_id || !pedido_id || !['pago', 'falhou'].includes(tipo)) {
    return res.status(400).json({ erro: 'payload invalido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Registra o evento. Se ja existir, nao insere nada.
    const reg = await client.query(
      `INSERT INTO eventos_pagamento (evento_id, pedido_id, tipo)
       VALUES ($1, $2, $3)
       ON CONFLICT (evento_id) DO NOTHING`,
      [evento_id, pedido_id, tipo]
    );
    if (reg.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(200).json({ duplicado: true });
    }

    // 2) Aplica o efeito, so se o pedido ainda estiver reservado
    if (tipo === 'pago') {
      await client.query(
        `UPDATE pedidos SET status = 'pago'
         WHERE id = $1 AND status = 'reservado'`,
        [pedido_id]
      );
    } else {
      const r = await client.query(
        `UPDATE pedidos SET status = 'cancelado'
         WHERE id = $1 AND status = 'reservado'
         RETURNING produto_id`,
        [pedido_id]
      );
      if (r.rowCount === 1) {
        await client.query(
          'UPDATE produtos SET estoque = estoque + 1 WHERE id = $1',
          [r.rows[0].produto_id]
        );
      }
    }

    await client.query('COMMIT');
    res.status(200).json({ processado: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ erro: 'falha interna' });
  } finally {
    client.release();
  }
});

// Job de expiracao
async function expirarVencidos() {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM pedidos WHERE status = 'reservado' AND expira_em < now()`
    );
    for (const { id } of rows) {
      if (await liberarReserva(id, 'expirado')) {
        console.log(`reserva ${id} expirou, estoque devolvido`);
      }
    }
  } catch (err) {
    console.error('erro no job de expiracao:', err.message);
  }
}
setInterval(expirarVencidos, JOB_INTERVALO_MS);

app.listen(3000, () =>
  console.log(`V3 (reserva ${RESERVA_SEGUNDOS}s) em http://localhost:3000`)
);
