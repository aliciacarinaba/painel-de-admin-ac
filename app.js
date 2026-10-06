/* ============================================================
   PAINEL DE ADMINISTRAÇÃO: lógica do frontend (JS puro)
   ------------------------------------------------------------
   1) Configuração (SUPABASE_URL e SUPABASE_ANON_KEY)
   2) Início de sessão (modo local ou Supabase)
   3) Navegação e ecrãs (Início, Calendário, Instagram)
   4) Editor de automação + pré-visualização em direto
   ============================================================ */

// ---------- 1) CONFIGURAÇÃO ----------
// Estas duas chaves podem ficar públicas (quem tranca os dados é o RLS).
// A chave service_role NUNCA vai para aqui.
const CONFIG = {
  SUPABASE_URL: 'https://kpqdwnmaezyaflmhvdog.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcWR3bm1hZXp5YWZsbWh2ZG9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNzY1MjAsImV4cCI6MjEwNjg1MjUyMH0.hQPwp-Kuq6Q1u9KSDpIegCc_KihjdmgQFO9zFI8Wbtk',
};

// Modo local: localhost, 127.0.0.1 ou ficheiro aberto diretamente (file://)
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname) || location.protocol === 'file:';

let sb = null; // cliente Supabase (só existe em produção e com a configuração preenchida)
try {
  if (!IS_LOCAL && window.supabase && /^https?:\/\//.test(CONFIG.SUPABASE_URL)) {
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
} catch (e) { console.warn('Supabase indisponível', e); }

// ---------- Utilitários ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const looksLikeUrl = (s) => /^https?:\/\//i.test(s.trim()) || (s.trim().length > 20 && /\w\.\w/.test(s) && !/\s/.test(s.trim()));

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 3800);
}

// ============================================================
// 2) INÍCIO DE SESSÃO
// ============================================================
async function hasSession() {
  if (IS_LOCAL) return !!localStorage.getItem('localLogin');
  if (!sb) return false;
  try { const { data } = await sb.auth.getSession(); return !!data.session; } catch { return false; }
}

function showLogin() {
  $('#app').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-local-note').hidden = !IS_LOCAL;
}

async function showApp() {
  $('#login-screen').hidden = true;
  $('#app').hidden = false;
  $('#local-banner').hidden = !IS_LOCAL;
  let email = '';
  if (IS_LOCAL) email = localStorage.getItem('localLogin') || '';
  else if (sb) { try { email = (await sb.auth.getUser()).data.user?.email || ''; } catch {} }
  $('#user-label').textContent = email;
  go(state.route);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const pass = $('#login-pass').value;
  const err = $('#login-error');
  err.hidden = true;

  if (IS_LOCAL) {
    // Só para testar: qualquer e-mail e uma palavra-passe com exatamente 5 dígitos
    if (!/^\d{5}$/.test(pass)) {
      err.textContent = 'No modo de teste local, a palavra-passe tem de ter 5 dígitos (ex: 12345).';
      err.hidden = false; return;
    }
    localStorage.setItem('localLogin', email);
    return showApp();
  }

  if (!sb) {
    err.textContent = 'O Supabase ainda não está configurado. Preenche o SUPABASE_URL e o SUPABASE_ANON_KEY (ver LEIA-ME).';
    err.hidden = false; return;
  }
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    showApp();
  } catch {
    err.textContent = 'E-mail ou palavra-passe incorretos.';
    err.hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  if (IS_LOCAL) localStorage.removeItem('localLogin');
  else if (sb) { try { await sb.auth.signOut(); } catch {} }
  $('#login-pass').value = '';
  showLogin();
});

if (sb) sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') showLogin(); });

// ============================================================
// 3) NAVEGAÇÃO E ECRÃS
// ============================================================
const state = { route: 'home', igTab: 'automations' };

$$('.nav-item').forEach((b) => b.addEventListener('click', () => { go(b.dataset.route); $('#sidebar').classList.remove('open'); }));
$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

function go(route) {
  state.route = route;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === route));
  if (route === 'home') renderHome();
  else if (route === 'calendar') renderCalendar();
  else renderInstagram();
}

// Contagem tolerante a falhas (devolve 0 se não houver Supabase)
async function safeCount(table, filter) {
  if (!sb) return 0;
  try {
    let q = sb.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    const { count, error } = await q;
    return error ? 0 : (count || 0);
  } catch { return 0; }
}

// ---------- Início ----------
async function renderHome() {
  const v = $('#view');
  v.innerHTML = `
    <div class="page-head"><h1>Bem-vindo ao teu painel</h1><p class="muted">Um resumo rápido do que está a acontecer.</p></div>
    <div class="grid cols-3">
      <div class="card"><div class="stat-l">Leads captados</div><div class="stat-n" id="n-leads">0</div></div>
      <div class="card"><div class="stat-l">Automações ativas</div><div class="stat-n" id="n-autos">0</div></div>
      <div class="card"><div class="stat-l">DMs enviadas (7 dias)</div><div class="stat-n" id="n-dms">0</div></div>
    </div>
    <h3 style="margin-top:28px">Atalhos</h3>
    <div class="row">
      <button class="btn primary" data-go="instagram">Ir para o Instagram</button>
      <button class="btn" data-go="calendar">Ir para o Calendário</button>
    </div>`;
  $$('[data-go]', v).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [leads, autos, dms] = await Promise.all([
    safeCount('ig_leads'),
    safeCount('ig_automations', (q) => q.eq('active', true)),
    safeCount('ig_deliveries', (q) => q.eq('status', 'ok').gte('ts', since)),
  ]);
  if (state.route !== 'home') return;
  $('#n-leads').textContent = leads; $('#n-autos').textContent = autos; $('#n-dms').textContent = dms;
}

// ---------- Calendário (placeholder) ----------
function renderCalendar() {
  $('#view').innerHTML = `
    <div class="card empty" style="margin-top:40px">
      <div class="big">▦</div>
      <h2>Calendário</h2>
      <p>Esta área vai chegar em breve para planeares os teus conteúdos.</p>
    </div>`;
}

// ---------- Instagram ----------
function renderInstagram() {
  $('#view').innerHTML = `
    <div class="page-head"><h1>Instagram</h1><p class="muted">Métricas e automações de direct.</p></div>
    <div class="tabs">
      <button class="tab" data-tab="metrics">Métricas</button>
      <button class="tab" data-tab="automations">Automações</button>
    </div>
    <div id="ig-body"></div>`;
  $$('.tab').forEach((t) => t.addEventListener('click', () => { state.igTab = t.dataset.tab; renderInstagram(); }));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.igTab));
  if (state.igTab === 'metrics') renderMetrics(); else renderAutomations();
}

function bars(series) {
  const max = Math.max(1, ...series.map((p) => p.value));
  return `<div class="bars">${series.map((p) => `<div class="bar" style="height:${Math.max(2, (p.value / max) * 100)}%" data-tip="${esc(p.date)}: ${p.value}"></div>`).join('')}</div>`;
}

async function renderMetrics() {
  const body = $('#ig-body');
  body.innerHTML = `<div class="card muted">A carregar métricas...</div>`;
  let data = null;
  if (sb) { try { const r = await sb.functions.invoke('ig-insights'); if (!r.error && r.data && !r.data.error) data = r.data; } catch {} }
  if (state.route !== 'instagram' || state.igTab !== 'metrics') return;
  const leads = await safeCount('ig_leads');
  if (!data) {
    body.innerHTML = `
      <div class="card empty"><div class="big">◎</div><h2>Liga o teu Instagram para ver as métricas</h2>
      <p>Depois de ligares a conta (ver LEIA-ME), aqui vais ver seguidores, novos seguidores e alcance.</p></div>
      <div class="grid cols-3" style="margin-top:16px"><div class="card"><div class="stat-l">Leads captados</div><div class="stat-n">${leads}</div></div></div>`;
    return;
  }
  body.innerHTML = `
    <div class="grid cols-3">
      <div class="card"><div class="stat-l">Seguidores</div><div class="stat-n">${data.followers ?? 0}</div></div>
      <div class="card"><div class="stat-l">Leads captados</div><div class="stat-n">${leads}</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Novos seguidores por dia</h3>${bars(data.followers_by_day || [])}</div>
      <div class="card"><h3>Alcance por dia</h3>${bars(data.reach_by_day || [])}</div>
    </div>`;
}

// ---------- Lista de automações ----------
async function renderAutomations() {
  const body = $('#ig-body');
  body.innerHTML = `
    <div class="row between" style="margin-bottom:14px">
      <div><h2>Automações</h2><p class="muted small" style="margin:0">Respostas automáticas de DM a partir de comentários.</p></div>
      <button class="btn primary" id="new-auto">Nova automação</button>
    </div>
    <div class="card" id="auto-list"><div class="muted">A carregar...</div></div>`;
  $('#new-auto').addEventListener('click', () => openEditor(null));

  let list = [];
  if (sb) { try { const { data } = await sb.from('ig_automations').select('*').order('updated_at', { ascending: false }); list = data || []; } catch {} }
  if (state.igTab !== 'automations' || state.route !== 'instagram') return;
  const box = $('#auto-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="big">✉</div><h3>Ainda não tens automações</h3>
      <p>Cria a primeira para responder por direct a quem comentar uma palavra.</p></div>`;
    return;
  }
  box.innerHTML = list.map((a) => `
    <div class="auto-item" data-id="${esc(a.id)}">
      <div>
        <strong>${esc(a.nome || 'Sem nome')}</strong><br>
        ${a.match_any ? '<span class="chip gray">qualquer palavra</span>' : (a.keyword || '').split(',').filter(Boolean).map((k) => `<span class="chip">${esc(k.trim())}</span>`).join('')}
      </div>
      <div class="row">
        <label class="switch" title="Ligar ou desligar"><input type="checkbox" data-act="toggle" ${a.active ? 'checked' : ''}><span class="slider"></span></label>
        <button class="btn sm" data-act="edit">Editar</button>
        <button class="btn sm danger" data-act="del">Apagar</button>
      </div>
    </div>`).join('');
  box.addEventListener('click', async (e) => {
    const act = e.target.dataset.act; if (!act) return;
    const id = e.target.closest('.auto-item').dataset.id;
    const item = list.find((x) => String(x.id) === id);
    if (act === 'edit') openEditor(item);
    if (act === 'del' && confirm('Apagar esta automação?')) {
      const { error } = await sb.from('ig_automations').delete().eq('id', id);
      if (error) return toast('Não foi possível apagar.', true);
      renderAutomations();
    }
  });
  box.addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'toggle') return;
    const id = e.target.closest('.auto-item').dataset.id;
    const { error } = await sb.from('ig_automations').update({ active: e.target.checked }).eq('id', id);
    if (error) { toast('Não foi possível atualizar.', true); e.target.checked = !e.target.checked; }
  });
}

// ============================================================
// 4) EDITOR DE AUTOMAÇÃO
// ============================================================
const EMOJIS = ['🫶', '👀', '😍', '🥰', '😂', '😮', '🔥', '✨', '💌', '👉', '🙌', '💕'];
let draft = null;      // o que está a ser editado
let dirty = false;     // há alterações por guardar?
let posts = null;      // posts do Instagram (carregados 1x)
let assets = null;     // biblioteca de ficheiros

function newDraft() {
  return {
    id: null, nome: '', active: true,
    keywords: [], matchAny: false, mediaIds: [],
    publicReply: '', variants: [],
    msg1: '', btnOn: true, btnText: '',
    action: 'link',            // 'link' ou 'conversa'
    link: '', assetIds: [],
    steps: [], nid: 2,         // Mensagem 2 em diante (ids 2, 3, 4...)
  };
}

// Converte a automação guardada (flow) para o estado do editor
function draftFromAutomation(a) {
  const d = newDraft();
  d.id = a.id; d.nome = a.nome || ''; d.active = a.active !== false;
  d.keywords = (a.keyword || '').split(',').map((s) => s.trim()).filter(Boolean);
  d.matchAny = !!a.match_any; d.mediaIds = a.media_ids || [];
  d.publicReply = a.public_reply || ''; d.variants = a.public_reply_variants || [];
  d.assetIds = a.asset_ids || [];
  const steps = a.flow?.steps || [];
  if (steps.length) {
    const first = steps[0], b = (first.buttons || [])[0];
    d.msg1 = first.message || '';
    d.btnOn = (first.buttons || []).length > 0;
    d.btnText = b?.title || '';
    if (b?.url) { d.action = 'link'; d.link = b.url; } else d.action = 'conversa';
    d.steps = steps.slice(1).map((s) => ({
      id: s.id, message: s.message || '',
      buttons: (s.buttons || []).map((x) => (x.url ? { title: x.title, dest: 'link', url: x.url } : x.next != null ? { title: x.title, dest: 'step', next: x.next } : { title: x.title, dest: 'end' })),
    }));
    d.nid = Math.max(1, ...steps.map((s) => Number(s.id) || 0)) + 1;
  }
  return d;
}

// Converte o estado do editor para o formato flow (secção 7 do prompt)
function buildFlow(d) {
  const first = { id: 1, message: d.msg1.trim(), buttons: [] };
  if (d.assetIds.length) first.assets = d.assetIds;
  if (d.btnOn && d.btnText.trim()) {
    if (d.action === 'link') first.buttons.push({ title: d.btnText.trim(), url: d.link.trim() });
    else first.buttons.push(d.steps.length ? { title: d.btnText.trim(), next: d.steps[0].id } : { title: d.btnText.trim() });
  }
  const steps = [first];
  if (d.action === 'conversa') {
    d.steps.forEach((s) => steps.push({
      id: s.id, message: s.message.trim(),
      // Botão com nome mas sem destino = "termina" (guardado só com título, não é enviado)
      buttons: s.buttons.filter((b) => b.title.trim() || b.url).map((b) => {
        if (b.dest === 'link') return { title: b.title.trim(), url: (b.url || '').trim() };
        if (b.dest === 'step' && b.next != null) return { title: b.title.trim(), next: Number(b.next) };
        return { title: b.title.trim() };
      }),
    }));
  }
  return { steps };
}

async function openEditor(automation) {
  draft = automation ? draftFromAutomation(automation) : newDraft();
  dirty = false;
  $('#editor').hidden = false;
  document.body.style.overflow = 'hidden';
  renderEditor();
  loadPosts(); loadAssets();
}

function closeEditor(force) {
  if (!force && dirty && !confirm('Tens alterações por guardar. Queres mesmo sair?')) return;
  $('#editor').hidden = true; document.body.style.overflow = '';
  draft = null; dirty = false;
  if (state.route === 'instagram' && state.igTab === 'automations') renderAutomations();
}

async function loadPosts() {
  if (posts !== null) return;
  posts = [];
  if (sb) { try { const r = await sb.functions.invoke('ig-media'); posts = r.data?.posts || []; } catch {} }
  if (draft) renderPostsBox();
}
async function loadAssets() {
  if (assets !== null) return;
  assets = [];
  if (sb) { try { const { data } = await sb.from('ig_assets').select('id,nome,tipo').order('created_at', { ascending: false }); assets = data || []; } catch {} }
  if (draft) renderAssetsBox();
}

// ---------- Desenho do editor ----------
function btnRowHTML(si, bi, b) {
  const dests = d_options(b.dest);
  const others = draft.steps.map((s, i) => ({ id: s.id, n: i + 2 })).filter((o) => o.id !== draft.steps[si].id);
  return `<div class="btn-row">
    <div class="row">
      <div><input type="text" placeholder="Nome do botão" value="${esc(b.title)}" data-s="${si}" data-b="${bi}" data-f="title">
        <div class="count ${b.title.length > 20 && b.dest !== 'link' ? 'over' : ''}" data-count="${si}-${bi}">${b.title.length}/20</div></div>
      <div><select data-s="${si}" data-b="${bi}" data-f="dest" data-re="1">${dests}</select></div>
      <button class="btn sm danger" data-a="del-btn" data-s="${si}" data-b="${bi}" style="flex:none;min-width:0">Remover</button>
    </div>
    ${b.dest === 'step' ? `<select style="margin-top:8px" data-s="${si}" data-b="${bi}" data-f="next" data-re="1">
        <option value="">Escolhe a mensagem de destino</option>
        ${others.map((o) => `<option value="${o.id}" ${String(b.next) === String(o.id) ? 'selected' : ''}>Mensagem ${o.n}</option>`).join('')}</select>` : ''}
    ${b.dest === 'link' ? `<textarea class="url-box" style="margin-top:8px" placeholder="Cola aqui o link completo (https://...)" data-s="${si}" data-b="${bi}" data-f="url">${esc(b.url || '')}</textarea>` : ''}
    ${b.dest === 'end' ? `<div class="field-help">A conversa termina aqui. Este botão não aparece para a pessoa.</div>` : ''}
  </div>`;
}
function d_options(cur) {
  return [['step', 'Ir para outra mensagem'], ['link', 'Abrir um link'], ['end', 'Terminar']]
    .map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('');
}

function renderEditor() {
  const d = draft;
  const root = $('#editor');
  const scroll = $('.editor-form', root)?.scrollTop || 0;
  root.innerHTML = `
    <div class="editor-head">
      <div class="row"><button class="btn ghost" data-a="close">← Voltar</button><strong>${d.id ? 'Editar automação' : 'Nova automação'}</strong></div>
      <button class="btn primary" data-a="save">Guardar</button>
    </div>
    <div class="editor-body">
      <div class="editor-form">
        <label class="label" style="margin-top:0">Nome da automação (só para ti)</label>
        <input type="text" data-f="nome" placeholder="Ex: Guia gratuito" value="${esc(d.nome)}">

        <div class="block-title" style="margin-top:28px"><span class="block-n">1</span><h2>O gatilho</h2></div>
        <p class="muted small" style="margin:0">O que faz a DM disparar.</p>

        <label class="label">Palavras que ativam</label>
        <div class="tags" id="tags">
          ${d.keywords.map((k, i) => `<span class="tag">${esc(k)} <button data-a="del-kw" data-i="${i}" aria-label="Remover">×</button></span>`).join('')}
          <input type="text" id="kw-input" placeholder="Escreve e carrega em Enter" ${d.matchAny ? 'disabled' : ''}>
        </div>
        <div class="switch-row"><span>Qualquer palavra ativa</span>
          <label class="switch"><input type="checkbox" data-f="matchAny" data-re="1" ${d.matchAny ? 'checked' : ''}><span class="slider"></span></label></div>

        <label class="label">Em que posts</label>
        <div id="posts-box"></div>

        <label class="label">Resposta no comentário</label>
        <input type="text" data-f="publicReply" placeholder="Ex: enviei-te mensagem no direct" value="${esc(d.publicReply)}">
        ${d.variants.map((v, i) => `<div class="row" style="margin-top:8px"><input type="text" style="flex:1" placeholder="Variação ${String.fromCharCode(66 + i)}" value="${esc(v)}" data-v="${i}"><button class="btn sm danger" data-a="del-var" data-i="${i}">Remover</button></div>`).join('')}
        <button class="btn sm" style="margin-top:8px" data-a="add-var">+ Adicionar variação A/B</button>
        <div class="field-help">Com variações, o sistema alterna entre os textos.</div>

        <div class="block-title" style="margin-top:32px"><span class="block-n">2</span><h2>A resposta</h2></div>
        <p class="muted small" style="margin:0">O que a pessoa recebe na DM.</p>

        <label class="label">A tua mensagem</label>
        <textarea id="msg1" data-f="msg1" placeholder="Escreve a primeira mensagem...">${esc(d.msg1)}</textarea>
        <div class="emojis">${EMOJIS.map((e) => `<button type="button" data-a="emoji" data-e="${e}">${e}</button>`).join('')}</div>

        <div class="switch-row"><span>Botão na mensagem</span>
          <label class="switch"><input type="checkbox" data-f="btnOn" data-re="1" ${d.btnOn ? 'checked' : ''}><span class="slider"></span></label></div>

        ${d.btnOn ? `
          <label class="label">Texto do botão</label>
          <input type="text" data-f="btnText" placeholder="Ex: Quero receber" value="${esc(d.btnText)}">
          <div class="count ${d.btnText.length > 20 ? 'over' : ''}" id="btn-count">${d.btnText.length}/20</div>

          <label class="label">O que o botão faz quando ela toca</label>
          <select data-f="action" data-re="1">
            <option value="link" ${d.action === 'link' ? 'selected' : ''}>Um link</option>
            <option value="conversa" ${d.action === 'conversa' ? 'selected' : ''}>Continua a conversa</option>
          </select>

          ${d.action === 'link' ? `
            <label class="label">Link</label>
            <textarea class="url-box" data-f="link" placeholder="Cola aqui o link completo (https://...)">${esc(d.link)}</textarea>
            <div class="field-help">O link vai neste campo, nunca no nome do botão. A pessoa vê só o nome do botão.</div>` : sequenceHTML()}
        ` : ''}

        <label class="label">Anexar um ficheiro (opcional)</label>
        <div id="assets-box"></div>
      </div>

      <aside class="editor-preview">
        <div class="label" style="margin-top:0;text-align:center">Pré-visualização em direto</div>
        <div id="preview"></div>
      </aside>
    </div>`;
  renderPostsBox(); renderAssetsBox(); renderPreview();
  const f = $('.editor-form', root); if (f) f.scrollTop = scroll;
}

function sequenceHTML() {
  const d = draft;
  return `
    <label class="label">Sequência da conversa</label>
    <div class="seq">
      <div class="seq-card ref">
        <strong>Mensagem 1</strong>
        <div class="small muted" style="margin-top:4px">${esc(d.msg1) || 'Escreve a mensagem lá em cima.'}</div>
        <div style="margin-top:6px"><span class="chip">${esc(d.btnText) || 'Botão'}</span></div>
        <div class="field-help">Esta mensagem edita-se lá em cima ("A tua mensagem" e "Texto do botão").</div>
      </div>
      ${d.steps.map((s, si) => `
        <div class="seq-card">
          <div class="row between"><strong>Mensagem ${si + 2}</strong><button class="btn sm danger" data-a="del-step" data-s="${si}">Remover mensagem</button></div>
          <textarea style="margin-top:8px;min-height:70px" data-s="${si}" data-f="message" placeholder="Escreve a mensagem...">${esc(s.message)}</textarea>
          ${s.buttons.map((b, bi) => btnRowHTML(si, bi, b)).join('')}
          <button class="btn sm" style="margin-top:8px" data-a="add-btn" data-s="${si}">+ Adicionar botão</button>
        </div>`).join('')}
      <div><button class="btn" data-a="add-step">+ Adicionar mensagem</button></div>
    </div>`;
}

function renderPostsBox() {
  const box = $('#posts-box'); if (!box || !draft) return;
  if (posts === null) { box.innerHTML = '<div class="muted small">A carregar posts...</div>'; return; }
  if (!posts.length) {
    box.innerHTML = `<div class="field-help" style="margin-top:0">Liga o teu Instagram para escolher posts. Vazio = vale para todos os posts.</div>`;
    return;
  }
  box.innerHTML = `<div class="posts">${posts.map((p) => `<div class="post ${draft.mediaIds.includes(p.id) ? 'sel' : ''}" data-a="pick-post" data-id="${esc(p.id)}" title="${esc((p.caption || '').slice(0, 80))}" style="background-image:url('${esc(p.thumbnail_url || p.media_url || '')}')"></div>`).join('')}</div>
    <div class="field-help">Vazio = vale para todos os posts.</div>`;
}

function renderAssetsBox() {
  const box = $('#assets-box'); if (!box || !draft) return;
  if (!assets || !assets.length) { box.innerHTML = '<div class="field-help" style="margin-top:0">Ainda não tens ficheiros na biblioteca.</div>'; return; }
  box.innerHTML = assets.map((a) => `<label class="row" style="margin:4px 0"><input type="checkbox" data-a="pick-asset" data-id="${esc(a.id)}" ${draft.assetIds.includes(a.id) ? 'checked' : ''}> ${esc(a.nome)} <span class="chip gray">${esc(a.tipo)}</span></label>`).join('');
}

// ---------- Pré-visualização ----------
function previewModel(d) {
  const msgs = [];
  const b1 = [];
  if (d.btnOn && d.btnText.trim()) {
    if (d.action === 'link') { if (d.link.trim()) b1.push({ t: d.btnText.trim(), link: true }); }
    else if (d.steps.length) b1.push({ t: d.btnText.trim() });
  }
  msgs.push({ text: d.msg1, buttons: b1, attach: d.assetIds.length });
  if (d.action === 'conversa' && d.btnOn) {
    d.steps.forEach((s) => {
      const bs = s.buttons.filter((b) => b.title.trim() && ((b.dest === 'link' && (b.url || '').trim()) || (b.dest === 'step' && b.next != null && b.next !== '' && d.steps.some((x) => String(x.id) === String(b.next)))))
        .map((b) => ({ t: b.title.trim(), link: b.dest === 'link' }));
      msgs.push({ text: s.message, buttons: bs });
    });
  }
  return msgs;
}

function renderPreview() {
  const box = $('#preview'); if (!box || !draft) return;
  const msgs = previewModel(draft);
  box.innerHTML = `
    <div class="phone">
      <div class="phone-top">Direct</div>
      <div class="phone-body">
        ${msgs.map((m) => `
          <div class="msg">
            <div class="bubble ${m.buttons.length ? 'has-btns' : ''} ${m.text.trim() ? '' : 'ph'}">${m.text.trim() ? esc(m.text) : 'A tua mensagem aparece aqui...'}</div>
            ${m.buttons.map((b) => `<span class="bubble-btn">${b.link ? '🔗 ' : ''}${esc(b.t.slice(0, 20))}</span>`).join('')}
            ${m.attach ? `<div class="attach">📎 ${m.attach} ficheiro(s) anexado(s)</div>` : ''}
          </div>`).join('')}
      </div>
    </div>
    <p class="phone-note">Assim é que a mensagem chega à pessoa. Botões sem destino não aparecem, tal como não são enviados.</p>`;
}

// ---------- Eventos do editor (delegação) ----------
const edRoot = $('#editor');

function applyField(t) {
  const d = draft, f = t.dataset.f;
  const val = t.type === 'checkbox' ? t.checked : t.value;
  if (t.dataset.s !== undefined) {
    const s = d.steps[+t.dataset.s];
    if (t.dataset.b !== undefined) {
      const b = s.buttons[+t.dataset.b];
      if (f === 'dest') {
        b.dest = val;
        // Se colaram um link no nome do botão, move-o para o campo certo
        if (val === 'link' && looksLikeUrl(b.title)) { b.url = b.title.trim(); b.title = 'Aceder'; }
        if (val === 'link' && !b.title.trim()) b.title = 'Aceder';
      } else b[f] = val;
    } else s[f] = val;
  } else if (t.dataset.v !== undefined) {
    d.variants[+t.dataset.v] = val;
  } else {
    d[f] = val;
    // Mudou para "Um link" e o texto do botão é um link: move-o
    if (f === 'action' && val === 'link' && looksLikeUrl(d.btnText)) { d.link = d.btnText.trim(); d.btnText = 'Aceder'; }
  }
}

edRoot.addEventListener('input', (e) => {
  const t = e.target;
  if (!(t.dataset.f || t.dataset.v !== undefined)) return;
  if (t.type === 'checkbox' || t.tagName === 'SELECT') return; // tratados no 'change'
  applyField(t); dirty = true; renderPreview();
  // contadores de 20 caracteres
  if (t.dataset.f === 'btnText') { const c = $('#btn-count'); c.textContent = `${t.value.length}/20`; c.classList.toggle('over', t.value.length > 20); }
  if (t.dataset.f === 'title') { const c = $(`[data-count="${t.dataset.s}-${t.dataset.b}"]`); if (c) { c.textContent = `${t.value.length}/20`; c.classList.toggle('over', t.value.length > 20); } }
});

edRoot.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.a === 'pick-asset') {
    const id = t.dataset.id; draft.assetIds = t.checked ? [...draft.assetIds, id] : draft.assetIds.filter((x) => x !== id);
    dirty = true; return renderPreview();
  }
  if (!t.dataset.f) return;
  applyField(t); dirty = true;
  if (t.dataset.re) renderEditor(); else renderPreview();
});

edRoot.addEventListener('keydown', (e) => {
  if (e.target.id !== 'kw-input') return;
  const inp = e.target;
  if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) {
    e.preventDefault();
    const w = inp.value.trim().replace(/,/g, '');
    if (w && !draft.keywords.includes(w)) draft.keywords.push(w);
    dirty = true; renderEditor(); $('#kw-input')?.focus();
  } else if (e.key === 'Backspace' && !inp.value && draft.keywords.length) {
    draft.keywords.pop(); dirty = true; renderEditor(); $('#kw-input')?.focus();
  }
});

edRoot.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, d = draft;
  if (a === 'close') return closeEditor();
  if (a === 'save') return saveDraft();
  if (a === 'emoji') {
    const ta = $('#msg1'), s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
    ta.value = ta.value.slice(0, s) + el.dataset.e + ta.value.slice(en);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + el.dataset.e.length;
    d.msg1 = ta.value; dirty = true; return renderPreview();
  }
  if (a === 'del-kw') d.keywords.splice(+el.dataset.i, 1);
  else if (a === 'add-var') d.variants.push('');
  else if (a === 'del-var') d.variants.splice(+el.dataset.i, 1);
  else if (a === 'add-step') d.steps.push({ id: d.nid++, message: '', buttons: [] });
  else if (a === 'del-step') {
    const removed = d.steps.splice(+el.dataset.s, 1)[0];
    // limpa botões que apontavam para esta mensagem
    d.steps.forEach((s) => s.buttons.forEach((b) => { if (b.dest === 'step' && String(b.next) === String(removed.id)) b.next = null; }));
  }
  else if (a === 'add-btn') d.steps[+el.dataset.s].buttons.push({ title: '', dest: 'step', next: null });
  else if (a === 'del-btn') d.steps[+el.dataset.s].buttons.splice(+el.dataset.b, 1);
  else if (a === 'pick-post') {
    const id = el.dataset.id; d.mediaIds = d.mediaIds.includes(id) ? d.mediaIds.filter((x) => x !== id) : [...d.mediaIds, id];
    dirty = true; return renderPostsBox();
  } else return;
  dirty = true; renderEditor();
});

// ---------- Guardar ----------
async function saveDraft() {
  const d = draft;
  // Validações amigáveis
  if (!d.matchAny && !d.keywords.length) return toast('Adiciona pelo menos uma palavra que ativa, ou liga "Qualquer palavra ativa".', true);
  if (!d.msg1.trim()) return toast('Escreve a tua mensagem (a Mensagem 1).', true);
  if (d.btnOn) {
    if (!d.btnText.trim()) return toast('Escreve o texto do botão ou desliga "Botão na mensagem".', true);
    if (d.btnText.trim().length > 20) return toast('O texto do botão tem no máximo 20 caracteres.', true);
    if (d.action === 'link' && !d.link.trim()) return toast('Cola o link que o botão deve abrir.', true);
    if (d.action === 'link' && !/^https?:\/\//i.test(d.link.trim())) return toast('O link tem de começar por http:// ou https://', true);
    if (d.action === 'conversa') {
      for (const [i, s] of d.steps.entries()) {
        if (!s.message.trim()) return toast(`Escreve o texto da Mensagem ${i + 2}.`, true);
        for (const b of s.buttons) {
          if (b.title.trim().length > 20 && b.dest !== 'link') return toast(`Um botão da Mensagem ${i + 2} tem mais de 20 caracteres.`, true);
          if (b.dest === 'link' && b.url && !/^https?:\/\//i.test(b.url.trim())) return toast('Um dos links tem de começar por http:// ou https://', true);
        }
      }
    }
  }
  if (!sb) return toast('Para guardar de verdade, liga primeiro o Supabase (ver LEIA-ME). Podes continuar a testar o editor à vontade.', true);

  const row = {
    nome: d.nome.trim() || d.keywords[0] || 'Automação',
    keyword: d.keywords.join(','), match_any: d.matchAny, active: d.active,
    media_ids: d.mediaIds, public_reply: d.publicReply.trim(),
    public_reply_variants: d.variants.map((v) => v.trim()).filter(Boolean),
    flow: buildFlow(d), asset_ids: d.assetIds, updated_at: new Date().toISOString(),
  };
  try {
    const q = d.id ? sb.from('ig_automations').update(row).eq('id', d.id) : sb.from('ig_automations').insert(row);
    const { error } = await q;
    if (error) throw error;
    dirty = false; toast('Automação guardada.'); closeEditor(true);
  } catch (err) { console.error(err); toast('Não foi possível guardar. Confirma a ligação ao Supabase.', true); }
}

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- Arranque ----------
(async function init() {
  if (await hasSession()) showApp(); else showLogin();
})();
