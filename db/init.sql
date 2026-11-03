CREATE TABLE produtos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  estoque INTEGER NOT NULL
);

CREATE TABLE pedidos (
  id SERIAL PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  status TEXT NOT NULL DEFAULT 'criado',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO produtos (nome, estoque) VALUES ('Camiseta Edição Limitada', 1);