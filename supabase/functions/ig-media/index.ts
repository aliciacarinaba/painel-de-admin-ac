// ============================================================
// ig-media: lista os posts da conta (com miniatura) para o seletor "Em que posts".
// Mantém o "Verify JWT" ligado (é chamada pelo painel com sessão iniciada).
// ============================================================
import { env, ig, json, corsHeaders } from "../_shared/ig.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!env("IG_ACCESS_TOKEN") || !env("IG_ACCOUNT_ID")) return json({ posts: [], error: "Instagram não configurado" });

  const r = await ig(`/${env("IG_ACCOUNT_ID")}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=30`);
  if (!r.ok) return json({ posts: [], error: r.data?.error?.message ?? "Erro ao ler os posts" });
  return json({ posts: r.data.data ?? [] });
});
