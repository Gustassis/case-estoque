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

  // 1) LE o estoque
  const { rows } = await pool.query(
    'SELECT estoque FROM produtos WHERE id = $1',
    [produtoId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ erro: 'produto nao encontrado' });
  }
  const estoqueAtual = rows[0].estoque;

  // 2) CONFERE
  if (estoqueAtual <= 0) {
    return res.status(409).json({ erro: 'sem estoque' });
  }

  // 3) DECREMENTA (grava o valor que ele mesmo calculou)
  await pool.query('UPDATE produtos SET estoque = $1 WHERE id = $2', [
    estoqueAtual - 1,
    produtoId,
  ]);

  // 4) REGISTRA a venda
  await pool.query('INSERT INTO pedidos (produto_id) VALUES ($1)', [produtoId]);

  res.status(201).json({ ok: true });
});

app.listen(3000, () => console.log('V1 (ingenua) em http://localhost:3000'));