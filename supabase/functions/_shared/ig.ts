// ============================================================
// Funções partilhadas pelas Edge Functions (cliente do banco, envio de DMs, travão)
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const env = (k: string, d = "") => Deno.env.get(k) ?? d;

// Cliente com a chave service_role (ignora o RLS). NUNCA vai para o frontend.
export const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

export const GRAPH = `https://graph.instagram.com/${env("GRAPH_API_VERSION", "v21.0")}`;
const TOKEN = () => env("IG_ACCESS_TOKEN");
export const BUDGET_KEY = "private_reply";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Chamada à Graph API (POST ou GET)
export async function ig(path: string, opts: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    method: opts.method ?? "GET",
    headers: { Authorization: `Bearer ${TOKEN()}`, "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* resposta vazia */ }
  return { ok: res.ok, status: res.status, data };
}

// Falha "dura" = bloqueio / limite (pausa o disjuntor mais depressa)
const isHard = (r: { status: number; data: any }) =>
  r.status === 429 || [4, 17, 32, 613, 368].includes(r.data?.error?.code);

// ---------- Travão ----------
export async function takeSlot(): Promise<boolean> {
  const { data, error } = await sb.rpc("take_send_slot", { p_key: BUDGET_KEY });
  if (error) { console.error("take_send_slot falhou (o SQL do travão foi corrido?)", error.message); return false; }
  return data === true;
}
export async function recordResult(ok: boolean, hard: boolean) {
  await sb.rpc("record_send_result", { p_key: BUDGET_KEY, p_ok: ok, p_hard: hard });
}

// ---------- Eventos duplicados ----------
// Devolve true se o id já tinha sido processado.
export async function alreadySeen(id: string): Promise<boolean> {
  const { error } = await sb.from("ig_events_seen").insert({ id });
  return !!error; // violação de chave única = já visto
}

// ---------- Envio ----------
type Recipient = { id: string } | { comment_id: string };

async function sendRaw(recipient: Recipient, message: unknown) {
  const r = await ig(`/${env("IG_ACCOUNT_ID")}/messages`, { method: "POST", body: { recipient, message } });
  const mid = r.data?.message_id;
  if (r.ok && mid) await sb.from("ig_bot_sends").upsert({ mid }); // para ignorar o echo
  return r;
}

// Monta os botões ANEXADOS (button template). Botão sem destino é descartado.
function buildButtons(step: any, autoId: string) {
  return (step.buttons ?? [])
    .filter((b: any) => b.title && (b.url || b.next != null))
    .map((b: any) => b.url
      ? { type: "web_url", url: b.url, title: String(b.title).slice(0, 20) }
      : { type: "postback", title: String(b.title).slice(0, 20), payload: `STEP:${autoId}:${b.next}` });
}

// Envia um passo do fluxo. Tenta: button template, depois quick_reply, depois texto puro.
export async function sendStep(recipient: Recipient, auto: any, step: any) {
  const text = String(step.message ?? "").slice(0, 640);
  const buttons = buildButtons(step, auto.id);
  let last: { ok: boolean; status: number; data: any } | null = null;

  if (!buttons.length) {
    last = await sendRaw(recipient, { text });
  } else {
    // 1) Botões anexados à mensagem (máximo 3 neste formato)
    last = await sendRaw(recipient, {
      attachment: { type: "template", payload: { template_type: "button", text, buttons: buttons.slice(0, 3) } },
    });
    // 2) Fallback: quick_reply (só os botões que avançam; links vão no texto)
    if (!last.ok) {
      const links = buttons.filter((b: any) => b.type === "web_url").map((b: any) => b.url);
      const quick = buttons.filter((b: any) => b.type === "postback")
        .slice(0, 13).map((b: any) => ({ content_type: "text", title: b.title, payload: b.payload }));
      const fullText = [text, ...links].join("\n\n").slice(0, 1000);
      last = quick.length
        ? await sendRaw(recipient, { text: fullText, quick_replies: quick })
        : await sendRaw(recipient, { text: fullText });
      // 3) Último recurso: texto puro, com o link no texto
      if (!last.ok) last = await sendRaw(recipient, { text: [text, ...links].join("\n\n").slice(0, 1000) });
    }
  }

  if (last.ok) await sendAssets(recipient, step.assets ?? []);
  return { ok: last.ok, hard: !last.ok && isHard(last), error: last.ok ? "" : JSON.stringify(last.data?.error ?? last.data).slice(0, 300) };
}

// Envia os ficheiros (PDF, áudio, foto, vídeo) de um passo
async function sendAssets(recipient: Recipient, ids: string[]) {
  if (!ids.length) return;
  const { data } = await sb.from("ig_assets").select("*").in("id", ids);
  for (const a of data ?? []) {
    const type = ["image", "audio", "video"].includes(a.tipo) ? a.tipo : "file";
    await sendRaw(recipient, { attachment: { type, payload: { url: a.public_url } } });
  }
}

export const firstStep = (auto: any) => (auto?.flow?.steps ?? [])[0]; // o PRIMEIRO do array, não "id === 0"

export async function logDelivery(row: Record<string, unknown>) {
  await sb.from("ig_deliveries").insert(row);
}
