// ============================================================
// instagram-webhook: o cérebro do sistema.
// Publicar com:  supabase functions deploy instagram-webhook --no-verify-jwt
// (tem de ser PÚBLICA, senão o Meta não consegue chamá-la)
// ============================================================
import { env, sb, ig, sendStep, firstStep, takeSlot, recordResult, alreadySeen, logDelivery } from "../_shared/ig.ts";

// ---------- Assinatura (HMAC SHA-256) ----------
async function validSignature(raw: string, header: string | null): Promise<boolean> {
  const secret = env("APP_SECRET");
  if (!secret || !header) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === header;
}

// Tira acentos e maiúsculas para comparar palavras
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // a) Verificação (GET): o aperto de mão com o Meta
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env("VERIFY_TOKEN")) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // b) Receção (POST)
  const raw = await req.text();
  const ok = await validSignature(raw, req.headers.get("x-hub-signature-256"));
  if (!ok) {
    if (env("APP_SECRET_ENFORCE") === "true") return new Response("Assinatura inválida", { status: 401 });
    console.warn("AVISO: assinatura inválida (modo teste: o evento é processado na mesma)");
  }

  try {
    const body = JSON.parse(raw);
    for (const entry of body.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        if (ch.field === "comments") await handleComment(ch.value);
      }
      for (const ev of entry.messaging ?? []) await handleMessage(ev);
    }
  } catch (e) { console.error("Erro no webhook", e); }

  return new Response("ok", { status: 200 }); // responde sempre 200 para o Meta não repetir
});

// ============================================================
// COMENTÁRIO
// ============================================================
async function handleComment(c: any) {
  const commentId = String(c?.id ?? "");
  const userId = String(c?.from?.id ?? "");
  if (!commentId || !userId) return;
  if (await alreadySeen("c:" + commentId)) return;           // 1) duplicado
  if (userId === env("IG_ACCOUNT_ID")) return;                // 2) comentário da própria conta

  // 3) Encontra a automação (palavra-chave + post)
  const text = norm(String(c.text ?? ""));
  const mediaId = String(c?.media?.id ?? "");
  const { data: autos } = await sb.from("ig_automations").select("*").eq("active", true);
  const auto = (autos ?? []).find((a: any) => {
    const mediaOk = !a.media_ids?.length || a.media_ids.includes(mediaId);
    const kwOk = a.match_any || String(a.keyword ?? "").split(",").map(norm).filter(Boolean).some((k) => text.includes(k));
    return mediaOk && kwOk;
  });
  if (!auto) return;

  // 4) Regra do "1 por dia" (contas de teste ignoram)
  const testIds = env("TEST_IG_ACCOUNTS").split(",").map((s) => s.trim()).filter(Boolean);
  if (!testIds.includes(userId)) {
    const since = new Date(Date.now() - 864e5).toISOString();
    const { data: recent } = await sb.from("ig_deliveries").select("id").eq("ig_user_id", userId).eq("status", "ok").gte("ts", since).limit(1);
    if (recent?.length) return;
  }

  // 5) Entrega e resposta pública
  const result = await deliverAutomation(auto, commentId, userId, c?.from?.username ?? "");
  if (result === "sent" || result === "throttled") {
    await replyToComment(commentId, auto);
    await sb.from("ig_leads").upsert({
      ig_user_id: userId, username: c?.from?.username ?? null, last_source: "comment",
      last_keyword: String(c.text ?? "").slice(0, 100), automation_id: auto.id,
      flow_step: String(firstStep(auto)?.id ?? ""), updated_at: new Date().toISOString(),
    }, { onConflict: "ig_user_id" });
  }
}

// Entrega: manda o PRIMEIRO passo do fluxo, passando pelo travão
async function deliverAutomation(auto: any, commentId: string, userId: string, username: string): Promise<"sent" | "throttled" | "error"> {
  const step = firstStep(auto);
  if (!step) return "error";

  if (!(await takeSlot())) {
    await sb.from("ig_send_queue").upsert({ comment_id: commentId, automation_id: auto.id, ig_user_id: userId, username, status: "pendente" }, { onConflict: "comment_id", ignoreDuplicates: true });
    await logDelivery({ ig_user_id: userId, automation_id: auto.id, canal: "private_reply", tipo: "flow", status: "na_fila", motivo: "travão" });
    return "throttled";
  }
  const r = await sendStep({ comment_id: commentId }, auto, step);
  await recordResult(r.ok, r.hard);
  await logDelivery({ ig_user_id: userId, automation_id: auto.id, canal: "private_reply", tipo: "flow", status: r.ok ? "ok" : "erro", motivo: r.error || null });
  return r.ok ? "sent" : "error";
}

// Resposta pública no comentário (com variação A/B)
async function replyToComment(commentId: string, auto: any) {
  const options = [auto.public_reply, ...(auto.public_reply_variants ?? [])].filter((s: string) => s && s.trim());
  if (!options.length) return;
  const message = options[Math.floor(Math.random() * options.length)];
  await ig(`/${commentId}/replies`, { method: "POST", body: { message } });
}

// ============================================================
// MENSAGEM / POSTBACK / QUICK_REPLY
// ============================================================
async function handleMessage(ev: any) {
  const senderId = String(ev?.sender?.id ?? "");
  const msg = ev?.message, pb = ev?.postback;
  const mid = String(msg?.mid ?? pb?.mid ?? "");
  if (!senderId || senderId === env("IG_ACCOUNT_ID")) return;

  // Ignora "echo" e mensagens que o próprio sistema enviou
  if (msg?.is_echo) return;
  if (mid) {
    const { data: mine } = await sb.from("ig_bot_sends").select("mid").eq("mid", mid).maybeSingle();
    if (mine) return;
    if (await alreadySeen("m:" + mid)) return;
  }

  // Toque num botão: payload STEP:idDaAutomacao:proximoPasso (postback OU quick_reply)
  const payload: string | undefined = pb?.payload ?? msg?.quick_reply?.payload;
  if (payload?.startsWith("STEP:")) {
    const [, autoId, nextId] = payload.split(":");
    return await goToStep(senderId, autoId, nextId);
  }

  // Recolha de dados (e-mail/telefone) quando um passo pediu
  const text = String(msg?.text ?? "").trim();
  if (text) {
    const { data: lead } = await sb.from("ig_leads").select("*").eq("ig_user_id", senderId).maybeSingle();
    if (lead?.expecting?.field) {
      const field = lead.expecting.field as string;
      const valid = field === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) : /^[+\d][\d\s-]{6,}$/.test(text);
      if (!valid) {
        await ig(`/${env("IG_ACCOUNT_ID")}/messages`, { method: "POST", body: { recipient: { id: senderId }, message: { text: field === "email" ? "Esse e-mail parece estranho. Podes escrever outra vez?" : "Esse número parece estranho. Podes escrever outra vez?" } } });
        return;
      }
      await sb.from("ig_leads").update({ [field === "email" ? "email" : "telefone"]: text, expecting: null, updated_at: new Date().toISOString() }).eq("ig_user_id", senderId);
      if (lead.expecting.next != null && lead.automation_id) await goToStep(senderId, lead.automation_id, String(lead.expecting.next));
    }
    // Texto solto sem nada a ver: silêncio.
  }
}

// Avança a conversa para um passo
async function goToStep(userId: string, autoId: string, stepId: string) {
  const { data: auto } = await sb.from("ig_automations").select("*").eq("id", autoId).maybeSingle();
  if (!auto) return;
  const step = (auto.flow?.steps ?? []).find((s: any) => String(s.id) === String(stepId));
  if (!step) return;

  const r = await sendStep({ id: userId }, auto, step); // por DM, já dentro da janela de 24h
  await logDelivery({ ig_user_id: userId, automation_id: auto.id, canal: "dm", tipo: "flow", status: r.ok ? "ok" : "erro", motivo: r.error || null });
  if (!r.ok) return;

  const hasLink = (step.buttons ?? []).some((b: any) => b.url);
  const upd: Record<string, unknown> = { flow_step: String(step.id), updated_at: new Date().toISOString(), last_source: "dm" };
  if (hasLink) upd.link_sent = true;
  if (step.collect) upd.expecting = { field: step.collect.field, next: step.collect.next ?? null };
  await sb.from("ig_leads").upsert({ ig_user_id: userId, automation_id: auto.id, ...upd }, { onConflict: "ig_user_id" });

  // Passo com atraso: o ig-scheduler envia depois
  if (step.delay?.next != null) {
    await sb.from("ig_scheduled").insert({ ig_user_id: userId, automation_id: auto.id, step_id: String(step.delay.next), send_at: new Date(Date.now() + (step.delay.seconds ?? 60) * 1000).toISOString() });
  }
}
