// ============================================================
// ig-media: lista os posts da conta (com miniatura) para o seletor "Em que posts"
// e para mostrar a foto do post ligado a cada automação.
// Pode receber { ids: [...] } para garantir que esses posts vêm incluídos,
// mesmo que já não estejam entre os mais recentes.
// Mantém o "Verify JWT" ligado (é chamada pelo painel com sessão iniciada).
// ============================================================
import { env, ig, json, corsHeaders } from "../_shared/ig.ts";

const FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!env("IG_ACCESS_TOKEN") || !env("IG_ACCOUNT_ID")) return json({ posts: [], error: "Instagram não configurado" });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = (Array.isArray(body?.ids) ? body.ids : []).map(String).filter((i: string) => /^\d+$/.test(i)).slice(0, 30);

  const limit = Math.min(Math.max(Number(body?.limit) || 30, 1), 100);
  const [list, ...extra] = await Promise.all([
    ig(`/${env("IG_ACCOUNT_ID")}/media?fields=${FIELDS}&limit=${limit}`),
    ...ids.map((id) => ig(`/${id}?fields=${FIELDS}`)),
  ]);
  if (!list.ok) return json({ posts: [], error: list.data?.error?.message ?? "Erro ao ler os posts" });

  // Junta os posts pedidos que não estavam na lista dos mais recentes
  const posts: any[] = list.data.data ?? [];
  const seen = new Set(posts.map((p) => p.id));
  for (const r of extra) if (r.ok && r.data?.id && !seen.has(r.data.id)) { posts.push(r.data); seen.add(r.data.id); }
  return json({ posts });
});
