// ============================================================
// ig-token-refresh: renova o token long-lived (cerca de 60 dias).
// Corre via pg_cron 1 vez por semana. Protegido por x-sched-key = SCHED_SECRET.
// ============================================================
import { env, sb, json } from "../_shared/ig.ts";

Deno.serve(async (req) => {
  if (!env("SCHED_SECRET") || req.headers.get("x-sched-key") !== env("SCHED_SECRET")) return json({ error: "não autorizado" }, 401);

  // ATENÇÃO: este endpoint NÃO leva a versão no caminho (ao contrário das outras chamadas)
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${env("IG_ACCESS_TOKEN")}`;
  const now = new Date().toISOString();
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.access_token) throw new Error(JSON.stringify(data?.error ?? data));
    const expires = new Date(Date.now() + (data.expires_in ?? 5184000) * 1000).toISOString();
    await sb.from("ig_token_status").upsert({ id: "main", expires_at: expires, last_ok: true, last_error: null, last_refreshed_at: now, updated_at: now });
    return json({ ok: true, expires_at: expires });
  } catch (e) {
    await sb.from("ig_token_status").upsert({ id: "main", last_ok: false, last_error: String(e).slice(0, 300), updated_at: now });
    return json({ ok: false, error: String(e) }, 500);
  }
});
