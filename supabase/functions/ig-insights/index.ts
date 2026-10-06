// ============================================================
// ig-insights: métricas para o dashboard (seguidores, novos seguidores/dia, alcance/dia).
// Chamada pelo painel (com o utilizador autenticado), por isso mantém o "Verify JWT" ligado.
// ============================================================
import { env, ig, json, corsHeaders } from "../_shared/ig.ts";

const DAYS = 15;

// Converte a resposta de insights numa lista { date, value }
const series = (resp: any) =>
  (resp?.data?.[0]?.values ?? []).map((v: any) => ({ date: String(v.end_time ?? "").slice(5, 10), value: v.value ?? 0 }));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!env("IG_ACCESS_TOKEN") || !env("IG_ACCOUNT_ID")) return json({ error: "Instagram não configurado" });

  const until = Math.floor(Date.now() / 1000);
  const since = until - DAYS * 86400;
  const id = env("IG_ACCOUNT_ID");

  const [me, follows, reach] = await Promise.all([
    ig(`/${id}?fields=followers_count`),
    ig(`/${id}/insights?metric=follower_count&period=day&since=${since}&until=${until}`),
    ig(`/${id}/insights?metric=reach&period=day&since=${since}&until=${until}`),
  ]);
  if (!me.ok) return json({ error: me.data?.error?.message ?? "Erro ao ler o Instagram" });

  return json({
    followers: me.data.followers_count ?? 0,
    followers_by_day: follows.ok ? series(follows.data) : [],
    reach_by_day: reach.ok ? series(reach.data) : [],
  });
});
