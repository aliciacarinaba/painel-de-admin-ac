// ============================================================
// ig-analysis: calcula a "Análise" do Instagram e guarda o resultado na tabela ig_analysis.
// Só corre quando se carrega em "Atualizar" no painel (muitas chamadas à API).
// Mantém o "Verify JWT" ligado (é chamada pelo painel com sessão iniciada).
// ============================================================
import { env, ig, sb, json, corsHeaders, GRAPH } from "../_shared/ig.ts";

const DAY = 86400;
const MEDIA_FIELDS = "id,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,caption";
const MAX_POSTS = 100;          // posts analisados (os mais recentes)
const COMMENT_POSTS = 60;       // posts em que se contam os comentários
const COMMENT_PAGES = 3;        // páginas de 100 comentários por post

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A API do Instagram falha às vezes com "unexpected error": tenta mais duas vezes
async function retry(path: string) {
  let r = await ig(path);
  for (let i = 1; i < 3 && !r.ok; i++) { await wait(500 * i); r = await ig(path); }
  return r;
}

// Executa tarefas em paralelo, n de cada vez
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const id = env("IG_ACCOUNT_ID");
  if (!env("IG_ACCESS_TOKEN") || !id) return json({ error: "Instagram não configurado" });

  try {
    const until = Math.floor(Date.now() / 1000);

    // 1) Conta
    const me = await retry(`/${id}?fields=username,followers_count`);
    if (!me.ok) return json({ error: me.data?.error?.message ?? "Erro ao ler o Instagram" });
    const ownUser = String(me.data.username ?? "").toLowerCase();

    // 2) Totais por janela (7 e 30 dias): cada conta conta uma só vez
    const total = async (metric: string, days: number) => {
      const r = await retry(`/${id}/insights?metric=${metric}&metric_type=total_value&period=day&since=${until - days * DAY}&until=${until}`);
      return r.ok ? (r.data?.data?.[0]?.total_value?.value ?? null) : null;
    };
    const follows = await retry(`/${id}/insights?metric=follower_count&period=day&since=${until - 30 * DAY}&until=${until}`);
    const fvals: any[] = follows.ok ? follows.data?.data?.[0]?.values ?? [] : [];
    const fv: number[] = fvals.map((v: any) => v.value ?? 0);
    // Novos seguidores por dia (a API só devolve os últimos 30 dias)
    const followers_by_day = fvals.map((v: any) => ({ date: String(v.end_time).slice(0, 10), value: v.value ?? 0 }));
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

    const windows: Record<string, any> = {};
    for (const days of [7, 30]) {
      const [reach, engaged, interactions] = await Promise.all([total("reach", days), total("accounts_engaged", days), total("total_interactions", days)]);
      windows[days] = { reach, engaged, interactions, new_followers: fv.length ? sum(fv.slice(-days)) : null };
    }

    // 3) Alcance por dia: ~1 ano em blocos de 90 dias
    const byDate = new Map<string, number>();
    const chunks = await Promise.all([0, 1, 2, 3].map((i) =>
      retry(`/${id}/insights?metric=reach&period=day&since=${until - (i + 1) * 90 * DAY}&until=${until - i * 90 * DAY}`)));
    for (const c of chunks) for (const v of (c.ok ? c.data?.data?.[0]?.values ?? [] : [])) byDate.set(String(v.end_time).slice(0, 10), v.value ?? 0);
    const reach_daily = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));

    // 4) Posts (mais recentes) e as suas métricas
    const media = await retry(`/${id}/media?fields=${MEDIA_FIELDS}&limit=${MAX_POSTS}`);
    const rawPosts: any[] = media.ok ? media.data?.data ?? [] : [];
    const posts = await pool(rawPosts, 10, async (p) => {
      const ins = await ig(`/${p.id}/insights?metric=reach,saved,shares,views,total_interactions`);
      const m: Record<string, number> = {};
      if (ins.ok) for (const x of ins.data?.data ?? []) m[x.name] = x.values?.[0]?.value ?? 0;
      const likes = p.like_count ?? 0, comments = p.comments_count ?? 0, saves = m.saved ?? 0, shares = m.shares ?? 0;
      return {
        id: p.id, type: p.media_type, permalink: p.permalink, ts: p.timestamp,
        thumb: p.thumbnail_url || p.media_url || null, caption: Array.from(String(p.caption ?? "")).slice(0, 100).join(""), // por caracteres inteiros (não corta emojis ao meio)
        likes, comments, saves, shares, views: m.views ?? 0, reach: m.reach ?? 0,
        interactions: likes + comments + saves + shares,
      };
    });

    // 5) Quem mais comenta: comentários + respostas nos posts mais recentes
    const who = new Map<string, { count: number; last: string }>();
    let commentsAnalyzed = 0;
    const count = (user?: string, ts?: string) => {
      commentsAnalyzed++;
      if (!user || user.toLowerCase() === ownUser) return;
      const cur = who.get(user) ?? { count: 0, last: "" };
      cur.count++; if (ts && ts > cur.last) cur.last = ts;
      who.set(user, cur);
    };
    const withComments = rawPosts.slice(0, COMMENT_POSTS).filter((p) => (p.comments_count ?? 0) > 0);
    await pool(withComments, 6, async (p) => {
      let url: string | null = `${GRAPH}/${p.id}/comments?fields=username,from%7Busername%7D,timestamp,replies%7Busername,from%7Busername%7D,timestamp%7D&limit=100`;
      for (let page = 0; page < COMMENT_PAGES && url; page++) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${env("IG_ACCESS_TOKEN")}` } });
        const j: any = await res.json().catch(() => ({}));
        if (!res.ok) break;
        for (const c of j.data ?? []) {
          // O nome vem em "from" (o campo "username" só aparece nos comentários da própria conta)
          count(c.from?.username ?? c.username, c.timestamp);
          for (const r of c.replies?.data ?? []) count(r.from?.username ?? r.username, r.timestamp);
        }
        url = j.paging?.next ?? null;
      }
    });
    const commenters = [...who.entries()].map(([username, v]) => ({ username, count: v.count, last: v.last }))
      .sort((a, b) => b.count - a.count).slice(0, 20);

    const data = {
      generated_at: new Date().toISOString(),
      followers: me.data.followers_count ?? 0,
      windows, followers_by_day, reach_daily, posts, commenters,
      stats: { posts_analyzed: posts.length, comments_analyzed: commentsAnalyzed },
    };
    const updated_at = new Date().toISOString();
    // Guarda o resultado (e avisa se a gravação falhar, em vez de a ignorar em silêncio)
    const { error: saveError } = await sb.from("ig_analysis").upsert({ id: "main", data, updated_at });
    if (saveError) return json({ error: "Não foi possível guardar a análise: " + saveError.message });
    return json({ data, updated_at });
  } catch (e) {
    return json({ error: String(e).slice(0, 300) });
  }
});
