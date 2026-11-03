import express from 'express';
import pg from 'pg';

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

app.post('/checkout', async (req, res) => {
  const produtoId = req.body?.produto_id ?? 1;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Conferir e decrementar em UMA operacao atomica
    const baixa = await client.query(
      'UPDATE produtos SET estoque = estoque - 1 WHERE id = $1 AND estoque > 0',
      [produtoId]
    );

    if (baixa.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ erro: 'sem estoque' });
    }

    await client.query('INSERT INTO pedidos (produto_id) VALUES ($1)', [produtoId]);
    await client.query('COMMIT');

    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ erro: 'falha interna' });
  } finally {
    client.release();
  }
});

app.listen(3000, () => console.log('V2 (correta) em http://localhost:3000'));