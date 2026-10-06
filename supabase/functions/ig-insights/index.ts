// ============================================================
// ig-insights: métricas para o dashboard (seguidores, novos seguidores/dia, alcance/dia).
// Chamada pelo painel (com o utilizador autenticado), por isso mantém o "Verify JWT" ligado.
// ============================================================
import { env, ig, json, corsHeaders } from "../_shared/ig.ts";

const DAYS = 15;        // gráficos diários
const REACH_DAYS = 30;  // cartão de alcance total

// Converte a resposta de insights numa lista { date (AAAA-MM-DD), value }
const series = (resp: any) =>
  (resp?.data?.[0]?.values ?? []).map((v: any) => ({ date: String(v.end_time ?? "").slice(0, 10), value: v.value ?? 0 }));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!env("IG_ACCESS_TOKEN") || !env("IG_ACCOUNT_ID")) return json({ error: "Instagram não configurado" });

  const until = Math.floor(Date.now() / 1000);
  const since = until - DAYS * 86400;
  const id = env("IG_ACCOUNT_ID");

  const since30 = until - REACH_DAYS * 86400;

  const [me, follows, reach, reachTotal] = await Promise.all([
    ig(`/${id}?fields=followers_count`),
    ig(`/${id}/insights?metric=follower_count&period=day&since=${since}&until=${until}`),
    ig(`/${id}/insights?metric=reach&period=day&since=${since}&until=${until}`),
    // Total de contas alcançadas (cada conta conta uma só vez; somar os dias contaria repetidas)
    ig(`/${id}/insights?metric=reach&metric_type=total_value&period=day&since=${since30}&until=${until}`),
  ]);
  if (!me.ok) return json({ error: me.data?.error?.message ?? "Erro ao ler o Instagram" });

  return json({
    followers: me.data.followers_count ?? 0,
    followers_by_day: follows.ok ? series(follows.data) : [],
    reach_by_day: reach.ok ? series(reach.data) : [],
    reach_30d: reachTotal.ok ? (reachTotal.data?.data?.[0]?.total_value?.value ?? null) : null,
  });
});
