CREATE TABLE pedidos (
  id SERIAL PRIMARY KEY,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  status TEXT NOT NULL DEFAULT 'reservado',
  expira_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE eventos_pagamento (
  evento_id TEXT PRIMARY KEY,
  pedido_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT now()
);