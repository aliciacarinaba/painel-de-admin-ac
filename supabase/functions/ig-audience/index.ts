// ============================================================
// ig-audience: analisa a audiência (comentários e posts do próprio perfil) e guarda o resultado em ig_audience ("main").
// Corre ao carregar em "Atualizar" no painel e 1 vez por semana (pg_cron, x-sched-key).
// Sem "Verify JWT": aceita x-sched-key (cron) OU a sessão de um utilizador autenticado.
// ============================================================
import { env, ig, sb, json, corsHeaders, GRAPH } from "../_shared/ig.ts";

const COMMENT_POSTS = 40;   // posts próprios em que se leem comentários
const COMMENT_PAGES = 2;    // páginas de 100 comentários por post

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function retry(path: string) {
  let r = await ig(path);
  for (let i = 1; i < 3 && !r.ok && r.status !== 400; i++) { await wait(500 * i); r = await ig(path); }
  return r;
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ---------- Texto ----------
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const has = (t: string, list: string[]) => list.some((k) => t.includes(k));

// Temas (o assunto de que se fala). Palavras já sem acentos e em minúsculas.
const TOPICS: Record<string, { label: string; kw: string[] }> = {
  preco: { label: "Preços e precificação", kw: ["preco", "precific", "cobrar", "cobro", "tabela de preco", "valor do meu", "quanto cobr", "caro", "barato", "aumentar os preco"] },
  financas: { label: "Gestão financeira", kw: ["financ", "dinheiro", "lucro", "custos", "contas", "faturar", "faturacao", "ganhar", "ganho", "rendimento", "excel", "imposto", "iva", "recibo", "atividade", "irs", "salario"] },
  tecnicas: { label: "Técnicas e nail art", kw: ["tecnica", "nail art", "babyboom", "baby boom", "ombre", "gel", "acrilico", "polygel", "esmalte", "verniz", "francesinha", "cutilas", "lixa", "molde", "tips", "alongamento", "nivelamento", "decoracao"] },
  saude: { label: "Saúde ungueal e anatomia", kw: ["anatomia", "saude ungueal", "alergia", "fungo", "micose", "unha encravada", "infec", "higiene", "esterili", "desinfe", "lesao", "dermatit"] },
  formacao: { label: "Formações e cursos", kw: ["formacao", "formacoes", "curso", "workshop", "aula", "mentoria", "certificad", "aprender", "inscri", "turma", "online"] },
  clientes: { label: "Clientes e fidelização", kw: ["cliente", "agenda", "marcacao", "marcacoes", "faltas", "desmarc", "fidelizar", "atendimento", "reclama"] },
  marketing: { label: "Marketing e redes sociais", kw: ["instagram", "reels", "story", "stories", "seguidores", "divulgar", "conteudo", "algoritmo", "marketing", "tiktok", "portfolio", "fotos"] },
  emocional: { label: "Emoções e bloqueios", kw: ["medo", "culpa", "inseguran", "impostor", "ansiedade", "stress", "frustr", "cansad", "esgotad", "desmotiv", "confianca", "autoestima", "motivacao"] },
  negocio: { label: "Negócio e espaço", kw: ["negocio", "salao", "estudio", "espaco", "alugar", "renda", "empreend", "profissionaliz", "organiz", "equipa", "conta propria", "casa"] },
  material: { label: "Material e produtos", kw: ["material", "produto", "marca de", "lampada", "fresa", "torno", "gel uv", "stock", "encomenda", "fornecedor"] },
  tempo: { label: "Tempo e produtividade", kw: ["tempo", "horas", "horario", "rapido", "rotina", "demora", "produtiv"] },
};

// Tipo de mensagem (o que a pessoa está a dizer)
const BUCKETS: Record<string, { label: string; test: (raw: string, t: string) => boolean }> = {
  duvidas: { label: "Dúvidas", test: (raw, t) => raw.includes("?") || /^(como|quanto|qual|quais|onde|quando|porque|porquê|por que|sera|posso|tens|ha |existe|que ?tipo)/.test(t) },
  dores: { label: "Dores", test: (_r, t) => has(t, ["nao sei", "dificuldade", "dificil", "medo", "nao consigo", "perder clientes", "nao fica nada", "perdida", "inseguran", "frustr", "cansad", "sem clientes", "nao tenho clientes", "sobrecarreg", "stress", "culpa", "nao ganho", "ganho pouco", "mal paga", "mal pago", "pouco dinheiro", "nao compensa"]) },
  objecoes: { label: "Objeções", test: (_r, t) => has(t, ["caro", "muito alto", "nao tenho dinheiro", "nao compensa", "vale a pena", "de graca", "gratis", "sem tempo", "nao tenho tempo", "nao sei se vou", "a minha zona", "aqui as pessoas nao", "retorno", "nao posso pagar", "nao tenho como", "fora do meu orcamento", "mais barato"]) },
  desejos: { label: "Desejos", test: (_r, t) => has(t, ["quero", "queria", "gostava", "gostaria", "sonho", "adorava", "objetivo", "preciso de", "espero", "vou conseguir", "viver de", "ter o meu", "abrir o meu", "um dia"]) },
  pedidos: { label: "Pedidos e palavras-chave", test: (_r, t) => (t.trim().split(/\s+/).length <= 2 && t.length <= 24) || has(t, ["info", "informac", "link", "interessad", "eu quero", "quero saber", "enviar", "manda", "envia", "detalhes", "preco da", "como me inscrevo", "inscri", "disponivel"]) },
};

const STOP = new Set(("a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sobre entre ate que se ou e mas ao aos à às é são foi ser ter tem tens tenho tinha ja nao nem mais menos muito muita muitos muitas isso isto esta este estas estes essa esse essas esses aqui ali la ca eu tu ele ela nos vos eles elas me te lhe lhes meu minha meus minhas teu tua teus tuas seu sua seus suas como quando onde porque pois ainda so também tambem então entao assim cada todo toda todos todas outro outra outros outras quem qual quais mesmo mesma tão tao vez vezes dia dias post video obrigada obrigado parabens lindo linda lindas lindos amei adorei top").split(" ").map(norm));

const tokens = (s: string) => (s.toLowerCase().match(/[a-zà-ÿ]{3,}/g) ?? []);

function topicsOf(t: string): string[] {
  return Object.entries(TOPICS).filter(([, v]) => has(t, v.kw)).map(([k]) => k);
}

const emojiRe = /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*/gu;

// Fuso de Portugal para dia da semana (0 = segunda) e hora
const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", weekday: "short", hour: "2-digit", hour12: false });
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function whenOf(ts: string) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { wd: WD[p.weekday] ?? 0, hour: parseInt(p.hour, 10) % 24 };
}

const top = <T extends string>(m: Map<T, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

// ---------- Perfil próprio ----------
function summarize(username: string, followers: number, mediaCount: number, posts: any[], own: boolean) {
  const eng = (p: any) => (p.like_count ?? 0) + (p.comments_count ?? 0);
  const dated = posts.filter((p) => p.timestamp);
  dated.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const span = dated.length > 1 ? (Date.parse(dated[0].timestamp) - Date.parse(dated[dated.length - 1].timestamp)) / 864e5 : 0;
  const formats: Record<string, { n: number; eng: number }> = {};
  const tags = new Map<string, number>();
  const topicEng: Record<string, { n: number; eng: number }> = {};
  const wdCell: number[][] = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0, 0]);   // soma de interação por (dia, bloco de 4h)
  const wdN: number[][] = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0, 0]);
  const avg = dated.length ? dated.reduce((s, p) => s + eng(p), 0) / dated.length : 0;
  const words = new Map<string, number>();
  for (const p of dated) {
    const cap = String(p.caption ?? "");
    const t = norm(cap);
    const f = p.media_type === "VIDEO" ? "Reel/Vídeo" : p.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : "Imagem";
    (formats[f] ??= { n: 0, eng: 0 }); formats[f].n++; formats[f].eng += eng(p);
    for (const h of cap.match(/#[\p{L}\d_]+/gu) ?? []) tags.set(h.toLowerCase(), (tags.get(h.toLowerCase()) ?? 0) + 1);
    for (const k of topicsOf(t)) { (topicEng[k] ??= { n: 0, eng: 0 }); topicEng[k].n++; topicEng[k].eng += eng(p); }
    const w = whenOf(p.timestamp);
    const cell = Math.floor(w.hour / 4);
    wdCell[w.wd][cell] += avg ? eng(p) / avg : 0; wdN[w.wd][cell]++;
    for (const tk of tokens(cap)) { const n = norm(tk); if (!STOP.has(n) && n.length > 3 && !tk.startsWith("#")) words.set(n, (words.get(n) ?? 0) + 1); }
  }
  const best = [...dated].sort((a, b) => eng(b) - eng(a)).slice(0, 6).map((p) => ({
    permalink: p.permalink, thumb: p.thumbnail_url || p.media_url || null, ts: p.timestamp, type: p.media_type,
    likes: p.like_count ?? 0, comments: p.comments_count ?? 0,
    caption: Array.from(String(p.caption ?? "")).slice(0, 110).join(""),
    topics: topicsOf(norm(String(p.caption ?? ""))).slice(0, 3),
  }));
  return {
    username, own, followers, media_count: mediaCount, posts_analyzed: dated.length,
    posts_per_week: span > 0 ? +(dated.length / (span / 7)).toFixed(1) : null,
    avg_likes: dated.length ? Math.round(dated.reduce((s, p) => s + (p.like_count ?? 0), 0) / dated.length) : 0,
    avg_comments: dated.length ? +(dated.reduce((s, p) => s + (p.comments_count ?? 0), 0) / dated.length).toFixed(1) : 0,
    eng_rate: followers && dated.length ? +((avg / followers) * 100).toFixed(2) : null,
    formats: Object.entries(formats).map(([k, v]) => ({ format: k, n: v.n, avg: Math.round(v.eng / v.n) })).sort((a, b) => b.avg - a.avg),
    hashtags: top(tags, 12).map(([tag, n]) => ({ tag, n })),
    topic_eng: Object.entries(topicEng).map(([k, v]) => ({ key: k, n: v.n, avg: Math.round(v.eng / v.n), rate: followers ? +((v.eng / v.n / followers) * 100).toFixed(2) : null })),
    words: top(words, 25).map(([w, n]) => ({ w, n })),
    heat: wdCell.map((row, d) => row.map((v, c) => (wdN[d][c] ? +(v / wdN[d][c]).toFixed(2) : null))),
    heat_n: wdN,
    best,
  };
}

// ---------- Autorização ----------
async function authorized(req: Request) {
  const key = req.headers.get("x-sched-key");
  if (key && env("SCHED_SECRET") && key === env("SCHED_SECRET")) return true;
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!tok) return false;
  const { data, error } = await sb.auth.getUser(tok);
  return !error && !!data?.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await authorized(req))) return json({ error: "não autorizado" }, 401);
  const id = env("IG_ACCOUNT_ID");
  if (!env("IG_ACCESS_TOKEN") || !id) return json({ error: "Instagram não configurado" });

  try {
    const body = await req.json().catch(() => ({}));

    // 1) Perfil próprio e posts
    const me = await retry(`/${id}?fields=username,followers_count,media_count`);
    if (!me.ok) return json({ error: me.data?.error?.message ?? "Erro ao ler o Instagram" });
    const ownUser = String(me.data.username ?? "").toLowerCase();
    const media = await retry(`/${id}/media?fields=id,caption,like_count,comments_count,timestamp,media_type,permalink,media_url,thumbnail_url&limit=50`);
    const ownPosts: any[] = media.ok ? media.data?.data ?? [] : [];

    // 2) Comentários da audiência (texto)
    const texts: { t: string; raw: string; ts: string }[] = [];
    const withComments = ownPosts.slice(0, COMMENT_POSTS).filter((p) => (p.comments_count ?? 0) > 0);
    await pool(withComments, 6, async (p) => {
      let url: string | null = `${GRAPH}/${p.id}/comments?fields=text,from%7Busername%7D,username,timestamp,replies%7Btext,from%7Busername%7D,username,timestamp%7D&limit=100`;
      for (let page = 0; page < COMMENT_PAGES && url; page++) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${env("IG_ACCESS_TOKEN")}` } });
        const j: any = await res.json().catch(() => ({}));
        if (!res.ok) break;
        const add = (c: any, nested: boolean) => {
          const who = String(c.from?.username ?? c.username ?? "").toLowerCase();
          const raw = String(c.text ?? "").trim();
          if (!raw || who === ownUser) return;
          if (nested && !who) return;   // resposta sem autor identificado: pode ser a resposta automática da própria conta
          texts.push({ raw, t: norm(raw.replace(/@[\w.]+/g, " ")).trim(), ts: c.timestamp ?? "" });
        };
        for (const c of j.data ?? []) { add(c, false); for (const r of c.replies?.data ?? []) add(r, true); }
        url = j.paging?.next ?? null;
      }
    });

    // 3) Classificação dos comentários
    const bucketRes: Record<string, any> = {};
    const topicTotals = new Map<string, number>();
    const words = new Map<string, number>();
    const phrases = new Map<string, number>();
    const emojis = new Map<string, number>();
    const lens: number[] = [];
    // Textos longos repetidos 4+ vezes são mensagens-modelo (ex.: respostas automáticas): não representam a audiência
    const freq = new Map<string, number>();
    for (const x of texts) freq.set(x.t, (freq.get(x.t) ?? 0) + 1);
    const meaningful = texts.filter((x) => x.t.replace(/[^a-z]/g, "").length >= 4 && !(x.t.length >= 20 && (freq.get(x.t) ?? 0) >= 4));   // ignora "👏" e "❤️"
    const kwFreq = new Map<string, number>();   // comentários curtos = palavras-chave de campanha (ex.: DESAFIO, TURMA)
    for (const x of meaningful) if (x.t.trim().split(/\s+/).length <= 2 && x.t.length <= 24) { const k = x.t.replace(/[^a-z0-9 ]/g, "").trim(); if (k) kwFreq.set(k, (kwFreq.get(k) ?? 0) + 1); }
    for (const [k, b] of Object.entries(BUCKETS)) bucketRes[k] = { label: b.label, count: 0, topics: new Map<string, number>(), samples: [] as string[] };
    for (const x of texts) for (const e of x.raw.match(emojiRe) ?? []) emojis.set(e, (emojis.get(e) ?? 0) + 1);
    for (const x of meaningful) {
      lens.push(x.raw.length);
      const tp = topicsOf(x.t);
      for (const k of tp) topicTotals.set(k, (topicTotals.get(k) ?? 0) + 1);
      for (const [k, b] of Object.entries(BUCKETS)) {
        if (!b.test(x.raw, x.t)) continue;
        const r = bucketRes[k]; r.count++;
        for (const tk of tp) r.topics.set(tk, (r.topics.get(tk) ?? 0) + 1);
        if (r.samples.length < 8 && x.raw.length >= 15 && x.raw.length <= 220) r.samples.push(x.raw);
      }
      const ws = tokens(x.raw).map(norm).filter((w) => !STOP.has(w) && w.length > 3);
      for (const w of ws) words.set(w, (words.get(w) ?? 0) + 1);
      const rawWords = tokens(x.raw).map(norm);
      for (let i = 0; i + 1 < rawWords.length; i++) {
        const a = rawWords[i], b = rawWords[i + 1];
        if (STOP.has(a) && STOP.has(b)) continue;
        if (a.length < 3 || b.length < 3) continue;
        const ph = `${a} ${b}`; phrases.set(ph, (phrases.get(ph) ?? 0) + 1);
      }
    }
    const total = meaningful.length;
    const audience = {
      comments_total: texts.length, comments_analyzed: total,
      avg_length: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0,
      buckets: Object.fromEntries(Object.entries(bucketRes).map(([k, r]: any) => [k, {
        label: r.label, count: r.count, share: total ? +((r.count / total) * 100).toFixed(1) : 0,
        topics: top(r.topics as Map<string, number>, 6).map(([key, n]) => ({ key, n })), samples: r.samples,
      }])),
      topics: top(topicTotals, 11).map(([key, n]) => ({ key, n })),
      words: top(words, 40).map(([w, n]) => ({ w, n })),
      phrases: top(new Map([...phrases].filter(([, n]) => n >= 2)), 15).map(([p, n]) => ({ p, n })),
      emojis: top(emojis, 12).map(([e, n]) => ({ e, n })),
      keywords: top(kwFreq, 10).filter(([, n]) => n >= 2).map(([k, n]) => ({ k, n })),
    };

    // 4) Perfil próprio
    const profiles: any[] = [summarize(ownUser, me.data.followers_count ?? 0, me.data.media_count ?? 0, ownPosts, true)];

    // 5) Temas: interação média (taxa) por tema nos teus posts
    const lab = Object.fromEntries(Object.entries(TOPICS).map(([k, v]) => [k, v.label]));
    const topics_eng = profiles[0].topic_eng.filter((t: any) => t.rate != null)
      .map((t: any) => ({ key: t.key, label: lab[t.key], own: t.rate, posts: t.n }))
      .sort((x: any, y: any) => y.own - x.own);

    // 6) Mapa de calor global (índice de interação relativo à média de cada perfil)
    const heat: (number | null)[][] = Array.from({ length: 7 }, (_, d) => Array.from({ length: 6 }, (_, c) => {
      const vals = profiles.map((p) => p.heat[d][c]).filter((v: number | null) => v != null) as number[];
      return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
    }));

    const out = {
      generated_at: new Date().toISOString(),
      topic_labels: lab,
      sources: { own_posts: ownPosts.length, comments_read: texts.length },
      audience, profiles, topics_eng, heat,
    };
    const updated_at = new Date().toISOString();
    const { error: saveError } = await sb.from("ig_audience").upsert({ id: "main", data: out, updated_at });
    if (saveError) return json({ error: "Não foi possível guardar a análise: " + saveError.message });
    return json(body?.light ? { ok: true, updated_at } : { data: out, updated_at });
  } catch (e) {
    return json({ error: String(e).slice(0, 300) });
  }
});
