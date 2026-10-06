# Painel de Administração + Automação de DM do Instagram

Painel web com início de sessão e um motor de automação de direct do Instagram (estilo
ManyChat), com backend no Supabase. Este projeto é um template genérico: não tem dados de
conta nenhuma. Os dados do Meta entram como variáveis de ambiente.

## Estrutura

```
index.html, styles.css, app.js      Painel (frontend, JS puro)
supabase/schema.sql                 Tabelas, travão de envio e RLS
supabase/cron.sql                   Agendamento (pg_cron + pg_net)
supabase/functions/_shared/         Código partilhado das funções
supabase/functions/instagram-webhook   O cérebro (público)
supabase/functions/ig-scheduler        Esvazia a fila (1 min)
supabase/functions/ig-token-refresh    Renova o token (semanal)
supabase/functions/ig-insights         Métricas em direto (já não usada pelo painel)
supabase/functions/ig-media            Posts
supabase/functions/ig-analysis         Métricas do painel (alcance, posts, quem mais comenta)
```

## Passo 0: testar já, sem configurar nada

```bash
python3 -m http.server 5173
```

Abre http://localhost:5173, escreve qualquer e-mail e uma palavra-passe de 5 dígitos (ex:
12345) e navega o sistema todo: Início, Calendário e Instagram (Métricas, Automações, editor
e pré-visualização em direto). Sem Supabase não é possível guardar automações; os restantes
ecrãs mostram estados vazios.

Os passos seguintes servem para colocar no ar de verdade.

## Passo a passo

1. **Supabase:** cria um projeto em supabase.com. No SQL Editor, cola e corre
   `supabase/schema.sql` (tabelas, travão, RLS). Sem as funções do travão nenhuma DM por
   comentário sai.
2. **Utilizador admin:** em Authentication > Users, cria o utilizador (e-mail e
   palavra-passe). É este login que vale quando o site estiver no ar. Não há registo público.
3. **Segredos das Edge Functions:** (ver tabela abaixo)
   ```bash
   supabase secrets set IG_ACCESS_TOKEN=SEU_VALOR_AQUI IG_ACCOUNT_ID=SEU_VALOR_AQUI \
     APP_SECRET=SEU_VALOR_AQUI APP_SECRET_ENFORCE=false VERIFY_TOKEN=SEU_VALOR_AQUI \
     GRAPH_API_VERSION=v21.0 SCHED_SECRET=SEU_VALOR_AQUI TEST_IG_ACCOUNTS=SEU_VALOR_AQUI
   ```
   (`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente nas funções.)
4. **Publicar as funções.** A `instagram-webhook` tem de ser PÚBLICA:
   ```bash
   supabase functions deploy instagram-webhook --no-verify-jwt
   supabase functions deploy ig-scheduler --no-verify-jwt
   supabase functions deploy ig-token-refresh --no-verify-jwt
   supabase functions deploy ig-insights
   supabase functions deploy ig-media
   supabase functions deploy ig-analysis
   ```
   (`ig-scheduler` e `ig-token-refresh` ficam protegidas pelo `SCHED_SECRET`.)
5. **Agendar os robôs:** edita `supabase/cron.sql` (troca `SEU_PROJETO` e
   `SEU_SCHED_SECRET_AQUI`) e corre no SQL Editor.
6. **Meta for Developers:** cria a app (Instagram API with Instagram Login), liga a conta
   profissional, liberta as permissões (ler comentários, ler e enviar mensagens) e obtém o
   token long-lived e o id da conta.
7. **Webhook no Meta:** URL da função `instagram-webhook`, o teu `VERIFY_TOKEN`, e
   SUBSCREVE os campos `comments`, `messages` e `messaging_postbacks`. Os três: o
   `messaging_postbacks` é o que faz os botões da conversa funcionarem.
8. **Frontend:** em `app.js`, preenche `SUPABASE_URL` e `SUPABASE_ANON_KEY` (a chave anónima
   pode ser pública, nunca uses a service_role). Publica a pasta num host estático (ex:
   GitHub Pages).
9. **Testar** com uma SEGUNDA conta (a própria é ignorada de propósito), a comentar a
   palavra-chave. Para testares várias vezes seguidas, mete o id dessa conta em
   `TEST_IG_ACCOUNTS`.
10. Quando tudo funcionar, liga a trava da assinatura: `APP_SECRET_ENFORCE=true`.

## Variáveis de ambiente (checklist)

| Variável | Onde | O que é |
|---|---|---|
| `SUPABASE_URL` | frontend (`app.js`) | URL do projeto |
| `SUPABASE_ANON_KEY` | frontend (`app.js`) | chave anónima |
| `IG_ACCESS_TOKEN` | segredo | token long-lived do Instagram |
| `IG_ACCOUNT_ID` | segredo | id numérico da conta |
| `APP_SECRET` | segredo | segredo da app do Meta (assinatura) |
| `APP_SECRET_ENFORCE` | segredo | `false` no início, `true` depois de testar |
| `VERIFY_TOKEN` | segredo | palavra-passe que inventas (aperto de mão do webhook) |
| `GRAPH_API_VERSION` | segredo | ex: `v21.0` |
| `SCHED_SECRET` | segredo | palavra-passe que inventas (protege os robôs) |
| `TEST_IG_ACCOUNTS` | segredo | ids das contas de teste (ignoram a regra do 1 por dia) |
| `SUPABASE_SERVICE_ROLE_KEY` | segredo | chave service_role (automática nas funções) |

## Regras e limites (para não apanhar bloqueio)

- Opt-in sempre: o sistema só responde a quem comentou.
- Regra do "1 por dia": 1 DM por pessoa a cada 24h em gatilho de comentário (contas de
  teste ignoram).
- Travão de envio: 6 por minuto, 60 por hora, 180 por dia (ajustáveis em `ig_send_budget`),
  retém na fila e pausa 3 horas se der bloqueio.
- Janela de 24h da Meta: fora de uma interação recente não dá para enviar DM. O comentário e
  o toque no botão abrem a janela.
- O token expira em cerca de 60 dias (a renovação semanal trata disso).
- Título de botão: 20 caracteres. Máximo de 3 botões por mensagem no formato anexado.
  Resposta a comentário só vale cerca de 7 dias. A base de dados devolve no máximo 1000
  linhas por pedido (pagina nas tabelas que crescem).
- Nada de spam nem listas compradas.
