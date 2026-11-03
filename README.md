# case-estoque

[![tests](https://github.com/Gustassis/case-estoque/actions/workflows/test.yml/badge.svg)](https://github.com/Gustassis/case-estoque/actions/workflows/test.yml)

**EN:** 300 simultaneous checkout requests for 1 item in stock. A naive checkout (read, check, decrement) versus a correct one (atomic conditional UPDATE, reservation with expiry, idempotent webhook, retry with backoff). Node + PostgreSQL, reproducible with one command, with automated tests.

**PT:** 300 requisições simultâneas de checkout para 1 item em estoque. Um checkout ingênuo (ler, conferir, decrementar) contra um checkout correto (UPDATE condicional atômico, reserva com expiração, webhook idempotente e retry com backoff). Node + PostgreSQL, reproduzível com um comando e com testes automatizados.

Author / Autor: Gustavo Assis ([user.dev.br](https://user.dev.br))

---

## English

### The problem

When many customers buy the last unit at the same moment, a checkout that reads the stock, checks it and then writes the new value can sell the same unit many times. This is a race condition. The result is overselling: money received for items that do not exist.

### Result (1 unit in stock, 300 simultaneous requests)

| Version | What it does | Orders accepted |
|---|---|---|
| V1 naive | Reads stock, checks it, writes `stock - 1` | Between 2 and 300 in the logged runs, never 1 |
| V2 correct | `UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock > 0` inside a transaction | Exactly 1, in every run |

Logged runs of the load test, V1 orders accepted for 1 item (300 requests sent each time, 0 client errors, 0 timeouts): 300, 300, 300, 290, 300, 3, 300, 300, 300, 2. V2 accepted exactly 1 in all of them. In every run, the number of 2xx responses reported by autocannon matched the number of rows in the `pedidos` table.

The size of the overselling changes from run to run. That is expected for a race condition: it depends on timing. What does not change is that V1 never sold only 1.

### How to run

Requirements: Node.js 22, Docker with Compose.

```
docker compose up -d
npm install
npm test
```

`npm test` starts each version on its own port, fires 300 simultaneous requests with autocannon, counts the orders in the database and asserts:

- V1 sold more than 1 unit (the bug exists).
- V2 sold exactly 1 unit.
- The payment webhook, fired 5 times with the same event id, has a single effect (paid and failed cases).

To reset the database by hand: `docker compose down -v` and then `docker compose up -d`.

### What each file does

| File | Role |
|---|---|
| `src/v1-ingenua.js` | Naive checkout: 3 separate queries (read, check, write) |
| `src/v2-correta.js` | Atomic conditional UPDATE and order insert in one transaction |
| `src/v3-reserva.js` | V2 plus reservation with expiry, expiry job and idempotent payment webhook |
| `src/retry.js`, `src/demo-retry.js` | Retry with exponential backoff and jitter, with a demo against a fake gateway |
| `db/init.sql` | Tables `produtos`, `pedidos`, `eventos_pagamento` and the test product |
| `test/` | Automated tests |

### Why V2 works

PostgreSQL runs in Read Committed by default. When two transactions try to update the same row, the second one waits for the first to finish and then re-evaluates the `WHERE` clause against the new version of the row. With `stock > 0` in the `WHERE`, only the first request finds stock. The others change 0 rows, and the number of changed rows tells the application that the sale did not happen. See the sources below.

### Reservation, webhook and retry (V3)

- **Reservation:** the order is created as `reservado` with an expiry time. The window is configurable with `RESERVA_SEGUNDOS` (default 600). A job runs every 5 seconds, marks expired reservations as `expirado` and returns the unit to stock.
- **Release only once:** every status change uses `WHERE status = 'reservado'`, so only the call that actually changes the row returns stock. The job and a failed-payment webhook cannot both return the same unit.
- **Idempotent webhook:** `POST /webhook/pagamento` stores the `evento_id` (primary key) with `ON CONFLICT DO NOTHING`, in the same transaction as the effect. A repeated event answers `{"duplicado":true}` and changes nothing.
- **Retry:** exponential backoff with additive jitter (up to 30%) and a maximum number of attempts. Retry is only safe because the receiving side is idempotent.

### Limits and known gaps

Read these before trusting the numbers outside this setup.

- **Single machine.** Windows 11, AMD Ryzen 7 3700U, 9.9 GB RAM, PostgreSQL 17 in Docker, one application instance. No multi-instance test was run. The conditional UPDATE relies on a database row lock, so it should hold with several instances, but this repository does not prove it.
- **Expiry job with several instances.** The job could run in parallel on several instances. The status guard keeps it safe, but a production design would use `FOR UPDATE SKIP LOCKED` or a scheduler. Not implemented here.
- **Payment approved after the reservation expired.** The webhook ignores it silently today. In production this needs a policy (refund, or reactivate if stock exists). Not implemented.
- **The webhook does not verify signatures.** Real gateways sign notifications. Not implemented in this fake gateway.
- **Retry is demonstrated separately.** It is not wired into the API calls.
- **The expiry flow was verified by hand,** not by an automated test.
- **V1 test is probabilistic.** The assertion is that V1 sells more than 1. It always did in the logged runs, but a run that sells exactly 1 would fail it.
- **One unexplained early observation.** In one early run, before the test logged requests sent, V1 recorded 301 orders for 300 requests. It did not repeat in the 10 later runs. A possible cause is test files running in parallel against the same database; they now run sequentially (`--test-concurrency=1`). This is a hypothesis, not a proven cause.
- **Latency is not compared.** Sample sizes are small, so no claim is made that V2 is faster. Only that the fix did not make the system slower.
- **Credentials in `docker-compose.yml` are for local testing only.** Never use them in production.

### Troubleshooting (Windows)

| Symptom | Cause and fix |
|---|---|
| `docker` not recognized | Install Docker Desktop (`winget install -e --id Docker.DockerDesktop`). The package `Docker.sbx` is a different product. |
| `failed to connect to the docker API` | The Docker engine is not running. Open Docker Desktop and wait for it to start. |
| "Virtual Machine Platform is not enabled" | Enable it in an administrator PowerShell, update WSL (`wsl --update`) and restart Windows. If it persists, check that other security software is not using its own virtualization. |
| `curl -X` fails in PowerShell | In PowerShell `curl` is an alias. Use `curl.exe` or the Command Prompt. |
| `Cannot POST` on a route that exists | An old Node process still holds the port. Run `taskkill /F /IM node.exe`, check that the port is free with `netstat -ano \| findstr :3000`, and start again. |
| `ECONNRESET` on the first request | Same cause: an orphan process. Stop servers with Ctrl+C instead of closing the window. |
| `npm install` ran in the wrong folder | npm installs where you are. Check the prompt shows `case-estoque`. |
| `npm test` shows the default "no test specified" | The editor change was not saved to disk. Check with `findstr /n "test" package.json`. |
| npm audit warnings after installing autocannon | They come from a development-only load-testing dependency. `npm audit fix` was deliberately not run, to keep the environment documented. |

### Sources

Official documentation:

- PostgreSQL, Transaction Isolation, Read Committed: https://www.postgresql.org/docs/16/transaction-iso.html (the waiting and `WHERE` re-evaluation behavior is described there). Note: there is a public discussion on the PostgreSQL docs list about how this passage reads for statements with subselects. The single-row `UPDATE` used here does not depend on that case.
- PostgreSQL, `INSERT ... ON CONFLICT`: https://www.postgresql.org/docs/current/sql-insert.html
- Mercado Pago, webhook notifications (the notification id is meant for idempotency control): https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/optional-notifications
- AWS Architecture Blog, Marc Brooker, "Exponential Backoff And Jitter": https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

Industry practice (engineering articles, not official documentation):

- Conditional UPDATE as a stock guard: https://hackernoon.com/mysql-race-conditions-fixing-the-last-item-problem
- Reservation versus immediate deduction, and releasing abandoned carts: https://dev.to/iqbal120708/preventing-overselling-with-stock-reservation-and-selectforupdate-in-django-3jam
- At-least-once webhook delivery and idempotent processing: https://hookdeck.com/webhooks/guides/webhook-delivery-guarantees.md

Not yet cited from the original source: Stripe webhook documentation.

### License

MIT.

---

## Português

### O problema

Quando muitos clientes compram a última unidade no mesmo instante, um checkout que lê o estoque, confere e depois grava o novo valor pode vender a mesma unidade várias vezes. É uma condição de corrida (race condition). O resultado é a venda duplicada (overselling): dinheiro recebido por itens que não existem.

### Resultado (1 unidade em estoque, 300 requisições simultâneas)

| Versão | O que faz | Pedidos aceitos |
|---|---|---|
| V1 ingênua | Lê o estoque, confere, grava `estoque - 1` | Entre 2 e 300 nas execuções registradas, nunca 1 |
| V2 correta | `UPDATE ... SET estoque = estoque - 1 WHERE id = ? AND estoque > 0` dentro de uma transação | Exatamente 1, em todas as execuções |

Execuções registradas do teste de carga, pedidos aceitos pela V1 para 1 item (300 requisições enviadas em cada, 0 erros de cliente, 0 timeouts): 300, 300, 300, 290, 300, 3, 300, 300, 300, 2. A V2 aceitou exatamente 1 em todas. Em todas as execuções, o número de respostas 2xx informado pelo autocannon foi igual ao número de linhas na tabela `pedidos`.

O tamanho da venda duplicada muda a cada execução. É o esperado em uma condição de corrida: depende do momento exato. O que não muda é que a V1 nunca vendeu apenas 1.

### Como rodar

Requisitos: Node.js 22, Docker com Compose.

```
docker compose up -d
npm install
npm test
```

O `npm test` sobe cada versão em uma porta própria, dispara 300 requisições simultâneas com autocannon, conta os pedidos no banco e verifica:

- A V1 vendeu mais de 1 unidade (o bug existe).
- A V2 vendeu exatamente 1 unidade.
- O webhook de pagamento, disparado 5 vezes com o mesmo id de evento, tem um único efeito (casos de pagamento aprovado e de falha).

Para zerar o banco manualmente: `docker compose down -v` e depois `docker compose up -d`.

### O que cada arquivo faz

| Arquivo | Função |
|---|---|
| `src/v1-ingenua.js` | Checkout ingênuo: 3 consultas separadas (ler, conferir, gravar) |
| `src/v2-correta.js` | UPDATE condicional atômico e inserção do pedido em uma transação |
| `src/v3-reserva.js` | V2 mais reserva com expiração, job de expiração e webhook de pagamento idempotente |
| `src/retry.js`, `src/demo-retry.js` | Retry com backoff exponencial e jitter, com demonstração contra um gateway fictício |
| `db/init.sql` | Tabelas `produtos`, `pedidos`, `eventos_pagamento` e o produto de teste |
| `test/` | Testes automatizados |

### Por que a V2 funciona

O PostgreSQL usa Read Committed por padrão. Quando duas transações tentam atualizar a mesma linha, a segunda espera a primeira terminar e reavalia o `WHERE` sobre a nova versão da linha. Com `estoque > 0` no `WHERE`, só a primeira requisição encontra estoque. As outras alteram 0 linhas, e o número de linhas alteradas avisa a aplicação de que a venda não aconteceu. Veja as fontes abaixo.

### Reserva, webhook e retry (V3)

- **Reserva:** o pedido nasce como `reservado` com prazo. A janela é configurável com `RESERVA_SEGUNDOS` (padrão 600). Um job roda a cada 5 segundos, marca reservas vencidas como `expirado` e devolve a unidade ao estoque.
- **Liberar só uma vez:** toda mudança de status usa `WHERE status = 'reservado'`, então só a chamada que de fato altera a linha devolve o estoque. O job e um webhook de pagamento falho não conseguem devolver a mesma unidade duas vezes.
- **Webhook idempotente:** `POST /webhook/pagamento` grava o `evento_id` (chave primária) com `ON CONFLICT DO NOTHING`, na mesma transação do efeito. Um evento repetido responde `{"duplicado":true}` e não muda nada.
- **Retry:** backoff exponencial com jitter aditivo (até 30%) e número máximo de tentativas. O retry só é seguro porque o lado que recebe é idempotente.

### Limites e lacunas conhecidas

Leia antes de confiar nos números fora deste cenário.

- **Uma única máquina.** Windows 11, AMD Ryzen 7 3700U, 9,9 GB de RAM, PostgreSQL 17 em Docker, uma instância da aplicação. Não houve teste com várias instâncias. O UPDATE condicional depende de trava de linha do banco, então deve se manter com várias instâncias, mas este repositório não prova isso.
- **Job de expiração com várias instâncias.** O job poderia rodar em paralelo em várias instâncias. A guarda de status o mantém seguro, mas um desenho de produção usaria `FOR UPDATE SKIP LOCKED` ou um agendador. Não implementado aqui.
- **Pagamento aprovado depois de a reserva expirar.** Hoje o webhook ignora em silêncio. Em produção isso exige uma política (reembolsar, ou reativar se houver estoque). Não implementado.
- **O webhook não verifica assinatura.** Gateways reais assinam as notificações. Não implementado neste gateway fictício.
- **O retry é demonstrado à parte.** Não está ligado às chamadas da API.
- **O fluxo de expiração foi verificado manualmente,** não por teste automatizado.
- **O teste da V1 é probabilístico.** A afirmação é que a V1 vende mais de 1. Sempre vendeu nas execuções registradas, mas uma execução que vendesse exatamente 1 o faria falhar.
- **Uma observação inicial sem explicação.** Em uma execução inicial, antes de o teste registrar as requisições enviadas, a V1 gravou 301 pedidos para 300 requisições. Não se repetiu nas 10 execuções seguintes. Uma causa possível é arquivos de teste rodando em paralelo contra o mesmo banco; hoje rodam em sequência (`--test-concurrency=1`). É hipótese, não causa provada.
- **A latência não é comparada.** As amostras são pequenas, então não se afirma que a V2 é mais rápida. Apenas que a correção não deixou o sistema mais lento.
- **As credenciais do `docker-compose.yml` são só para teste local.** Nunca use em produção.

### Solução de problemas (Windows)

| Sintoma | Causa e correção |
|---|---|
| `docker` não reconhecido | Instale o Docker Desktop (`winget install -e --id Docker.DockerDesktop`). O pacote `Docker.sbx` é outro produto. |
| `failed to connect to the docker API` | O motor do Docker não está rodando. Abra o Docker Desktop e espere iniciar. |
| "Virtual Machine Platform is not enabled" | Ative em um PowerShell de administrador, atualize o WSL (`wsl --update`) e reinicie o Windows. Se persistir, confira se outro software de segurança não usa virtualização própria. |
| `curl -X` falha no PowerShell | No PowerShell `curl` é um alias. Use `curl.exe` ou o Prompt de Comando. |
| `Cannot POST` em rota que existe | Um processo Node antigo ainda segura a porta. Rode `taskkill /F /IM node.exe`, confira que a porta está livre com `netstat -ano \| findstr :3000` e suba de novo. |
| `ECONNRESET` na primeira requisição | Mesma causa: processo órfão. Pare os servidores com Ctrl+C em vez de fechar a janela. |
| `npm install` rodou na pasta errada | O npm instala onde você está. Confira se o prompt mostra `case-estoque`. |
| `npm test` mostra o padrão "no test specified" | A alteração do editor não foi salva em disco. Confira com `findstr /n "test" package.json`. |
| Avisos do npm audit após instalar o autocannon | Vêm de uma dependência de teste de carga usada só em desenvolvimento. O `npm audit fix` não foi rodado de propósito, para manter o ambiente documentado. |

### Fontes

Documentação oficial:

- PostgreSQL, Transaction Isolation, Read Committed: https://www.postgresql.org/docs/16/transaction-iso.html (o comportamento de espera e reavaliação do `WHERE` está descrito lá). Nota: existe uma discussão pública na lista de documentação do PostgreSQL sobre como esse trecho é lido em comandos com subselect. O `UPDATE` de linha única usado aqui não depende desse caso.
- PostgreSQL, `INSERT ... ON CONFLICT`: https://www.postgresql.org/docs/current/sql-insert.html
- Mercado Pago, notificações por webhook (o id da notificação serve para controle de idempotência): https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/optional-notifications
- AWS Architecture Blog, Marc Brooker, "Exponential Backoff And Jitter": https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

Prática da indústria (artigos de engenharia, não documentação oficial):

- UPDATE condicional como guarda de estoque: https://hackernoon.com/mysql-race-conditions-fixing-the-last-item-problem
- Reserva versus baixa imediata e liberação de carrinhos abandonados: https://dev.to/iqbal120708/preventing-overselling-with-stock-reservation-and-selectforupdate-in-django-3jam
- Entrega "pelo menos uma vez" de webhooks e processamento idempotente: https://hookdeck.com/webhooks/guides/webhook-delivery-guarantees.md

Ainda não citada na fonte original: documentação de webhooks da Stripe.

### Licença

MIT.
