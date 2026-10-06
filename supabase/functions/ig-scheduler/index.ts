// ============================================================
// ig-scheduler (o carteiro): corre via pg_cron a cada 1 minuto.
// Protegido pelo header x-sched-key = SCHED_SECRET.
// 1) Esvazia a fila de envios retidos pelo travão.
// 2) Envia os passos com atraso que já venceram.
// ============================================================
import { env, sb, json, sendStep, firstStep, takeSlot, recordResult, logDelivery } from "../_shared/ig.ts";

const MAX_AGE_MS = 7 * 864e5; // resposta a comentário só vale cerca de 7 dias

Deno.serve(async (req) => {
  if (!env("SCHED_SECRET") || req.headers.get("x-sched-key") !== env("SCHED_SECRET")) return json({ error: "não autorizado" }, 401);

  let sent = 0, expired = 0, scheduled = 0;

  // 1) Fila
  const { data: queue } = await sb.from("ig_send_queue").select("*").eq("status", "pendente").order("created_at").limit(20);
  for (const q of queue ?? []) {
    if (Date.now() - new Date(q.created_at).getTime() > MAX_AGE_MS) {
      await sb.from("ig_send_queue").update({ status: "expirado" }).eq("id", q.id); expired++; continue;
    }
    if (!(await takeSlot())) break; // sem ficha: tenta no próximo minuto
    const { data: auto } = await sb.from("ig_automations").select("*").eq("id", q.automation_id).maybeSingle();
    const step = firstStep(auto);
    if (!auto || !step) { await sb.from("ig_send_queue").update({ status: "erro", last_error: "automação sem fluxo" }).eq("id", q.id); continue; }

    const r = await sendStep({ comment_id: q.comment_id }, auto, step);
    await recordResult(r.ok, r.hard);
    await logDelivery({ ig_user_id: q.ig_user_id, automation_id: auto.id, canal: "private_reply", tipo: "flow", status: r.ok ? "ok" : "erro", motivo: r.error || null });
    const tent = (q.tentativas ?? 0) + 1;
    await sb.from("ig_send_queue").update(
      r.ok ? { status: "enviado", sent_at: new Date().toISOString(), tentativas: tent }
           : { status: tent >= 5 ? "erro" : "pendente", tentativas: tent, last_error: r.error }
    ).eq("id", q.id);
    if (r.ok) sent++;
  }

  // 2) Passos com atraso
  const { data: due } = await sb.from("ig_scheduled").select("*").eq("sent", false).lte("send_at", new Date().toISOString()).limit(20);
  for (const s of due ?? []) {
    const { data: auto } = await sb.from("ig_automations").select("*").eq("id", s.automation_id).maybeSingle();
    const step = (auto?.flow?.steps ?? []).find((x: any) => String(x.id) === String(s.step_id));
    if (!auto || !step) { await sb.from("ig_scheduled").update({ sent: true }).eq("id", s.id); continue; }
    const r = await sendStep({ id: s.ig_user_id }, auto, step);
    await logDelivery({ ig_user_id: s.ig_user_id, automation_id: auto.id, canal: "dm", tipo: "flow", status: r.ok ? "ok" : "erro", motivo: r.error || null });
    await sb.from("ig_scheduled").update({ sent: true }).eq("id", s.id);
    if (r.ok) scheduled++;
  }

  return json({ sent, expired, scheduled });
});
