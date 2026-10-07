/* ============================================================
   PAINEL DE ADMINISTRAÇÃO: lógica do frontend (JS puro)
   ------------------------------------------------------------
   1) Configuração (SUPABASE_URL e SUPABASE_ANON_KEY)
   2) Início de sessão (modo local ou Supabase)
   3) Navegação e ecrãs (Início, Calendário, Instagram, Oferta Formativa, Parcerias)
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
const state = { route: 'home', igTab: 'metrics', homeTab: 'general', courseTab: 'draft' };

$$('.nav-item').forEach((b) => b.addEventListener('click', () => { go(b.dataset.route); $('#sidebar').classList.remove('open'); }));
$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

function go(route) {
  // Sempre que se entra no Instagram vindo de outra secção, abre primeiro nas Métricas
  if (route === 'instagram' && state.route !== 'instagram') state.igTab = 'metrics';
  if (route === 'home' && state.route !== 'home') state.homeTab = 'general';
  if (route === 'calendar' && state.route !== 'calendar') CA.sub = 'cal';
  if (route === 'partnerships' && state.route !== 'partnerships') { PA.open = null; PA.draft = null; PA.dirty = false; }
  if (route === 'courses' && state.route !== 'courses') { state.courseTab = 'draft'; CO.open = null; CO.draft = null; CO.dirty = false; }
  state.route = route;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === route));
  if (route === 'home') renderHome();
  else if (route === 'calendar') renderCalendar();
  else if (route === 'partnerships') renderPartnerships();
  else if (route === 'courses') renderCourses();
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
function renderHome() {
  $('#view').innerHTML = `
    <div class="page-head"><h1>👋 Bem-vinda ao teu Painel de Administração</h1></div>
    <div class="tabs">
      <button class="tab" data-tab="general">Informação Geral</button>
      <button class="tab" data-tab="branding">Branding</button>
      <button class="tab" data-tab="foundations">Fundamentos da Marca</button>
      <button class="tab" data-tab="voice">Tom de Voz</button>
      <button class="tab" data-tab="audience">Audiência</button>
    </div>
    <div id="home-body"></div>`;
  $$('.tab').forEach((t) => t.addEventListener('click', () => { state.homeTab = t.dataset.tab; renderHome(); }));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.homeTab));
  if (state.homeTab === 'branding') renderBranding();
  else if (state.homeTab === 'foundations') renderFundamentos();
  else if (state.homeTab === 'voice') renderTom();
  else if (state.homeTab === 'audience') renderAudience();
  else renderGeneral();
}

const BRAND = {
  visuais: ['🌸 Flores', '📚 Livros ou cadernos', '☕️ Chávena de café com leite', '💻 MacBook, iPad ou iPhone', '☀️ Espaços iluminados com luz natural e sombras', '🏛️ Arquitetura antiga'],
  emojis: '🏛️ 🤌🏻 ☕️ 🗝️ 💸 ⏱️ 😮‍💨 🖋️ 🤞🏻 ⏳ 🔏 🔍 🔓 🤎',
  sensacao: 'Sofisticação serena com intimidade. A marca transmite calma, elegância e profundidade, o sentido de segurança de quem já caminhou o caminho. Há humanidade e vulnerabilidade honesta, mas sempre com compostura. É como estar numa conversa particular com alguém em quem se confia, numa sala iluminada por luz natural, onde se pode falar de dificuldades sem perder a dignidade.',
  dominantes: [
    'Estética claustral: arquitetura antiga, espaços introspetivos, luz natural que cria sombra e drama',
    'Minimalismo editorial: ordem, branco, espaço em branco generoso',
    'Toques de sensualidade: mãos, flores, texturas em primeiro plano (pele, tecidos, papel)',
    'Tons terra e ouro: reminiscência de antiguidade, valor, profundidade',
    'Movimento contido: silhuetas, perfis, gestos que sugerem ação mas com controlo',
  ],
  maisQue: [
    ['Discreta, mas marcante', 'Não grita, mas deixa marca profunda. Elegância que não precisa de anunciar a sua presença.'],
    ['Minimalista com expressão', 'Cada elemento visual é escolhido com propósito. Não há excessos, mas há personalidade em cada detalhe.'],
    ['Neutra na forma, ousada na mensagem', 'Visual contido e sofisticado, comunicação corajosa, honesta e desafiadora do status quo.'],
    ['Acessível, mas aspiracional', 'Sente-se como algo que se pode alcançar, mas que levanta o nível. Não intimida, inspira.'],
  ],
  cores: [
    ['Branco sujo', '#F2F2F2'], ['Bege', '#E8E3DF'], ['Rosa', '#C8A49F'], ['Rosa velho', '#8F5B5F'], ['Castanho escuro', '#190506'],
  ],
  variacoes: [
    ['50', '#F5EFF0'], ['100', '#EBE0E1'], ['200', '#D7C1C3'], ['300', '#C3A2A4'], ['400', '#AF8386'], ['500', '#9C6368'],
    ['600', '#7C5053'], ['700', '#5D3C3E'], ['800', '#3E282A'], ['900', '#1F1415'], ['950', '#160E0F'],
  ],
  fontes: [
    ['Fonte principal', 'Ethereal', 'Títulos'],
    ['Fonte secundária', 'TT Drugs', 'Corpo de texto'],
    ['Fonte de apoio', 'Royal Fortune Script', 'Detalhes e informações em destaque'],
  ],
  imagem: {
    estilo: 'Cinematografia de luz natural e sombra, com referências a fotografia europeia, pintura clássica e editorial de moda de luxo.',
    tecnica: [
      'Paleta: tons quentes (terra, ouro, sépia) e frios (cinzento-azulado, verde profundo), com muito branco/creme',
      'Luz: lateral e dramática, com contraste claro entre luz e sombra; final de tarde ou pouco depois do amanhecer',
      'Profundidade de campo seletiva: detalhes focados, fundo desfocado',
      'Composição simétrica ou pela regra dos terços, com espaço negativo abundante; close-ups e detalhes, não planos gerais',
      'Texturas visíveis: pele, papel, tecido, pedra, flores',
      'Movimento estático ou contido (gestos, silhuetas)',
    ],
    sim: [
      'Close-ups de mãos (a fazer unhas, a folhear um livro, a tocar em texturas)',
      'Detalhes de flores, sobretudo rosas, peónias e flores secas',
      'Objetos do quotidiano iluminados: chávena de café com leite, caderno aberto, caneta, livro',
      'Arquitetura e espaços: interiores clássicos, corredores antigos, portas, janelas, escadas',
      'Retratos e silhuetas de perfil, com luz lateral e emoção subtil',
      'Texturas abstratas: pano, papel, padrões, sombras em paredes',
      'Composições estáticas: mesa com objetos, flat lays, arranjos naturais',
      'Luz natural em janelas: sombras projetadas, cortinas semitransparentes, vidro',
      'Natureza contida: flores em vasos, plantas dentro de casa',
      'Preto e branco ou sépia, para momentos de maior introspeção ou dramatismo',
    ],
    nao: [
      'Cor muito saturada ou vibrante (cores primárias puras, arco-íris, néon)',
      'Flash direto ou luz artificial muito clara',
      'Planos gerais ou paisagens abertas',
      'Pessoas a sorrir muito ou expressões exageradas',
      'Cenários apinhados ou caóticos',
      'Marcas de água, logótipos ou textos sobrepostos',
      'Selfies em ângulo baixo ou muito próximas',
      'Produtos em primeiro plano sem contexto',
      'Efeito vintage artificial ou filtros que simulam antiguidade',
      'Praia tropical, néon ou cenários muito “instagramáveis”',
    ],
  },
  elementos: {
    usados: [
      'Flores simples, sobretudo rosa e peónia: a preto e branco, aguarela ou fotografia natural',
      'Linhas finas e geométricas para separar secções, nunca para decorar',
      'Símbolos tipográficos: travessões, vírgulas, parênteses curvos, aspas',
      'Molduras subtis: quadrados e retângulos de proporção clássica',
      'Texturas de papel, linho e mármore, como fundo ou overlay subtil',
      'Sombras projetadas, que criam profundidade e dramatismo',
      'Espaço em branco generoso, que é um elemento visual em si',
      'Pequenos objetos ilustrados ou fotográficos: um livro aberto, uma chávena vista de cima, uma folha',
    ],
    recorrentes: [
      'Flores (rosas e peónias) em 30-40% dos posts',
      'Luz natural e sombra em praticamente todas as imagens',
      'Tonalidades terra e ouro como cor dominante',
      'Texto integrado na imagem, em Symphony ou TT Drugs, sobre branco/creme',
      'Um objeto-símbolo recorrente (livro, chávena, caneta específica)',
      'Composição minimalista: 1 a 3 elementos principais por imagem',
      'Proporções clássicas: quadrado para o Instagram, composição equilibrada',
      'Marcas de autenticidade: mão visível, imperfeições naturais, real e não perfeito',
    ],
    nao: [
      'Clipart, emojis grandes ou GIFs',
      'Múltiplas cores saturadas',
      'Fontes pixel, bubbly ou infantis',
      'Brilhos, glitter ou efeitos metalizados',
      'Elementos que competem com a imagem',
      'Padrões repetitivos ou muito geométricos (mandala, caleidoscópio)',
      'Marcas de água com logótipo grande',
      'Molduras pesadas ou ornamentadas',
      'Ilustrações cartoon ou de estilo muito informal',
    ],
  },
  pinterest: 'https://pt.pinterest.com/aliciacarinaba/al%C3%ADcia-c/moodboard/',
};

const FUND = {
  missao: 'Educar estilistas de unhas e profissionais de beleza em Portugal a profissionalizarem os seus negócios através de uma precificação honesta e justa, gestão financeira na prática, formas de rendimento na área da beleza, conhecimento teórico sobre anatomia e saúde ungueal, técnicas de nail art simples, fáceis e rápidas de aplicar, e técnicas de estilismo de unhas naturais e saudáveis, reconhecendo tanto os desafios reais como o potencial de evolução nesta área.',
  quem: 'Estilistas de unhas e profissionais de beleza que exercem em Portugal, tanto iniciantes que precisam de estruturar o negócio desde o início como profissionais experientes.',
  resolver: [
    'Insegurança na precificação e medo de perder clientes ao aumentar preços',
    'Falta de clareza sobre custos reais e ganho por hora',
    'Dificuldade em profissionalizar o negócio (organização, gestão, estrutura)',
    'Bloqueios emocionais (culpa, medo, síndrome do impostor)',
    'Falta de conhecimentos científicos sobre anatomia e saúde ungueal (anatomia, doenças comuns, alergias…)',
    'Falta de evolução em técnicas de mesa (baby boomer, ombré, manicure combinada, verniz de gel com nivelamento)',
  ],
  servicos: [
    ['Formação online e infoprodutos de gestão financeira', 'precificação, tabelas Excel, cálculos de custos'],
    ['Formação em técnicas utilizadas em mesa', 'técnicas teóricas e práticas'],
    ['Conteúdo educativo', 'reels, posts e stories sobre dinheiro, técnica e realidade do setor'],
    ['Acompanhamento em grupo', 'formações, comunidade, suporte'],
    ['Ferramentas práticas', 'tabelas, guias, templates…'],
  ],
  visao: 'Ser a referência portuguesa em educação financeira e profissionalização para o setor da beleza, através de um movimento de honestidade total sobre os desafios e oportunidades reais dos negócios desta área.',
  reconhecida: [
    ['Transparência', 'sobre dinheiro e dificuldades do setor (sem romantização)'],
    ['Expertise dupla', 'excelência técnica + educação financeira'],
    ['Abordagem psicológica', 'reconhecer bloqueios emocionais e oferecer formas de superação ou sugestões para a resolução, não só dar informação'],
    ['Ferramentas práticas e reais', 'que as profissionais conseguem aplicar imediatamente'],
    ['Comunidade de profissionais empoderadas', 'que cobram o que merecem, que tomam as rédeas do seu negócio, com limites e regras bem definidos, sem culpa e com a consciência tranquila por entregarem um serviço que respeita a saúde das clientes'],
  ],
  impacto: 'Transformar a realidade económica de estilistas de unhas em Portugal, ao mostrar que é possível viver de forma sustentável desta profissão quando se une técnica, precificação e profissionalização. Desconstruir mitos sobre negócios na área da beleza e criar uma cultura onde ganhar bem não é culpa, é responsabilidade. Consciencializar tanto profissionais como clientes sobre os perigos para a saúde que podem surgir por más práticas em salão e entregar dados reais, com base científica, sobre como agir e o que fazer em cada situação.',
  valores: [
    ['Transparência', 'Falar a verdade sobre dinheiro, dificuldades e realidades do setor sem medo (em particular da minha experiência pessoal e daquilo que vejo das minhas alunas e pessoas que me rodeiam).',
      'Nomear o desconfortável. Basear-me em factos, em matemática e não romantizar a realidade. Se é bom, perfeito; se não é, há que explicar porque não é. “Ganhas 10€ e gastas 8€ em material?” Isto é insustentável. Não mascarar com palavras bonitas.',
      'Publicações e partilhas sobre quanto deves cobrar, com exemplos e cálculos reais. Partilha da minha experiência e do processo que eu própria passo para precificar os meus serviços e produtos. Partilha de exemplos pessoais e de alunas, ou de testemunhos que me chegam através das redes sociais.',
      'Com explicações teóricas e contextualizadas extensivas de cada assunto, sempre acompanhadas de exemplos concretos. No caso das tabelas Excel, através de cálculos baseados nos valores que eu (ou as alunas) colocarem nas tabelas: a partir do momento em que são valores reais, os cálculos feitos pelas tabelas não têm como enganar.'],
    ['Honestidade com empatia', 'Reconhecer sempre emoções e bloqueios antes de apresentar soluções.',
      'Nunca dar informação sem primeiro validar o sentimento. “Eu percebo. Isto é difícil. Aqui está uma forma de o resolvermos.”',
      'Perguntas que criam reflexão. Partilha de histórias e experiências pessoais. Reflexão sobre os assuntos que demonstra claramente que pensei sobre isso e que me tentei colocar naquele lugar. Expressões como “Eu também passei por isto”. Nunca soar como um “guru” desligado, que fala, fala, fala, mas não compreende realmente o que está a acontecer com os outros ou sugere coisas sem pensar no que a pessoa pode estar a sentir ou a ultrapassar.',
      'Espaço para fazer perguntas e partilhar dificuldades. Abertura para reconhecer que ninguém começa com perfeição e que os erros são normais e expectáveis. Reconhecimento de que bloqueios emocionais e mentais são normais. Partilha de estratégias que me ajudaram a ultrapassar esses mesmos erros e bloqueios, ou que acredito que possam ajudar em cada caso.'],
    ['Prática e consistência ao invés de perfeição', 'Mais vale feito do que perfeito.',
      'Algo colocado em prática, que saiu do papel, vale mais do que algo perfeito que nunca é publicado ou aplicado.',
      'Exemplos de dúvidas e dificuldades que eu própria tive, e como as ultrapassei colocando em prática, testando e melhorando a cada vez. Exemplos de erros que eu cometi, ou que vi colegas cometerem, e como podem ser resolvidos se as pessoas colocarem em prática aquilo que explico. Exemplos concretos de soluções, técnicas, conselhos e estratégias que podem ajudar a superar isso e como aplicar na prática. Mostrar trabalhos antigos e a evolução até agora.',
      'Reforço de que pode parecer difícil, pode ser um trabalho chato, mas que só quando for aplicado na prática vai melhorar. Incentivo à autoavaliação e à autocrítica como forma de evolução e superação de dificuldades.'],
    ['Responsabilidade pessoal', 'Reconhecer que não é culpa de “ninguém”, mas que agir, tomar iniciativa e mudar depende de cada pessoa.',
      '“Não é culpa tua ter bloqueios, eles existem para toda a gente. Mas é da tua responsabilidade enfrentá-los e tentar superá-los. Se não o fizeres por ti mesma, ninguém o fará.”',
      'Não ser vitimista. “A tua zona não deixa” é uma crença, não uma verdade. O meu discurso deixa claro que não tolero desculpas e que elas não levam ninguém ao sucesso. Se o discurso de alguém é de vitimização e a pessoa não está disposta a mudar, não é bem-vinda e não posso fazer nada para ajudar. Só quem se quer responsabilizar pelos seus próprios comportamentos poderá ser ajudado e será verdadeiramente acolhido por mim.',
      'Formações com tarefas e ações. Desafios para aplicar. Não é passiva, é participativa. Se as alunas não quiserem evoluir, não vou ser eu a andar atrás delas. Eu dou as ferramentas de que precisam e elas ficam responsáveis pelo que fazem com isso.'],
    ['Excelência dupla', 'Técnicas de excelência, que não comprometem a saúde da cliente e que são exequíveis em salão (nada de técnicas irrealistas, que exigem excesso de material, publicitação de produtos e materiais desnecessários, técnicas que demoram mais de 3-4h a fazer, técnicas de competição ou fantasiosas) e consciencialização financeira.',
      'Nunca separar técnica de finanças. Não sou só coach de preços, sou formadora de estilistas de unhas. Não sou só formadora de unhas, trabalho gestão e falo sobre negócios.',
      'Os conteúdos estão sempre conectados de alguma forma: posso falar de uma técnica ou de um produto em particular, mas existirá outro conteúdo com a mesma técnica ou produto, onde mostro como rentabilizar ou qual o custo do mesmo. Existirão conteúdos sobre compras a evitar e compras que fazem sentido. Não falo só de produtos ou técnicas, mostro porque podem ou não fazer sentido para cada caso e cada profissional.',
      'Mostro os produtos que uso e explico o porquê; trago sugestões de produtos mais ou menos acessíveis, com base nos diferentes objetivos que as alunas possam ter. Quando ensino a precificar, mostro como podem calcular o valor que gastam com os seus próprios produtos e dou sugestões de onde podem ganhar mais dinheiro ou poupar.'],
    ['Psicologia aplicada', 'Reconhecer que muitos bloqueios são emocionais, não técnicos, e que é possível ultrapassá-los.',
      'A minha formação em Psicologia permite-me compreender e explicar como funcionam os processos mentais e comportamentais das pessoas. Permite-me reconhecer quando as dificuldades são técnicas ou mentais.',
      'Nomeio bloqueios (culpa, síndrome do impostor, medo, frustração…), identifico padrões e sugiro pequenas alterações, outras formas de pensar ou olhar para um assunto, ou estratégias para lidar com as dificuldades e eventualmente superá-las.',
      'Parte da solução é compreender padrões de pensamento e como afetam os nossos comportamentos. Por isso, trago muitas vezes para as formações esta identificação e consciencialização, e depois apresento soluções ou estratégias que podem ajudar em cada caso.'],
    ['Sem romantização', 'Mostrar o lado difícil juntamente com o potencial (nem tudo é mau, mas nem tudo é um mar de rosas).',
      'Nem tudo é bom e nem tudo é mau. Tudo tem as suas vantagens e desvantagens, e o que funciona com uma pessoa pode não funcionar com outra. Não existem cenários perfeitos para ninguém em nenhuma situação.',
      'Não trago verdades absolutas e deixo sempre claro que cabe a cada um decidir o que faz ou não sentido para si. Trago factos e números reais, trago a minha realidade, e aquilo que transmito baseia-se na minha experiência e no que partilham comigo, deixando claro que não é regra, é apenas a forma como eu vejo e giro a minha realidade.',
      'Explico como as coisas funcionam na teoria, qual a minha experiência, partilho outras experiências que possam fazer sentido para cada caso, e dou potenciais estratégias e ferramentas para cada pessoa utilizar com base nos seus objetivos e crenças.'],
  ],
  sempre: [
    ['Validar a emoção antes de oferecer solução', 'a ligação, o reconhecimento e a empatia para com as pessoas e as suas emoções vêm sempre antes da solução'],
    ['Usar números reais', 'nunca falo em achismos nem em números inventados; falo de €, horas e percentagens concretas, sempre com recurso a exemplos'],
    ['Ser honesta sobre dificuldades', 'partilhar o lado real, sem romantizar nem fazer promessas vãs'],
    ['Combinar técnica com gestão', 'uma não existe sem a outra'],
    ['Oferecer ferramentas práticas', 'tabelas, scripts, passo a passo que funcionam'],
    ['Reconhecer bloqueios psicológicos', '“Não é culpa, mas responsabilidade”'],
    ['Usar português europeu em Portugal', 'tu, te, teu, MB Way, preços em euros'],
  ],
  nunca: [
    ['Romantizar a profissão', 'nunca “está tudo bonito e fácil”'],
    ['Usar jargão vazio', 'sem “empoderamento”, “transformação garantida”, “game changer”'],
    ['Oferecer falsas promessas', 'sem “fica rica”, “não precisas de trabalhar mais”, “100% garantido”'],
    ['Ignorar o lado emocional', 'nunca usar apenas informação “fria”, sempre com humanidade e empatia'],
    ['Ser superficial', 'o conteúdo é aprofundado, real, com camadas'],
    ['Usar género neutro ou “vocês”', 'falo em tu, diretamente'],
    ['Falar sem dados', 'tudo se baseia em padrões, notícias, estudos ou tendências que vi ou li, não em opinião vaga sem fundamento'],
  ],
  naoNegocio: [
    ['Cobrar por formações em que não acredito', 'os meus produtos existem porque tenho a certeza de que funcionam (testei e usei antes de vender)'],
    ['Deixar de ser honesta para vender', 'sem apelo emocional falso, sem hype'],
    ['Trabalhar com profissionais desalinhadas', 'não quero clientes que só querem “ficar ricas” ou que têm expectativas muito desalinhadas com a realidade'],
    ['Expandir para áreas que não são o meu foco', 'não vendo maquilhagem, lifestyle vago, etc.'],
    ['Aceitar que as minhas alunas romantizem a profissão', 'educo para o realismo, não para a ilusão'],
    ['Contribuir para mitos prejudiciais do setor', 'nunca digo “uns cobram 5€ e estão bem” quando não estão, nem sugiro que existe uma fórmula mágica que funciona com toda a gente'],
    ['Oferecer “atalhos”', 'não há trabalho fácil, dados adquiridos nem ganhos sem esforço'],
  ],
};

function renderFundamentos() {
  const F = FUND;
  const ul = (l) => `<ul class="brand-list">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const ol = (l) => `<ol class="brand-list">${l.map(([t, d]) => `<li><strong>${esc(t)}</strong>${d ? ' — ' + esc(d) : ''}</li>`).join('')}</ol>`;
  $('#home-body').innerHTML = `
    <div class="brandpage">
      <div class="card"><h3>1. Missão da marca</h3>
        <div class="stat-l">A minha missão é</div><p>${esc(F.missao)}</p>
        <div class="stat-l">Quem é que eu ajudo?</div><p>${esc(F.quem)}</p>
        <div class="grid cols-2">
          <div><div class="stat-l">O que é que eu ajudo a resolver</div><ol class="brand-list">${F.resolver.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
          <div><div class="stat-l">Através de quê? (serviços)</div>${ol(F.servicos)}</div>
        </div>
      </div>

      <div class="card"><h3>2. Visão da marca</h3>
        <div class="stat-l">A minha visão é</div><p>${esc(F.visao)}</p>
        <div class="stat-l">No futuro, a minha marca será reconhecida por</div>${ol(F.reconhecida)}
        <div class="stat-l">Qual o impacto que quero gerar</div><p>${esc(F.impacto)}</p>
      </div>

      <div class="card"><h3>3. Valores da marca</h3>
        <div class="grid cols-2">${F.valores.map(([t, d, p, c, pr], i) => `
          <div class="brand-box"><strong>Valor ${String(i + 1).padStart(2, '0')}: ${esc(t)}</strong><p>${esc(d)}</p>
            <div class="stat-l">O que significa na prática</div><p>${esc(p)}</p>
            <div class="stat-l">Como aparece no meu conteúdo</div><p>${esc(c)}</p>
            <div class="stat-l">Como aparece nos meus produtos</div><p>${esc(pr)}</p>
          </div>`).join('')}</div>
      </div>

      <div class="card"><h3>4. Código da marca</h3>
        <div class="grid cols-3">
          <div><div class="stat-l">O que a minha marca faz sempre</div>${ol(F.sempre)}</div>
          <div><div class="stat-l">O que a minha marca nunca faz</div>${ol(F.nunca)}</div>
          <div><div class="stat-l">O que não negoceio, mesmo que traga dinheiro</div>${ol(F.naoNegocio)}</div>
        </div>
      </div>
    </div>`;
}

// ---------- Audiência ----------
const AU = { data: null, updated: null, loading: false, loaded: false, sec: 'resumo', bucket: 'duvidas' };
const AU_SECS = [['resumo', 'Resumo'], ['pesquisa', 'Pesquisa'], ['linguagem', 'Linguagem'], ['conteudo', 'Conteúdo']];
const AU_COLORS = ['#8F5B5F', '#C8A49F', '#5D3C3E', '#AF8386', '#D7C1C3'];
const AU_BUCKETS = { duvidas: ['❓', 'Dúvidas', 'perguntas diretas'], dores: ['💔', 'Dores', 'frustrações e bloqueios'], objecoes: ['🚧', 'Objeções', 'o que as faz hesitar'], desejos: ['✨', 'Desejos', 'o que querem alcançar'], pedidos: ['📩', 'Pedidos e palavras-chave', 'comentários de ação'] };
const AU_WD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const AU_HR = ['0–4h', '4–8h', '8–12h', '12–16h', '16–20h', '20–24h'];
const AU_RESEARCH = {
  dores: ['Não sei quanto cobrar pelo meu trabalho', 'Tenho medo de perder clientes se aumentar os preços', 'Trabalho muito e no final do mês não fica quase nada', 'Não sei se estou a ganhar ou a perder dinheiro', 'Sinto que não consigo profissionalizar o meu negócio'],
  desejos: ['Viver exclusivamente do estilismo de unhas de forma sustentável', 'Ter um negócio organizado e profissional, não apenas um biscate', 'Cobrar o que o trabalho vale sem culpa', 'Ter estabilidade financeira e não depender de mês para mês', 'Evoluir nas técnicas e destacar-me pela qualidade e não pelo preço'],
  objecoes: ['Os preços das formações são altos para o que ganho', 'Não sei se vou conseguir aplicar o que aprendo', 'Já vi muita coisa online de graça, não sei se vale a pena pagar', 'Tenho medo de investir e não ter retorno', 'A minha zona não tem mercado para cobrar mais caro'],
  linguagem: ['“Estou a começar”', '“Ainda estou a dar os primeiros passos”', '“A minha zona não deixa”', '“Aqui as pessoas não pagam”', '“Trabalho muito mas não consigo escalar”', '“Adoro o que faço mas não sei gerir o negócio”', '“Quero ser profissional a sério”'],
  surpresas: [['🧠', 'A insegurança no preço não desaparece com o tempo', 'Estilistas com anos de experiência têm as mesmas dores das iniciantes: desaparece com formação.'], ['💭', 'O bloqueio é emocional, não técnico', 'Muitas sabem que cobram pouco, mas travam por dentro.'], ['🔎', 'Há abertura para conteúdo honesto', 'A audiência valoriza a transparência sobre o lado difícil do negócio.']],
  contexto: [['👩', 'Maioritariamente mulheres a exercer em Portugal'], ['🌱', 'Mix de iniciantes (menos de 2 anos) e estabelecidas (3-5+ anos)'], ['🏠', 'Por conta própria, muitas em casa ou em espaços alugados'], ['📱', 'Consomem sobretudo Instagram e TikTok'], ['🪞', 'Valorizam criadores que mostram a realidade, sem filtros excessivos']],
  resultados: ['Aumentar os preços sem perder clientes', 'Perceber quanto ganham por hora/serviço', 'Ter uma tabela de preços com sentido financeiro', 'Sentir confiança ao apresentar os preços', 'Ter o negócio organizado com ferramentas práticas'],
};

async function loadAudience() {
  if (!sb) { AU.loaded = true; return; }
  try {
    const { data } = await sb.from('ig_audience').select('data, updated_at').eq('id', 'main').maybeSingle();
    if (data) { AU.data = data.data; AU.updated = data.updated_at; }
  } catch (e) { console.error(e); }
  AU.loaded = true;
}

async function runAudience() {
  if (!sb) return toast('Liga o Instagram e o Supabase para atualizar a audiência.', true);
  if (AU.loading) return;
  AU.loading = true; drawAudience();
  try {
    const r = await sb.functions.invoke('ig-audience');
    const err = r.error?.message || r.data?.error;
    if (err) throw new Error(err);
    AU.data = r.data.data; AU.updated = r.data.updated_at;
    toast('Audiência atualizada.');
  } catch (e) { console.error(e); toast('Não foi possível atualizar a audiência. Tenta outra vez daqui a pouco.', true); }
  AU.loading = false;
  if (state.route === 'home' && state.homeTab === 'audience') drawAudience();
}

async function renderAudience() {
  $('#home-body').innerHTML = '<div class="card empty" style="margin-top:16px"><p>A carregar…</p></div>';
  if (!AU.loaded) await loadAudience();
  if (state.route === 'home' && state.homeTab === 'audience') drawAudience();
}

// --- pequenos componentes gráficos ---
const auPct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
function hbars(rows, { suffix = '', max, color = 'var(--accent)' } = {}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="au-bars">${rows.map((r) => `
    <div class="au-bar"><span class="au-bar-l">${esc(r.label)}</span>
      <span class="au-bar-t"><span class="au-bar-f" style="width:${Math.max(2, (r.value / m) * 100)}%;background:${r.color || color}"></span></span>
      <span class="au-bar-v">${r.text ?? fmt(r.value) + suffix}</span></div>`).join('')}</div>`;
}
function donut(items, centerTop, centerBottom) {
  const tot = items.reduce((s, i) => s + i.value, 0) || 1;
  let acc = 0;
  const stops = items.map((i, k) => { const a = (acc / tot) * 100; acc += i.value; return `${AU_COLORS[k % 5]} ${a}% ${(acc / tot) * 100}%`; });
  return `<div class="au-donut-wrap">
    <div class="au-donut" style="background:conic-gradient(${stops.join(',')})"><div><strong>${esc(centerTop)}</strong><span>${esc(centerBottom)}</span></div></div>
    <div class="au-legend">${items.map((i, k) => `<div><span class="au-dot" style="background:${AU_COLORS[k % 5]}"></span>${esc(i.label)} <strong>${i.text ?? auPct(i.value, tot) + '%'}</strong></div>`).join('')}</div></div>`;
}
const auStat = (icon, label, value, sub) => `<div class="card au-kpi"><div class="au-ico">${icon}</div><div class="stat-l">${esc(label)}</div><div class="stat-n">${value}</div><div class="muted small">${sub ?? ''}</div></div>`;

function drawAudience() {
  const body = $('#home-body'); if (!body) return;
  const d = AU.data;
  const age = AU.updated ? Math.floor((Date.now() - Date.parse(AU.updated)) / 864e5) : null;
  const head = `
    <div class="au-head">
      <div>${AU.updated ? `<strong>Atualizado em ${fmtDateTime(AU.updated)}</strong> <span class="chip ${age > 7 ? 'au-warn' : ''}">${age > 7 ? `Desatualizado há ${age} dias` : 'Em dia'}</span>` : '<strong>Ainda sem dados</strong>'}
        <div class="muted small">Atualização automática todas as segundas-feiras. Também podes atualizar já.</div></div>
      <button class="btn primary" id="au-refresh" ${AU.loading ? 'disabled' : ''}>${AU.loading ? 'A atualizar…' : '↻ Atualizar'}</button>
    </div>
    <div class="au-pills">${AU_SECS.map(([k, l]) => `<button class="au-pill ${AU.sec === k ? 'active' : ''}" data-sec="${k}">${l}</button>`).join('')}</div>`;
  let inner;
  if (AU.sec === 'pesquisa') inner = auPesquisa();
  else if (!d) inner = `<div class="card empty"><div class="big">🎯</div><h2>${sb ? 'Ainda não há análise de audiência' : 'Liga o Instagram para ver a audiência'}</h2><p>${sb ? 'Carrega em “Atualizar” para analisar os comentários do teu perfil.' : 'Em modo de teste local não há dados do Instagram.'}</p></div>`;
  else inner = { resumo: auResumo, linguagem: (x) => auDizem(x) + auLinguagem(x), conteudo: auConteudo }[AU.sec](d);
  body.innerHTML = `<div class="au">${head}${inner}</div>`;
  $('#au-refresh')?.addEventListener('click', runAudience);
  $$('.au-pill').forEach((b) => b.addEventListener('click', () => { AU.sec = b.dataset.sec; drawAudience(); }));
  $$('.au-bk').forEach((b) => b.addEventListener('click', () => { AU.bucket = b.dataset.bk; drawAudience(); }));
}

function auResumo(d) {
  const A = d.audience, B = A.buckets, own = d.profiles[0], L = d.topic_labels;
  const bestF = own.formats[0], tt = A.topics[0];
  const heat = d.heat; let bd = null;
  heat.forEach((r, i) => r.forEach((v, j) => { if (v != null && (!bd || v > bd.v)) bd = { v, i, j }; }));
  const types = Object.entries(B).map(([k, v]) => ({ label: v.label, value: v.count }));
  return `
    <div class="grid cols-4">
      ${auStat('💬', 'Comentários analisados', fmt(A.comments_analyzed), `de ${fmt(A.comments_total)} lidos nos últimos posts`)}
      ${auStat('❓', 'Dúvidas', fmt(B.duvidas.count), `${B.duvidas.share}% dos comentários`)}
      ${auStat('🏷️', 'Tema mais falado', tt ? esc(L[tt.key]) : '—', tt ? `${fmt(tt.n)} comentários` : '')}
      ${auStat('🎬', 'Melhor formato', bestF ? esc(bestF.format) : '—', bestF ? `${fmt(bestF.avg)} interações por post` : '')}
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Que tipo de mensagens deixam</h3>
        ${donut(types, fmt(A.comments_analyzed), 'comentários')}</div>
      <div class="card"><h3>Sobre o que falam</h3>
        ${A.topics.length ? hbars(A.topics.slice(0, 8).map((t) => ({ label: L[t.key], value: t.n })), { suffix: '' }) : '<p class="muted">Sem temas detetados.</p>'}</div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Temas que geram mais interação</h3><p class="muted small">Interações por post em % dos seguidores, nos posts que falam de cada tema.</p>
        ${d.topics_eng.length ? hbars(d.topics_eng.slice(0, 8).map((t) => ({ label: t.label, value: t.own ?? 0, text: (t.own ?? 0).toFixed(2).replace('.', ',') + '%' }))) : '<p class="muted">Sem dados.</p>'}</div>
      <div class="card"><h3>Melhor momento para publicar</h3>
        ${bd ? `<div class="au-best"><strong>${AU_WD[bd.i]}</strong><span>${AU_HR[bd.j]}</span></div><p class="muted small">${bd.v.toFixed(1).replace('.', ',')}× a interação média. Vê o mapa completo em “Conteúdo”.</p>` : '<p class="muted">Sem dados.</p>'}</div>
    </div>`;
}

function auDizem(d) {
  const A = d.audience, L = d.topic_labels, cur = A.buckets[AU.bucket];
  const cards = Object.entries(AU_BUCKETS).map(([k, [ic, lb, sub]]) => {
    const b = A.buckets[k];
    return `<button class="card au-bk ${AU.bucket === k ? 'sel' : ''}" data-bk="${k}"><div class="au-ico">${ic}</div><div class="stat-l">${lb}</div><div class="stat-n">${b.share.toString().replace('.', ',')}%</div><div class="muted small">${fmt(b.count)} comentários · ${sub}</div></button>`;
  }).join('');
  const [ic, lb] = AU_BUCKETS[AU.bucket];
  return `
    <div class="grid cols-5 au-bks">${cards}</div>
    <div class="grid cols-2">
      <div class="card"><h3>${ic} ${lb}: sobre que temas</h3>
        ${cur.topics.length ? hbars(cur.topics.map((t) => ({ label: L[t.key], value: t.n }))) : '<p class="muted">Ainda não há comentários suficientes desta categoria para identificar temas.</p>'}</div>
      <div class="card"><h3>Exemplos reais</h3>
        ${cur.samples.length ? `<div class="au-quotes">${cur.samples.slice(0, 6).map((s) => `<blockquote>${esc(s)}</blockquote>`).join('')}</div>` : '<p class="muted">Sem exemplos nesta categoria. Faz sentido: quanto menos comentários, menos padrões.</p>'}</div>
    </div>`;
}

function auHeat(heat) {
  const mx = Math.max(0.01, ...heat.flat().filter((v) => v != null));
  return `<div class="au-heat"><div></div>${AU_HR.map((h) => `<div class="au-hh">${h}</div>`).join('')}
    ${heat.map((row, i) => `<div class="au-hh">${AU_WD[i]}</div>${row.map((v, j) => `<div class="au-hc" title="${AU_WD[i]} ${AU_HR[j]}: ${v == null ? 'sem posts' : v.toFixed(1).replace('.', ',') + '× a média'}" style="${v == null ? '' : `background:rgba(143,91,95,${(0.12 + 0.88 * (v / mx)).toFixed(2)});color:${v / mx > 0.55 ? '#fff' : 'var(--text)'}`}">${v == null ? '' : v.toFixed(1).replace('.', ',')}</div>`).join('')}`).join('')}</div>`;
}
function auPosts(list) {
  return `<div class="au-posts">${list.map((p) => `<a class="au-post" href="${esc(p.permalink)}" target="_blank" rel="noopener">
    <span class="au-thumb" style="${p.thumb ? `background-image:url('${esc(p.thumb)}')` : ''}"></span>
    <span class="au-post-b"><strong>❤ ${fmt(p.likes)} · 💬 ${fmt(p.comments)}</strong><span class="muted small">${fmtDate(String(p.ts).slice(0, 10))}</span></span></a>`).join('')}</div>`;
}

function auConteudo(d) {
  const own = d.profiles[0];
  return `
    <div class="grid cols-2">
      <div class="card"><h3>Interações por formato</h3><p class="muted small">Média de gostos + comentários por post.</p>
        ${hbars(own.formats.map((f) => ({ label: `${f.format} (${f.n})`, value: f.avg })))}</div>
      <div class="card"><h3>Hashtags mais usadas</h3>
        ${own.hashtags.length ? `<div class="au-tags">${own.hashtags.map((h) => `<span class="chip">${esc(h.tag)} <small>${h.n}</small></span>`).join('')}</div>` : '<p class="muted">Poucas hashtags nos teus posts.</p>'}
        <div class="stat-l" style="margin-top:16px">Ritmo de publicação</div><div class="stat-n">${own.posts_per_week != null ? String(own.posts_per_week).replace('.', ',') : '—'}<small class="muted"> posts/semana</small></div></div>
    </div>
    <div class="card"><h3>Mapa de calor: quando a interação é maior</h3>
      <p class="muted small">Cada célula mostra quantas vezes a interação do post ficou acima (ou abaixo) da média. Quanto mais escuro, melhor. Hora de Portugal. Com poucos posts por célula, usa como indicação.</p>
      ${auHeat(d.heat)}</div>
    <div class="card"><h3>Os teus posts com mais interação</h3>${auPosts(own.best)}</div>`;
}

function auLinguagem(d) {
  const A = d.audience, mx = Math.max(1, ...A.words.map((w) => w.n));
  const cloud = A.words.slice(0, 40).map((w) => `<span class="au-w" style="font-size:${(13 + (w.n / mx) * 22).toFixed(0)}px;opacity:${(0.55 + 0.45 * (w.n / mx)).toFixed(2)}" title="${w.n}×">${esc(w.w)}</span>`).join('');
  return `
    <div class="grid cols-2">
      <div class="card"><h3>Palavras mais usadas</h3><div class="au-cloud">${cloud || '<p class="muted">Sem dados.</p>'}</div></div>
      <div class="card"><h3>Palavras-chave comentadas</h3><p class="muted small">Comentários curtos que pedem algo (ex.: o código de uma campanha).</p>
        ${A.keywords.length ? hbars(A.keywords.map((k) => ({ label: k.k, value: k.n }))) : '<p class="muted">Sem palavras-chave repetidas.</p>'}</div>
    </div>
    <div class="grid cols-2">
      <div class="card"><h3>Emojis da audiência</h3><div class="au-emojis">${A.emojis.map((e) => `<span title="${e.n}×"><b>${e.e}</b><small>${e.n}</small></span>`).join('') || '<p class="muted">Sem emojis.</p>'}</div></div>
      <div class="card"><h3>Expressões que se repetem</h3>
        ${A.phrases.length ? `<div class="au-tags">${A.phrases.map((p) => `<span class="chip">${esc(p.p)} <small>${p.n}</small></span>`).join('')}</div>` : '<p class="muted">Ainda sem expressões repetidas.</p>'}</div>
    </div>`;
}

function auPesquisa() {
  const R = AU_RESEARCH;
  const col = (cls, icon, titulo, list) => `<div class="card au-col ${cls}"><h3>${icon} ${titulo}</h3><ol class="au-list">${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
  return `
    <div class="grid cols-3">
      ${col('c1', '💔', 'Dores mais mencionadas', R.dores)}
      ${col('c2', '✨', 'Desejos e sonhos', R.desejos)}
      ${col('c3', '🚧', 'Objeções que aparecem', R.objecoes)}
    </div>
    <div class="card"><h3>🗣️ Padrões de linguagem</h3><div class="au-tags">${R.linguagem.map((x) => `<span class="chip au-q">${esc(x)}</span>`).join('')}</div></div>
    <div class="grid cols-3">${R.surpresas.map(([i, t, s]) => `<div class="card au-sur"><div class="au-ico">${i}</div><strong>${esc(t)}</strong><p class="muted">${esc(s)}</p></div>`).join('')}</div>
    <div class="grid cols-2">
      <div class="card"><h3>👥 Contexto da audiência</h3><div class="au-ctx">${R.contexto.map(([i, t]) => `<div><span>${i}</span>${esc(t)}</div>`).join('')}</div></div>
      <div class="card"><h3>🎯 Resultado que esperam</h3><ol class="au-list">${R.resultados.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
    </div>
    <p class="muted small">Esta secção vem da tua pesquisa de audiência no Notion e não se atualiza sozinha.</p>`;
}

const TOM = {
  adjetivos: [
    ['Direta', 'vai direta ao ponto, sem rodeios. Entra logo na dor ou frustração, nomeando o problema pelo seu nome real. Nada de linguagem fluida ou genérica.'],
    ['Empática', 'reconhece emoções antes de dar informação. Não é “sinto o teu problema”, é validar o bloqueio (emocional, psicológico, financeiro) e reconhecer que é legítimo. Liga-se à pessoa, não ao resultado.'],
    ['Descomplicada', 'tira o jargão e torna tudo acessível. Transforma conceitos complexos (gestão financeira, psicologia do preço, técnicas de nail art) em explicações simples, com exemplos reais e, frequentemente, com humor seco português.'],
  ],
  expressoes: [
    ['“Quantas vezes já deste por ti a pensar…”', 'questão retórica que abre com empatia, criando um momento de autorreflexão na pessoa antes de revelar a verdade'],
    ['“Eu percebo…” / “Eu percebo-te…”', 'validação empática que vem SEMPRE antes da informação; nunca me atiro de cabeça à solução sem primeiro nomear o sentimento'],
    ['“Ps.” seguido de informação extra', 'confissão humorística ou curiosidade que torna o tom mais próximo e menos corporativo (ex.: “Ps. Isto é difícil de dizer em voz alta, mas…”)'],
    ['“Comenta [palavra-chave]” como CTA', 'convida à participação sem parecer venda e torna o seguidor coautor (ex.: “Comenta CÊNTIMOS se te identificas”)'],
    ['“Responde ‘quero saber mais’ a este story”', 'CTA conversacional, sem parecer que estou a empurrar, apenas deixando a porta aberta'],
    ['“A verdade é que…” / “Vou ser honesta…”', 'marca a transição da validação para a revelação honesta, frequentemente seguida de uma confissão pessoal ou de um dado real que contradiz mitos'],
    ['“Feitas bem as contas…” / “Isto vai-te custar…” / “Simples, rápido e eficaz.”', 'linguagem prática, concreta, com números; nada de abstrato'],
    ['“Hoje desafio-te a…”', 'convite ativo à ação ou reflexão, sempre para mover a pessoa, nunca só para informar'],
    ['“Observa onde consegui chegar.” / “Isto foi o que aprendi…”', 'partilha de conquista pessoal sem soar arrogante, sempre com reconhecimento do caminho e das dificuldades passadas'],
    ['“Não é culpa tua, mas só tu podes mudar, é da tua responsabilidade.”', 'frase característica de Psicologia aplicada; diferencia o que é bloqueio emocional do que é ação prática'],
  ],
  proibidas: ['Incrível', 'Transformador/a', 'Jornada', 'Empoderamento', 'Game changer', 'Autêntica (como adjetivo genérico)', 'Inspiradora (como adjetivo vago)', 'Linguagem em “você” (usar sempre “tu” e formas de segunda pessoa do singular em português europeu)', 'Falsas promessas (garantir resultados, 100%, nunca…)'],
  nunca: [
    'Usar linguagem em “você” ou “vocês” (português europeu)',
    'Usar palavras vazias como “incrível”, “transformador” ou “game changer”',
    'Ser excessivamente formal ou usar linguagem corporativa fria',
    'Apresentar a Alícia como perfeita ou como alguém que sempre soube fazer tudo: ela partilha as suas dificuldades reais',
    'Usar CTAs genéricos como “Clica no link da bio” sem contexto conversacional',
    'Fazer promessas exageradas ou usar linguagem de “guru”',
    'Ignorar o lado emocional/motivacional: o negócio e o bem-estar pessoal caminham juntos na comunicação dela',
    'Deixar tudo explicado: deve sempre haver espaço para perguntas',
    'Ser superficial: conteúdo mais intimista, real e aprofundado é a assinatura',
  ],
  sempre: [
    'Usar “tu”, “te”, “teu/tua”, “tens”: formas de segunda pessoa do singular em português europeu',
    'Partir de uma dor ou frustração real do público antes de dar a solução (estrutura empatia → educação → CTA)',
    'Começar com uma provocação, pergunta ou observação',
    'Basear a informação em dados, padrões e tendências que viu, e não em meras opiniões',
    'Incluir storytelling pessoal (experiências reais da Alícia como profissional e como pessoa)',
    'Usar exemplos práticos com números reais (valores em €, horas, quantidades) ou mostrar antes de explicar (com imagens, exemplos e/ou casos reais)',
    'Usar CTAs conversacionais e personalizados (ex.: “Comenta [palavra]”, “Responde ‘quero saber mais’ a este story”) ou que provoquem uma reflexão; não devem ser considerados um botão',
    'Escrever em português europeu (vocabulário PT, conjugações PT, referências locais como MB Way, preçário, saneamento)',
    'Equilibrar o tom educativo com o motivacional/aspiracional: conteúdo prático mas com coração',
  ],
  frases: [
    '“Estás a perder dinheiro com os teus serviços (e não é por causa do material)”',
    '“Eu odiava o baby boomer. Muitas pessoas podem acreditar que eu sempre adorei e sempre soube fazer um baby boomer… Mas isso não é verdade.”',
    '“Quantas vezes dás por ti a pensar no que ainda não tens? Naquilo que ainda te falta atingir? Quantas vezes dás por ti a comparar-te com outras colegas, com o que elas têm e que tu ainda não tens?”',
    '“O dinheiro não é tudo. Mas amor pela área não paga contas a ninguém.”',
    '“Quando aluguei o espaço onde hoje está a Belrose, não tinha clientes todos os dias, nem fazia ideia de como iria conseguir pagar tudo. E isto foi o que consegui alcançar.”',
  ],
  porObjetivo: [
    ['Conteúdo educativo/técnico', 'Tom professoral, mas nunca pedante. Acessível, com exemplos concretos e números reais. Desmistifica mitos (“A marca não importa, mas…”, “Claro que se cobras 10€ por verniz de gel…”). Frases curtas, estrutura sujeito-verbo-objeto, sem subordinadas complexas. Frequentemente acompanhado de imagens, vídeos ou exemplos que mostram antes de explicar.'],
    ['Conteúdo motivacional/aspiracional', 'Tom mais suave, reflexivo, poético. Usa perguntas abertas (“O que é que tens hoje que um dia foi um sonho?”), apela ao crescimento pessoal e ao “porquê” por trás da ação. Mais espaço em branco, frases mais longas permitidas quando lidam com emoção. Inclui sempre a vulnerabilidade da autora: não é coaching genérico.'],
    ['Venda de formações', 'Tom informativo e transparente, lista conteúdos e benefícios práticos e mensuráveis. Sem hype, sem “transformação garantida”. Termina sempre com um CTA conversacional específico (“Responde ‘quero saber mais’”, “Comenta FORMAÇÃO”). Frequentemente inclui o testemunho ou resultado real de uma aluna anterior.'],
    ['Storytelling pessoal', 'Tom íntimo, vulnerável, confessional. Usa a 1.ª pessoa do singular extensivamente e partilha dúvidas e medos reais ANTES de revelar a superação. Começa frequentemente com “Não te vou mentir…” ou “Isto é difícil de contar, mas…”. Pode incluir um “Ps.” humorístico ou reflexivo no final, que torna o todo mais humano.'],
    ['Conteúdo provocador/de choque', 'Frase de impacto que nomeia o problema honestamente (ex.: “Estás a gastar mais dinheiro e nem percebes”). Tom direto e até irreverente, com ironia seca portuguesa (ex.: “O DINHEIRO NÃO É TUDO. Mas amor pela área não paga contas a ninguém.”). Frequentemente confronta mitos ou expectativas da indústria. Sempre seguido de uma explicação que mostra os dados por trás da provocação.'],
    ['Conteúdo sobre Psicologia/bloqueios emocionais', 'Tom compreensivo mas claro, que diferencia entre sentimento legítimo e responsabilidade de ação. Usa construções como “Não é culpa tua, mas é responsabilidade tua.” Enquadra os bloqueios (medo, culpa, síndrome do impostor) como normais e comuns, não como defeito pessoal. Oferece estratégia psicológica prática além da técnica.'],
  ],
  estrutura: 'Empatia/validação → Educação/informação → CTA/ação (estrutura base para todos os tipos de conteúdo). A voz é consistente, mas o tom muda consoante o objetivo.',
  psicologia: [
    'A formação em Psicologia não aparece como jargão: aparece como compreensão profunda dos bloqueios emocionais que impedem a ação.',
    'Quando alguém diz “Tenho medo de perder clientes”, reconheço que isto não é um problema técnico de preço, é um problema de mentalidade, crenças e inseguranças.',
    'Quando alguém diz “Não sei se mereço ganhar mais”, “Ainda estou a começar e não posso cobrar mais” ou “Trabalho em casa, por isso não posso cobrar tão caro quanto um salão”, isto é síndrome do impostor e bloqueios mentais ligados a crenças e padrões de pensamento, não falta de habilidade.',
    'O tom nunca é clínico ou de diagnóstico, mas compassivo e educador: nomeio a emoção, valido-a e depois ofereço uma ferramenta prática para a atravessar.',
    'Uso frequentemente construções como “Isto não é preguiça, é medo.” ou “Não é que não saibas, é que tens uma crença que te bloqueia.”',
    'Nunca patologizo: não falo em diagnósticos concretos, nem tenho resposta para problemas clínicos. Mas reconheço que empreender é também uma jornada emocional e psicológica.',
  ],
  vidaReal: {
    intro: 'O tom balanceia constantemente entre o que é real e pessoal (dificuldades, medos e fracassos da Alícia como pessoa e como profissional) e o que é expertise e conhecimento (dados que recolheu, padrões que viu, formações que pode dar).',
    exemplos: [
      '“Eu odiava fazer baby boomer” (pessoal) + “Mas descobri estes 3 passos” (expertise)',
      '“Quando comecei, não tinha clientes todos os dias” (real) + “Feitas as contas bem feitas, isto foi o que funcionou” (dados)',
      '“Ainda tenho bloqueios com dinheiro” (honestidade contínua) + “Mas desenvolvi esta tabela de precificação que posso partilhar contigo” (oferecimento prático)',
    ],
    fecho: 'Isto diferencia-me de gurus que parecem nunca ter tido dificuldades, de coaches que dão dicas genéricas e de criadores que romantizam a profissão. O tom diz: “Eu sou como tu, mas aprendi isto, e posso ajudar-te a aprender também.”',
  },
  transparencia: [
    ['Nomear o desconfortável', 'não é “desafios da profissão”, é “trabalhar 10 horas e ganhar 40€”'],
    ['Mostrar o processo, não só o resultado', 'não é “tenho um estúdio de unhas”, é “isto é o que investi, isto é o quanto ganho por hora agora, isto é o que mudei”'],
    ['Reconhecer o que não sei', '“Não tenho resposta para isso.” ou “Isto varia muito pela tua zona.”'],
    ['Questionar a indústria', '“Se dizem que unhas são um bom negócio, porque é que a maioria das estilistas ganha tão pouco?”'],
    ['Incluir números reais', 'não é “ganha bem”, é “Com esta tabela de preços, passaste de 15€/hora para 25€/hora.”'],
  ],
  transparenciaFecho: 'A transparência radical não é desculpa para ser negativa: é honestidade que empodera, não que desmoraliza.',
  teste: ['Eu diria isto?', 'As minhas seguidoras reconheceriam que sou eu?', 'Foi usada alguma palavra proibida?'],
  testeFecho: 'Se as 3 respostas forem sim, sim, não, está pronto. Pergunta extra: se remover todo o “açúcar” motivacional, o conteúdo continua a ser valioso tecnicamente? Se sim, bom sinal.',
};

function renderTom() {
  const T = TOM;
  const ul = (l) => `<ul class="brand-list">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const ol = (l) => `<ol class="brand-list">${l.map(([t, d]) => `<li><strong>${esc(t)}</strong>${d ? ': ' + esc(d) : ''}</li>`).join('')}</ol>`;
  $('#home-body').innerHTML = `
    <div class="brandpage">
      <div class="card"><h3>Como é que eu escrevo: 3 adjetivos</h3>${ol(T.adjetivos)}</div>

      <div class="card"><h3>Expressões que uso com frequência</h3>
        <p class="muted">Palavras, gírias ou construções de frase que aparecem naturalmente nos meus textos.</p>${ol(T.expressoes)}</div>

      <div class="grid cols-2">
        <div class="card"><h3>Palavras proibidas</h3>
          <p class="muted">Expressões que nunca saem da minha boca e que, quando aparecem, parecem falsas.</p>${ul(T.proibidas)}</div>
        <div class="card"><h3>Exemplos de frases que soam como eu</h3>${ul(T.frases)}</div>
      </div>

      <div class="card"><h3>Regras de comportamento</h3>
        <p class="muted">O que a Claude nunca deve fazer ao escrever como eu, e o que deve fazer sempre.</p>
        <div class="grid cols-2">
          <div class="brand-box"><div class="stat-l">Nunca</div>${ul(T.nunca)}</div>
          <div class="brand-box"><div class="stat-l">Sempre</div>${ul(T.sempre)}</div>
        </div>
      </div>

      <div class="card"><h3>Como a minha voz muda por objetivo</h3>
        <p class="muted">${esc(T.estrutura)}</p>
        <div class="grid cols-2">${T.porObjetivo.map(([t, d]) => `<div class="brand-box"><strong>${esc(t)}</strong><p>${esc(d)}</p></div>`).join('')}</div>
      </div>

      <div class="grid cols-2">
        <div class="card"><h3>O papel da Psicologia no meu tom de voz</h3>${ul(T.psicologia)}</div>
        <div class="card"><h3>A estrutura de “vida real” vs. “profissional”</h3>
          <p>${esc(T.vidaReal.intro)}</p><div class="stat-l">Exemplos</div>${ul(T.vidaReal.exemplos)}<p>${esc(T.vidaReal.fecho)}</p></div>
      </div>

      <div class="grid cols-2">
        <div class="card"><h3>Transparência radical: o que significa no tom</h3>${ol(T.transparencia)}<p>${esc(T.transparenciaFecho)}</p></div>
        <div class="card"><h3>Teste das 3 perguntas</h3>
          <p class="muted">A usar antes de publicar qualquer texto gerado pela Claude.</p>
          <ol class="brand-list">${T.teste.map((x) => `<li>${esc(x)}</li>`).join('')}</ol><p>${esc(T.testeFecho)}</p></div>
      </div>
    </div>`;
}

function renderBranding() {
  const B = BRAND, ul = (l) => `<ul class="brand-list">${l.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  $('#home-body').innerHTML = `
    <div class="brandpage">
      <div class="grid cols-2">
        <div class="card"><h3>Elementos visuais</h3><ul class="brand-list cols2">${B.visuais.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div class="card"><h3>Emojis</h3><p class="brand-emojis">${esc(B.emojis)}</p></div>
      </div>

      <div class="card"><h3>1. Direção visual da marca</h3>
        <div class="stat-l">Sensação principal</div><p>${esc(B.sensacao)}</p>
        <div class="stat-l">Elementos dominantes</div>${ul(B.dominantes)}
        <div class="stat-l">A marca é mais…</div>
        <div class="grid cols-2">${B.maisQue.map(([t, d]) => `<div class="brand-box"><strong>${esc(t)}</strong><p>${esc(d)}</p></div>`).join('')}</div>
      </div>

      <div class="grid cols-2 palette">
        <div class="card"><h3>2. Paleta de cores</h3>
          <div class="stat-l">Cores principais</div>
          <div class="swatches">${B.cores.map(([n, h]) => `<div class="swatch"><span class="chip" style="background:${h}"></span><strong>${esc(n)}</strong><span class="muted">${h}</span></div>`).join('')}</div>
        </div>
        <div class="card"><h3>Variações de cor</h3>
          <div class="stat-l">Tons de 50 a 950</div>
          <div class="swatches tints">${B.variacoes.map(([n, h]) => `<div class="swatch"><span class="chip" style="background:${h}"></span><strong>${n}</strong><span class="muted">${h}</span></div>`).join('')}</div>
        </div>
      </div>

      <div class="card"><h3>3. Tipografia</h3>
        <div class="grid cols-3">${B.fontes.map(([t, n, u]) => `<div class="brand-box"><div class="stat-l">${esc(t)}</div><strong>${esc(n)}</strong><p>${esc(u)}</p></div>`).join('')}</div>
      </div>

      <div class="card"><h3>4. Estilo de imagem</h3>
        <p>${esc(B.imagem.estilo)}</p>
        <div class="stat-l">Características técnicas</div>${ul(B.imagem.tecnica)}
        <div class="grid cols-2">
          <div><div class="stat-l">Tipos de imagem permitidos</div>${ul(B.imagem.sim)}</div>
          <div><div class="stat-l">Não representam a marca</div>${ul(B.imagem.nao)}</div>
        </div>
      </div>

      <div class="card"><h3>5. Elementos visuais</h3>
        <div class="grid cols-3">
          <div><div class="stat-l">Elementos gráficos usados</div>${ul(B.elementos.usados)}</div>
          <div><div class="stat-l">Elementos recorrentes</div>${ul(B.elementos.recorrentes)}</div>
          <div><div class="stat-l">Não devem ser usados</div>${ul(B.elementos.nao)}</div>
        </div>
      </div>

      <div class="card"><h3>6. Moodboard</h3>
        <p><a href="${B.pinterest}" target="_blank" rel="noopener">Abrir a pasta do Pinterest ↗</a></p>
      </div>
    </div>`;
}

async function renderGeneral() {
  const v = $('#home-body');
  v.innerHTML = `
    <div class="grid cols-3">
      <div class="card hl"><div class="stat-l">Leads captados</div><div class="stat-n" id="n-leads">0</div></div>
      <div class="card"><div class="stat-l">Automações ativas</div><div class="stat-n" id="n-autos">0</div></div>
      <div class="card"><div class="stat-l">DMs enviadas (7 dias)</div><div class="stat-n" id="n-dms">0</div></div>
    </div>`;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [leads, autos, dms] = await Promise.all([
    safeCount('ig_leads'),
    safeCount('ig_automations', (q) => q.eq('active', true)),
    safeCount('ig_deliveries', (q) => q.eq('status', 'ok').gte('ts', since)),
  ]);
  if (state.route !== 'home' || !$('#n-leads')) return;
  $('#n-leads').textContent = leads; $('#n-autos').textContent = autos; $('#n-dms').textContent = dms;
}

// ---------- Calendário ----------
const CAL_SUBS = [['cal', 'Calendário Editorial'], ['dates', 'Datas Relevantes'], ['lines', 'Linhas Editoriais e Rubricas'], ['refs', 'Banco de Referências']];
const CAL_FORMATOS = { 'Reels': '🎬', 'Carrossel': '🎠', 'Estático': '🖼️', 'Stories': '📱', 'Live': '🔴' };
const CAL_STATUS = ['Em rascunho', 'Em progresso', 'Agendado', 'Publicado'];
const CAL_STATUS_CLS = { 'Em rascunho': 'st-rasc', 'Em progresso': 'st-prog', 'Agendado': 'st-agen', 'Publicado': 'st-publ' };
const CAL_RUBRICAS = ['Clínica das Unhas', 'Perguntas e Respostas', 'Gestão e Finanças', 'Loja Online', 'Vblog'];
const CAL_TEMAS = ['Geral', 'Gestão Financeira', 'Manciure', 'Loja Online', 'Psicologia e Saúde Mental'];
const CAL_PLATAFORMAS = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'Blog', 'Newsletter'];
const CAL_REF_CATS = ['Criadores', 'Conteúdos', 'Blogs, websites e livros', 'Podcasts', 'Histórias da Marca', 'Chuva de ideias'];
const CAL_WD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const CA = { list: [], loaded: false, month: null, sub: 'cal', refCat: '', rubSel: '' };
const LS_CAL = 'painel_calendario';
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function calLoad() {
  if (sb) {
    const { data, error } = await sb.from('calendario').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    CA.list = data || [];
  } else {
    try { CA.list = JSON.parse(localStorage.getItem(LS_CAL) || '[]'); } catch { CA.list = []; }
  }
  CA.loaded = true;
}
const calPersist = () => { if (!sb) { try { localStorage.setItem(LS_CAL, JSON.stringify(CA.list)); } catch { /* sem armazenamento */ } } };
async function calSave(r) {
  r.updated_at = new Date().toISOString();
  if (sb) { const { error } = await sb.from('calendario').upsert(r); if (error) throw error; }
  const i = CA.list.findIndex((x) => x.id === r.id);
  if (i >= 0) CA.list[i] = r; else CA.list.push(r);
  calPersist();
}
async function calDelete(id) {
  if (sb) { const { error } = await sb.from('calendario').delete().eq('id', id); if (error) throw error; }
  CA.list = CA.list.filter((x) => x.id !== id); calPersist();
}
const calOf = (tipo) => CA.list.filter((r) => r.tipo === tipo);
const calRubricas = () => [...new Set([...CAL_RUBRICAS, ...calOf('rubrica').map((r) => r.dados?.rubrica).filter(Boolean)])];

// --- Janela de edição genérica ---
// fields: [chave, rótulo, tipo, opções]. A chave "titulo" fica na coluna titulo; as restantes em dados.
function calModal({ heading, rec, fields, onDone }) {
  const draft = JSON.parse(JSON.stringify(rec)); draft.dados ||= {};
  const isNew = !CA.list.some((x) => x.id === rec.id);
  const get = (k) => (k === 'titulo' ? draft.titulo : draft.dados[k]);
  const fld = ([k, label, type, opts]) => {
    const v = get(k), id = 'cm-' + k;
    if (type === 'bool') return `<label class="co-field pa-bool"><input type="checkbox" data-k="${k}" data-type="bool" ${v ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    if (type === 'longtext') return `<label class="co-field cm-wide"><span>${esc(label)}</span><textarea data-k="${k}" data-type="text">${esc(v ?? '')}</textarea></label>`;
    if (type === 'links') return `<div class="co-field cm-wide"><span>${esc(label)}</span><textarea data-k="${k}" data-type="links" placeholder="Cola um link por linha (reels, posts, vídeos, artigos…)">${esc(Array.isArray(v) ? v.join('\n') : '')}</textarea><div class="cm-linklist" id="cm-links"></div></div>`;
    if (type === 'files') return `<div class="co-field cm-wide"><span>${esc(label)}</span><div class="cm-files" id="cm-files"></div><div class="cm-filebar"><label class="btn cm-attach">+ Anexar imagens<input type="file" id="cm-file" accept="image/png,image/jpeg" multiple hidden></label><span class="muted small">PNG ou JPEG, até 5 MB cada</span></div></div>`;
    if (type === 'multi') return `<div class="co-field cm-wide"><span>${esc(label)}</span><div class="cm-multi">${opts.map((o) => `<label class="cm-opt"><input type="checkbox" data-k="${k}" data-type="multi" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div></div>`;
    if (type === 'select') return `<label class="co-field"><span>${esc(label)}</span><select data-k="${k}" data-type="text">${opts.map((o) => `<option value="${esc(o)}" ${String(v ?? '') === o ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select></label>`;
    if (type === 'combo') return `<label class="co-field"><span>${esc(label)}</span><input type="text" list="${id}" data-k="${k}" data-type="text" value="${esc(v ?? '')}"><datalist id="${id}">${opts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist></label>`;
    return `<label class="co-field ${k === 'titulo' ? 'cm-wide' : ''}"><span>${esc(label)}</span><input type="${type}" data-k="${k}" data-type="${type}" value="${esc(v ?? '')}"></label>`;
  };
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h3>${esc(heading)}</h3>
    <div class="cm-grid">${fields.map(fld).join('')}</div>
    <div class="cm-foot">${isNew ? '<span></span>' : '<button class="btn danger" id="cm-del">Apagar</button>'}<div><button class="btn" id="cm-cancel">Cancelar</button> <button class="btn primary" id="cm-save">Guardar</button></div></div></div>`;
  document.body.appendChild(bg);
  const added = [];            // ficheiros enviados nesta janela (apagados se cancelares)
  const removedOld = [];       // ficheiros antigos removidos (apagados só ao guardar)
  const anexos = () => (draft.dados.anexos ||= []);
  let saved = false;
  const dispose = () => bg.remove();
  const close = () => { if (!saved && sb && added.length) sb.storage.from('anexos').remove(added.map((x) => x.path)).catch(() => {}); dispose(); };
  const first = bg.querySelector('input,select,textarea'); first?.focus();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('#cm-cancel', bg).addEventListener('click', close);
  // links de referência
  const links = $('[data-type="links"]', bg);
  if (links) {
    const showLinks = () => { $('#cm-links', bg).innerHTML = links.value.split('\n').map((x) => x.trim()).filter((x) => /^https?:\/\//i.test(x)).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 60))} ↗</a>`).join(''); };
    links.addEventListener('input', showLinks); showLinks();
  }
  // anexos (imagens)
  const filesBox = $('#cm-files', bg);
  if (filesBox) {
    const draw = () => {
      filesBox.innerHTML = anexos().length ? anexos().map((f, i) => `<div class="cm-file"><a href="${esc(f.url || f.dataUrl || '#')}" target="_blank" rel="noopener" title="${esc(f.nome)}"><span class="cm-thumb" style="background-image:url('${esc(f.url || f.dataUrl || '')}')"></span></a><span class="small">${esc(f.nome)}</span><button type="button" class="btn sm" data-rm="${i}">Remover</button></div>`).join('') : '<span class="muted small">Ainda sem anexos.</span>';
      $$('[data-rm]', filesBox).forEach((b) => b.addEventListener('click', async () => {
        const f = anexos().splice(+b.dataset.rm, 1)[0];
        if (f?.path) { const ai = added.findIndex((x) => x.path === f.path); if (ai >= 0) { added.splice(ai, 1); sb?.storage.from('anexos').remove([f.path]).catch(() => {}); } else removedOld.push(f.path); }
        draw();
      }));
    };
    draw();
    if (sb && anexos().some((f) => f.path)) {
      sb.storage.from('anexos').createSignedUrls(anexos().filter((f) => f.path).map((f) => f.path), 3600).then(({ data }) => {
        (data || []).forEach((d) => { const f = anexos().find((x) => x.path === d.path); if (f) f.url = d.signedUrl; }); draw();
      }).catch(() => {});
    }
    $('#cm-file', bg).addEventListener('change', async (e) => {
      for (const file of [...e.target.files]) {
        if (!['image/png', 'image/jpeg'].includes(file.type)) { toast(`“${file.name}” não é PNG nem JPEG.`, true); continue; }
        if (file.size > 5 * 1024 * 1024) { toast(`“${file.name}” tem mais de 5 MB.`, true); continue; }
        try {
          if (sb) {
            const path = `${draft.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
            const up = await sb.storage.from('anexos').upload(path, file, { contentType: file.type });
            if (up.error) throw up.error;
            const sg = await sb.storage.from('anexos').createSignedUrl(path, 3600);
            const f = { nome: file.name, path, url: sg.data?.signedUrl }; anexos().push(f); added.push(f);
          } else {
            if (file.size > 1024 * 1024) { toast('Em modo de teste local, o limite é 1 MB.', true); continue; }
            const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
            anexos().push({ nome: file.name, dataUrl });
          }
        } catch (err) { console.error(err); toast(`Não foi possível anexar “${file.name}”.`, true); }
      }
      e.target.value = ''; draw();
    });
  }
  $('#cm-save', bg).addEventListener('click', async () => {
    $$('[data-k]', bg).forEach((el) => {
      const k = el.dataset.k, t = el.dataset.type;
      if (t === 'multi') { if (!Array.isArray(draft.dados[k])) draft.dados[k] = []; return; }
      const v = t === 'bool' ? el.checked : (t === 'date' ? (el.value || null) : (t === 'links' ? el.value.split('\n').map((x) => x.trim()).filter(Boolean) : el.value));
      if (k === 'titulo') draft.titulo = v; else draft.dados[k] = v;
    });
    fields.filter((f) => f[2] === 'multi').forEach(([k]) => { draft.dados[k] = $$(`[data-k="${k}"]:checked`, bg).map((e) => e.value); });
    if (!String(draft.titulo || '').trim()) { toast('Preenche o título antes de guardar.', true); return; }
    draft.titulo = draft.titulo.trim();
    if (draft.dados.anexos) draft.dados.anexos = draft.dados.anexos.map(({ nome, path, dataUrl }) => (path ? { nome, path } : { nome, dataUrl }));
    try {
      await calSave(draft); saved = true;
      if (sb && removedOld.length) sb.storage.from('anexos').remove(removedOld).catch(() => {});
      dispose(); toast('Guardado.'); onDone?.();
    } catch (e) { console.error(e); toast('Não foi possível guardar. Tenta outra vez.', true); }
  });
  $('#cm-del', bg)?.addEventListener('click', async () => {
    if (!confirm('Apagar este registo? Esta ação não se pode desfazer.')) return;
    try {
      await calDelete(draft.id);
      const paths = (rec.dados?.anexos || []).map((f) => f.path).filter(Boolean);
      if (sb && paths.length) sb.storage.from('anexos').remove(paths).catch(() => {});
      saved = true; dispose(); toast('Apagado.'); onDone?.();
    } catch (e) { console.error(e); toast('Não foi possível apagar.', true); }
  });
}
const calNew = (tipo, dados = {}, titulo = '') => ({ id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())), tipo, titulo, dados, created_at: new Date().toISOString() });

// --- Página ---
async function renderCalendar() {
  if (!CA.month) { const n = new Date(); CA.month = new Date(n.getFullYear(), n.getMonth(), 1); }
  $('#view').innerHTML = `
    <div class="page-head"><h1>🗓️ Calendário</h1></div>
    <div class="tabs">${CAL_SUBS.map(([k, l]) => `<button class="tab" data-sub="${k}">${l}</button>`).join('')}</div>
    <div id="cal-body"><div class="card empty"><p>A carregar…</p></div></div>`;
  $$('.tab[data-sub]').forEach((t) => {
    t.classList.toggle('active', CA.sub === t.dataset.sub);
    t.addEventListener('click', () => { CA.sub = t.dataset.sub; renderCalendar(); });
  });
  if (!CA.loaded) {
    try { await calLoad(); } catch (e) { console.error(e); return ($('#cal-body').innerHTML = '<div class="card empty"><p>Não foi possível carregar o calendário.</p></div>'); }
    if (state.route !== 'calendar') return;
  }
  drawCalBody();
}
const redrawCal = () => { if (state.route === 'calendar') drawCalBody(); };
function drawCalBody() {
  if (CA.sub === 'dates') return drawCalDates();
  if (CA.sub === 'lines') return drawCalLines();
  if (CA.sub === 'refs') return drawCalRefs();
  drawCalGrid();
}

// Calendário mensal
function calDatesOn(day) {
  const key = ymd(day), md = key.slice(5);
  return calOf('data').filter((r) => {
    const d = r.dados?.data, f = r.dados?.data_fim;
    if (!d) return false;
    if (r.dados.recorrente) return f ? (md >= d.slice(5) && md <= f.slice(5)) : d.slice(5) === md;
    return f ? (key >= d && key <= f) : d === key;
  });
}
function drawCalGrid() {
  const m = CA.month, first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const todayKey = ymd(new Date());
  const all = calOf('conteudo');
  const byDay = {};
  all.forEach((r) => { const d = r.dados?.data; if (d) (byDay[d] ||= []).push(r); });
  const inMonth = all.filter((r) => String(r.dados?.data || '').startsWith(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`));
  const cnt = (s) => inMonth.filter((r) => r.dados?.status === s).length;
  const title = m.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = ymd(d), items = byDay[key] || [], dts = calDatesOn(d);
    const rows = [...dts.map((r) => ({ t: 'd', r })), ...items.map((r) => ({ t: 'c', r }))];
    const shown = rows.slice(0, 3), more = rows.length - shown.length;
    cells += `<div class="cal-cell ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${key === todayKey ? 'today' : ''}" data-day="${key}">
      <span class="cal-n">${d.getDate()}</span>
      ${shown.map(({ t, r }) => t === 'd'
        ? `<button class="cal-it cal-date" data-d="${r.id}" title="${esc(r.titulo)}">📌 ${esc(r.titulo)}</button>`
        : `<button class="cal-it ${CAL_STATUS_CLS[r.dados?.status] || 'st-rasc'}" data-c="${r.id}" title="${esc(r.titulo)} · ${esc(r.dados?.status || '')}">${CAL_FORMATOS[r.dados?.formato] || '▫️'} ${esc(r.titulo)}</button>`).join('')}
      ${more > 0 ? `<span class="cal-more">+${more} mais</span>` : ''}</div>`;
  }
  $('#cal-body').innerHTML = `
    <div class="cal-bar">
      <div class="cal-nav"><button class="btn" id="cal-prev" aria-label="Mês anterior">‹</button><button class="btn" id="cal-today">Hoje</button><button class="btn" id="cal-next" aria-label="Mês seguinte">›</button>
        <h2 class="cal-title">${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h2></div>
      <button class="btn primary" id="cal-new">+ Novo conteúdo</button>
    </div>
    <div class="cal-sum"><span class="cal-it st-rasc">Rascunho ${cnt('Em rascunho')}</span><span class="cal-it st-prog">Em progresso ${cnt('Em progresso')}</span><span class="cal-it st-agen">Agendado ${cnt('Agendado')}</span><span class="cal-it st-publ">Publicado ${cnt('Publicado')}</span></div>
    <div class="cal-grid"><div class="cal-head">${CAL_WD.map((w) => `<div>${w}</div>`).join('')}</div><div class="cal-days">${cells}</div></div>
    <p class="muted small">Clica num dia para planear um conteúdo nessa data. 📌 são as tuas datas relevantes.</p>`;
  const go = (n) => { CA.month = new Date(m.getFullYear(), m.getMonth() + n, 1); drawCalGrid(); };
  $('#cal-prev').addEventListener('click', () => go(-1)); $('#cal-next').addEventListener('click', () => go(1));
  $('#cal-today').addEventListener('click', () => { const n = new Date(); CA.month = new Date(n.getFullYear(), n.getMonth(), 1); drawCalGrid(); });
  $('#cal-new').addEventListener('click', () => editConteudo(calNew('conteudo', { status: 'Em rascunho', data: todayKey })));
  $$('.cal-cell').forEach((c) => c.addEventListener('click', () => editConteudo(calNew('conteudo', { status: 'Em rascunho', data: c.dataset.day }))));
  $$('.cal-it[data-c]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); editConteudo(CA.list.find((x) => x.id === b.dataset.c)); }));
  $$('.cal-it[data-d]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); editData(CA.list.find((x) => x.id === b.dataset.d)); }));
}
function editConteudo(rec) {
  calModal({ heading: rec.titulo ? 'Editar conteúdo' : 'Novo conteúdo', rec, onDone: redrawCal, fields: [
    ['titulo', 'Novo conteúdo (título)', 'text'],
    ['data', 'Data da publicação', 'date'],
    ['status', 'Estado', 'select', CAL_STATUS],
    ['formato', 'Formato', 'select', ['', ...Object.keys(CAL_FORMATOS)]],
    ['plataforma', 'Plataforma', 'combo', CAL_PLATAFORMAS],
    ['tema', 'Tema', 'combo', CAL_TEMAS],
    ['rubricas', 'Rubrica', 'multi', calRubricas()],
    ['referencia', 'Referência (link)', 'url'],
    ['notas', 'Notas', 'longtext'],
  ] });
}

// Datas Relevantes
function editData(rec) {
  calModal({ heading: rec.titulo ? 'Editar data relevante' : 'Nova data relevante', rec, onDone: redrawCal, fields: [
    ['titulo', 'Data / evento (ex.: Dia da Mãe, Black Friday)', 'text'],
    ['data', 'Dia no calendário (ou primeiro dia)', 'date'],
    ['data_fim', 'Último dia (só se for um período)', 'date'],
    ['recorrente', 'Repete todos os anos', 'bool'],
    ['exemplos', 'Exemplos de adaptação e utilização', 'longtext'],
    ['links', 'Links de referência (conteúdos que posso adaptar)', 'links'],
    ['anexos', 'Anexos (imagens PNG ou JPEG)', 'files'],
  ] });
}
function calDiaTxt(r) {
  const d = r.dados?.data; if (!d) return '—';
  const f = r.dados.data_fim, rec = r.dados.recorrente;
  const dt = (s) => new Date(s + 'T12:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', ...(rec ? {} : { year: 'numeric' }) });
  return esc(f ? `${new Date(d + 'T12:00').getDate()} a ${dt(f)}` : dt(d));
}
function drawCalDates() {
  const rows = calOf('data').sort((a, b) => String(a.dados?.data || '9999').slice(5).localeCompare(String(b.dados?.data || '9999').slice(5)));
  $('#cal-body').innerHTML = `
    <div class="co-bar"><span></span><button class="btn primary" id="cd-new">+ Nova data</button></div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl cal-tbl"><colgroup><col style="width:20%"><col style="width:13%"><col><col style="width:12%"></colgroup><thead><tr><th>Data / evento</th><th>Dia</th><th>Exemplos de adaptação e utilização</th><th>Referências</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="pa-row cal-row" data-id="${r.id}"><td><strong class="cal-clamp">${esc(r.titulo)}</strong></td>
        <td>${calDiaTxt(r)}</td>
        <td><span class="cal-clamp cal-ex" title="${esc(r.dados?.exemplos || '')}">${esc(r.dados?.exemplos || '—')}</span></td>
        <td>${(r.dados?.links || []).length ? `<span class="chip gray">🔗 ${r.dados.links.length}</span>` : ''}${(r.dados?.anexos || []).length ? `<span class="chip gray">🖼️ ${r.dados.anexos.length}</span>` : ''}${!(r.dados?.links || []).length && !(r.dados?.anexos || []).length ? '—' : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty"><div class="big">🗓️</div><h2>Ainda não há datas relevantes</h2><p>Regista aqui as datas que importam para o teu conteúdo (Dia da Mãe, Black Friday, Dia do Trabalhador…) com ideias de como as aproveitar.</p></div>'}`;
  $('#cd-new').addEventListener('click', () => editData(calNew('data', { recorrente: true })));
  $$('.pa-row').forEach((r) => r.addEventListener('click', () => editData(CA.list.find((x) => x.id === r.dataset.id))));
}

// Linhas Editoriais e Rubricas
function editRubrica(rec) {
  calModal({ heading: rec.titulo ? 'Editar ideia' : 'Nova ideia de conteúdo', rec, onDone: redrawCal, fields: [
    ['titulo', 'Nome da ideia / formato', 'text'],
    ['rubrica', 'Rubrica', 'combo', calRubricas()],
    ['notas', 'Notas (estrutura, ganchos, exemplos)', 'longtext'],
  ] });
}
function drawCalLines() {
  const items = calOf('rubrica'), rubs = calRubricas();
  const counts = Object.fromEntries(rubs.map((r) => [r, items.filter((i) => i.dados?.rubrica === r).length]));
  const sel = CA.rubSel, rows = items.filter((i) => !sel || i.dados?.rubrica === sel);
  const posts = calOf('conteudo');
  $('#cal-body').innerHTML = `
    <div class="grid cols-5 pa-kpis">${rubs.map((r) => `<button class="card au-bk ${sel === r ? 'sel' : ''}" data-r="${esc(r)}"><div class="stat-l">${esc(r)}</div><div class="stat-n">${counts[r]}</div><div class="muted small">ideias · ${posts.filter((p) => (p.dados?.rubricas || []).includes(r)).length} no calendário</div></button>`).join('')}</div>
    <div class="co-bar"><span class="muted">${sel ? esc(sel) : 'Todas as rubricas'} · ${rows.length} ${rows.length === 1 ? 'ideia' : 'ideias'}</span><button class="btn primary" id="cl-new">+ Nova ideia</button></div>
    ${rows.length ? `<div class="grid cols-3">${rows.map((r) => `<button class="card co-card" data-id="${r.id}"><strong>${esc(r.titulo)}</strong><div class="co-meta">${r.dados?.rubrica ? `<span class="chip">${esc(r.dados.rubrica)}</span>` : ''}</div><div class="muted small cal-note">${esc(r.dados?.notas || '')}</div></button>`).join('')}</div>`
    : '<div class="card empty"><div class="big">📍</div><h2>Ainda não há ideias nesta rubrica</h2><p>Cada rubrica é uma linha editorial recorrente. Junta aqui as ideias e formatos de cada uma para as usares ao planear o calendário.</p></div>'}`;
  $('#cl-new').addEventListener('click', () => editRubrica(calNew('rubrica', { rubrica: sel })));
  $$('.au-bk[data-r]').forEach((b) => b.addEventListener('click', () => { CA.rubSel = CA.rubSel === b.dataset.r ? '' : b.dataset.r; drawCalLines(); }));
  $$('.co-card').forEach((b) => b.addEventListener('click', () => editRubrica(CA.list.find((x) => x.id === b.dataset.id))));
}

// Banco de Referências
function editCriador(rec) {
  rec.dados ||= {}; rec.dados.categoria = 'Criadores';
  calModal({ heading: rec.titulo ? 'Editar criador' : 'Novo criador', rec, onDone: redrawCal, fields: [
    ['titulo', 'Nome', 'text'],
    ['compraria', 'Compraria?', 'select', ['', 'Não', 'Sim', 'Já comprei']],
    ['instagram', 'Instagram (link)', 'url'],
    ['tiktok', 'TikTok (link)', 'url'],
    ['youtube', 'YouTube (link)', 'url'],
    ['porque', 'Porque é que acompanho esta pessoa?', 'longtext'],
    ['tipos_conteudo', 'Quais os tipos de conteúdos que mais gosto de ver?', 'longtext'],
    ['links_conteudos', 'Links de conteúdos deste criador de que gosto', 'links'],
  ] });
}
const CRIADOR_CHIP = { 'Já comprei': 'ok', 'Sim': 'au-warn', 'Não': 'gray' };
const igHandle = (u) => { const m = String(u || '').match(/instagram\.com\/([^/?#]+)/i); return m ? '@' + m[1] : ''; };
function editRef(rec) {
  if (rec.dados?.categoria === 'Criadores') return editCriador(rec);
  calModal({ heading: rec.titulo ? 'Editar referência' : 'Nova referência', rec, onDone: redrawCal, fields: [
    ['titulo', 'Título / nome', 'text'],
    ['categoria', 'Categoria', 'select', CAL_REF_CATS],
    ['link', 'Link', 'url'],
    ['notas', 'Notas (porque é uma boa referência, o que aproveitar)', 'longtext'],
  ] });
}
function drawCalRefs() {
  const items = calOf('referencia');
  const counts = Object.fromEntries(CAL_REF_CATS.map((c) => [c, items.filter((i) => i.dados?.categoria === c).length]));
  const rows = items.filter((i) => !CA.refCat || i.dados?.categoria === CA.refCat);
  $('#cal-body').innerHTML = `
    <div class="pa-pipe">
      <button class="au-pill ${CA.refCat === '' ? 'active' : ''}" data-c="">Tudo <span class="count">${items.length}</span></button>
      ${CAL_REF_CATS.map((c) => `<button class="au-pill ${CA.refCat === c ? 'active' : ''}" data-c="${esc(c)}">${esc(c)} <span class="count">${counts[c]}</span></button>`).join('')}
    </div>
    <div class="co-bar"><span></span><button class="btn primary" id="cr-new">${CA.refCat === 'Criadores' ? '+ Novo criador' : '+ Nova referência'}</button></div>
    ${CA.refCat === 'Criadores' && rows.length ? `<div class="tbl-wrap"><table class="tbl cal-tbl cr-tbl"><colgroup><col style="width:11%"><col style="width:12%"><col style="width:7%"><col></colgroup><thead><tr><th>Criador</th><th>Redes</th><th>Compraria?</th><th>Porque é que acompanho</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="pa-row cal-row" data-id="${r.id}"><td><div class="cr-name"><strong>${esc(r.titulo)}</strong>${(r.dados?.links_conteudos || []).length ? `<span class="chip gray" title="Links de conteúdos guardados">🔗 ${r.dados.links_conteudos.length}</span>` : ''}</div></td>
        <td>${[['instagram', 'Instagram', igHandle(r.dados?.instagram)], ['tiktok', 'TikTok', 'TikTok'], ['youtube', 'YouTube', 'YouTube']].filter(([k]) => r.dados?.[k]).map(([k, , t]) => `<a class="cal-link-a" href="${esc(r.dados[k])}" target="_blank" rel="noopener">${esc(t || k)}</a>`).join(' ') || '—'}</td>
        <td>${r.dados?.compraria ? `<span class="chip ${CRIADOR_CHIP[r.dados.compraria] || ''}">${esc(r.dados.compraria)}</span>` : '—'}</td>
        <td><span class="cal-clamp cal-ex" title="${esc(r.dados?.porque || '')}">${esc(r.dados?.porque || '—')}</span></td></tr>`).join('')}</tbody></table></div>`
    : rows.length ? `<div class="grid cols-3">${rows.map((r) => `<button class="card co-card" data-id="${r.id}"><strong>${esc(r.titulo)}</strong><div class="co-meta">${r.dados?.categoria ? `<span class="chip">${esc(r.dados.categoria)}</span>` : ''}</div>
      <div class="muted small cal-note">${esc(r.dados?.notas || '')}</div>${r.dados?.link ? `<span class="small cal-link" data-href="${esc(r.dados.link)}">Abrir link ↗</span>` : ''}</button>`).join('')}</div>`
    : '<div class="card empty"><div class="big">💡</div><h2>Ainda não há referências</h2><p>Guarda aqui criadores, conteúdos, blogs, livros, podcasts e ideias que te inspiram.</p></div>'}`;
  $('#cr-new').addEventListener('click', () => (CA.refCat === 'Criadores' ? editCriador(calNew('referencia', { categoria: 'Criadores' })) : editRef(calNew('referencia', { categoria: CA.refCat || CAL_REF_CATS[0] }))));
  $$('.pa-pipe .au-pill').forEach((b) => b.addEventListener('click', () => { CA.refCat = b.dataset.c; drawCalRefs(); }));
  $$('.co-card, .cal-row').forEach((b) => b.addEventListener('click', () => editRef(CA.list.find((x) => x.id === b.dataset.id))));
  $$('.cal-link-a').forEach((l) => l.addEventListener('click', (e) => e.stopPropagation()));
  $$('.cal-link').forEach((l) => l.addEventListener('click', (e) => { e.stopPropagation(); const u = l.dataset.href; if (/^https?:\/\//i.test(u)) window.open(u, '_blank', 'noopener'); }));
}

// ---------- Oferta Formativa ----------
const COURSE_TABS = [['draft', 'Rascunhos'], ['progress', 'Em Progresso'], ['available', 'Disponíveis']];
const COURSE_EMPTY = {
  draft: ['📝', 'Ainda não há formações em rascunho', 'Aqui ficam as formações que estás a idealizar, antes de começares a criá-las.'],
  progress: ['🛠️', 'Ainda não há formações em progresso', 'Aqui ficam as formações que estás a criar neste momento.'],
  available: ['✅', 'Ainda não há formações disponíveis', 'Aqui ficam as formações já prontas e à venda.'],
};
const COURSE_STATUS = Object.fromEntries(COURSE_TABS);
// Ficha de cada formação (preenchida à mão). type: 'list' = um item por linha; 'text' = texto livre.
const COURSE_SECTIONS = [
  ['Lente 1 · Características do produto', [
    ['caracteristicas', 'Características do produto', 'list', 'Lista, pelo menos, 5 características (aulas, ferramentas, templates, o que quebra objeções…). Uma por linha.'],
    ['objetivo', 'Principal objetivo do produto', 'text', ''],
    ['funcao', 'Função na minha oferta', 'text', ''],
    ['entrego', 'O que vou entregar', 'list', ''],
    ['tarefas', 'Tarefas, desafios ou sugestões', 'list', ''],
  ]],
  ['Lente 2 · Benefícios do produto', [
    ['ganham', 'O que ganham ao comprar', 'list', ''],
    ['diferentes', 'Como as pessoas ficam diferentes', 'list', ''],
    ['capazes', 'O que passam a ser capazes de fazer', 'list', ''],
    ['transformacao', 'Transformação que o produto gera', 'list', ''],
    ['beneficios', 'Lista de benefícios', 'list', 'Pelo menos 5. Uma por linha.'],
  ]],
  ['Lente 3 · Bónus do produto', [['bonus', 'Bónus', 'list', 'Todos os bónus incluídos. Um por linha.']]],
  ['Lente 4 · Diferenciais do produto', [
    ['dif_diferente', 'O que tem de diferente dos outros', 'list', ''],
    ['dif_inovador', 'O que tem de inovador', 'list', ''],
    ['dif_valioso', 'O que tem de muito valioso no mercado', 'list', ''],
    ['diferenciais', 'Lista de diferenciais', 'list', ''],
  ]],
  ['Sobre mim · Raio-X pessoal', [
    ['defendes', 'O que defendes', 'list', ''],
    ['valores', 'Quais são os teus valores', 'list', ''],
    ['naoconcordas', 'O que não concordas', 'list', ''],
    ['perrengues', 'Perrengues que viveste e superaste', 'list', ''],
    ['realizacoes', 'Realizações que conquistaste', 'list', ''],
  ]],
  ['Potencial cliente · Dores', [
    ['dores_paz', 'O que tira a paz', 'list', ''],
    ['dores_obstaculos', 'Obstáculos no caminho', 'list', ''],
    ['dores_problemas', 'Problemas que não consegue resolver', 'list', ''],
    ['dores_comportamentos', 'Comportamentos que a impedem de agir', 'list', ''],
  ]],
  ['Potencial cliente · Dúvidas', [
    ['duv_perguntas', 'Perguntas frequentes', 'list', ''],
    ['duv_desconfianca', 'O que ainda é visto com desconfiança', 'list', ''],
    ['duv_nao_importante', 'Assuntos que não veem como importantes', 'list', ''],
  ]],
  ['Potencial cliente · Erros', [
    ['err_mitos', 'Mitos mais frequentes', 'list', ''],
    ['err_erros', 'Erros mais comuns', 'list', ''],
  ]],
  ['Potencial cliente · Desejos', [
    ['des_meta', 'Meta que quer alcançar', 'list', ''],
    ['des_sonhando', 'O que a faz “sonhar acordada”', 'list', ''],
    ['des_resultado', 'Resultado que ainda não tem', 'list', ''],
  ]],
  ['Potencial cliente · Consequências', [
    ['con_atuais', 'Consequências que sente hoje', 'list', ''],
    ['con_futuras', 'Consequências se mantiver os comportamentos', 'list', ''],
  ]],
  ['Potencial cliente · Motivações', [
    ['mot_internas', 'Motivações internas (emocionais)', 'list', ''],
    ['mot_externas', 'Motivações externas (problema a resolver)', 'list', ''],
  ]],
  ['Potencial cliente · Jornada', [
    ['ponto_a', 'Ponto A (situação atual)', 'text', ''],
    ['percurso', 'Percurso até ao ponto B', 'text', ''],
    ['ponto_b', 'Ponto B (depois do produto)', 'text', ''],
  ]],
];
const COURSE_FIELDS = COURSE_SECTIONS.flatMap(([, f]) => f);
const COURSE_NIVEIS = ['Produto Principal', 'Produto de Entrada', 'Upsell', 'Bónus', 'Serviço'];
const CO = { list: [], loaded: false, open: null, draft: null, dirty: false };
const LS_COURSES = 'painel_formacoes';

async function coursesLoad() {
  if (sb) {
    const { data, error } = await sb.from('formacoes').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    CO.list = data || [];
  } else {
    try { CO.list = JSON.parse(localStorage.getItem(LS_COURSES) || '[]'); } catch { CO.list = []; }
  }
  CO.loaded = true;
}
async function coursesSave(c) {
  c.updated_at = new Date().toISOString();
  if (sb) { const { error } = await sb.from('formacoes').upsert(c); if (error) throw error; }
  else {
    const i = CO.list.findIndex((x) => x.id === c.id);
    const next = i >= 0 ? CO.list.map((x) => (x.id === c.id ? c : x)) : [...CO.list, c];
    try { localStorage.setItem(LS_COURSES, JSON.stringify(next)); } catch { /* sem armazenamento */ }
  }
  const i = CO.list.findIndex((x) => x.id === c.id);
  if (i >= 0) CO.list[i] = c; else CO.list.push(c);
}
async function coursesDelete(id) {
  if (sb) { const { error } = await sb.from('formacoes').delete().eq('id', id); if (error) throw error; }
  CO.list = CO.list.filter((x) => x.id !== id);
  if (!sb) { try { localStorage.setItem(LS_COURSES, JSON.stringify(CO.list)); } catch { /* sem armazenamento */ } }
}

const courseFill = (c) => {
  const d = c.dados || {};
  const done = COURSE_FIELDS.filter(([k]) => (Array.isArray(d[k]) ? d[k].length : String(d[k] ?? '').trim())).length;
  return Math.round((done / COURSE_FIELDS.length) * 100);
};
const eur = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('pt-PT', { minimumFractionDigits: Number.isInteger(+n) ? 0 : 2, maximumFractionDigits: 2 }) + ' €');

async function renderCourses() {
  if (CO.open) return drawCourseDetail();
  $('#view').innerHTML = `
    <div class="page-head"><h1>🎓 Oferta Formativa</h1></div>
    <div class="tabs">${COURSE_TABS.map(([k, l]) => `<button class="tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="course-body"><div class="card empty" style="margin-top:16px"><p>A carregar…</p></div></div>`;
  $$('.tab').forEach((t) => t.addEventListener('click', () => { state.courseTab = t.dataset.tab; renderCourses(); }));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.courseTab));
  if (!CO.loaded) {
    try { await coursesLoad(); } catch (e) { console.error(e); return ($('#course-body').innerHTML = '<div class="card empty" style="margin-top:16px"><p>Não foi possível carregar as formações.</p></div>'); }
    if (state.route !== 'courses' || CO.open) return;
  }
  drawCourseList();
}

function drawCourseList() {
  const tab = state.courseTab, list = CO.list.filter((c) => c.status === tab);
  const [icon, titulo, texto] = COURSE_EMPTY[tab];
  const counts = Object.fromEntries(COURSE_TABS.map(([k]) => [k, CO.list.filter((c) => c.status === k).length]));
  $$('.tab').forEach((t) => { const k = t.dataset.tab; t.innerHTML = `${COURSE_STATUS[k]} <span class="count">${counts[k]}</span>`; });
  $('#course-body').innerHTML = `
    <div class="co-bar"><span class="muted">${list.length} ${list.length === 1 ? 'formação' : 'formações'}</span><button class="btn primary" id="co-new">+ Nova formação</button></div>
    ${list.length ? `<div class="grid cols-3">${list.map((c) => `
      <button class="card co-card" data-id="${c.id}">
        <strong>${esc(c.nome || 'Sem nome')}</strong>
        <div class="co-meta">${c.categoria ? `<span class="chip">${esc(c.categoria)}</span>` : ''}${c.nivel ? `<span class="chip">${esc(c.nivel)}</span>` : ''}${c.estado_venda ? `<span class="chip ${c.estado_venda === 'Pausado' ? 'au-warn' : ''}">${esc(c.estado_venda)}</span>` : ''}</div>
        <div class="co-foot"><span>${eur(c.ticket) || '—'}</span><span class="muted small">Ficha ${courseFill(c)}%</span></div>
        <span class="au-bar-t co-prog"><span class="au-bar-f" style="width:${courseFill(c)}%"></span></span>
      </button>`).join('')}</div>`
    : `<div class="card empty" style="margin-top:16px"><div class="big">${icon}</div><h2>${titulo}</h2><p>${texto}</p></div>`}`;
  $('#co-new').addEventListener('click', newCourse);
  $$('.co-card').forEach((b) => b.addEventListener('click', () => openCourse(b.dataset.id)));
}

function newCourse() {
  const c = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), nome: '', status: state.courseTab, categoria: '', nivel: '', ticket: null, link_venda: '', estado_venda: '', dados: {}, created_at: new Date().toISOString() };
  CO.open = c.id; CO.draft = c; CO.isNew = true; CO.dirty = true;
  drawCourseDetail();
}
function openCourse(id) {
  const c = CO.list.find((x) => x.id === id); if (!c) return;
  CO.open = id; CO.draft = JSON.parse(JSON.stringify(c)); CO.isNew = false; CO.dirty = false;
  drawCourseDetail();
}
function closeCourse() {
  if (CO.dirty && !confirm('Tens alterações por guardar. Sair mesmo assim?')) return;
  CO.open = null; CO.draft = null; CO.dirty = false;
  renderCourses();
}

function drawCourseDetail() {
  const c = CO.draft, d = c.dados || (c.dados = {});
  const val = (k, type) => (type === 'list' ? (Array.isArray(d[k]) ? d[k].join('\n') : '') : String(d[k] ?? ''));
  $('#view').innerHTML = `
    <div class="co-top">
      <button class="btn" id="co-back">← Voltar</button>
      <div class="co-actions"><span class="muted small" id="co-state">${CO.dirty ? 'Alterações por guardar' : 'Guardado'}</span>
        ${CO.isNew ? '' : '<button class="btn danger" id="co-del">Apagar</button>'}<button class="btn primary" id="co-save">Guardar</button></div>
    </div>
    <div class="card co-head">
      <input id="co-nome" class="co-title" placeholder="Nome da formação" value="${esc(c.nome)}">
      <div class="grid cols-3 co-props">
        <label>Estado<select id="co-status">${COURSE_TABS.map(([k, l]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Categoria<input id="co-cat" type="text" list="co-cats" value="${esc(c.categoria)}" placeholder="Ex.: Gestão Financeira"><datalist id="co-cats">${[...new Set(CO.list.map((x) => x.categoria).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label>Nível<input id="co-nivel" type="text" list="co-niveis" value="${esc(c.nivel)}" placeholder="Ex.: Produto Principal"><datalist id="co-niveis">${COURSE_NIVEIS.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label>Ticket (€)<input id="co-ticket" type="number" min="0" step="0.01" value="${c.ticket ?? ''}" placeholder="147"></label>
        <label>Link de venda<input id="co-link" type="url" value="${esc(c.link_venda)}" placeholder="https://…"></label>
        <label>Estado de venda<select id="co-venda"><option value="">—</option>${['Ativo', 'Pausado'].map((x) => `<option ${c.estado_venda === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      </div>
    </div>
    ${COURSE_SECTIONS.map(([titulo, fields], i) => `
      <details class="card co-sec" ${i === 0 ? 'open' : ''}><summary>${esc(titulo)}<span class="muted small" data-fill="${i}"></span></summary>
        <div class="grid cols-2">${fields.map(([k, label, type, hint]) => `
          <label class="co-field"><span>${esc(label)}${type === 'list' ? ' <small class="muted">(um por linha)</small>' : ''}</span>
            <textarea data-k="${k}" data-type="${type}" placeholder="${esc(hint)}">${esc(val(k, type))}</textarea></label>`).join('')}</div>
      </details>`).join('')}`;
  const mark = () => { CO.dirty = true; $('#co-state').textContent = 'Alterações por guardar'; };
  const bind = (id, fn) => $(id).addEventListener('input', () => { fn($(id).value); mark(); });
  bind('#co-nome', (v) => (c.nome = v)); bind('#co-cat', (v) => (c.categoria = v)); bind('#co-nivel', (v) => (c.nivel = v));
  bind('#co-link', (v) => (c.link_venda = v)); bind('#co-ticket', (v) => (c.ticket = v === '' ? null : Number(v)));
  $('#co-status').addEventListener('change', () => { c.status = $('#co-status').value; mark(); });
  $('#co-venda').addEventListener('change', () => { c.estado_venda = $('#co-venda').value; mark(); });
  $$('.co-field textarea').forEach((t) => {
    t.addEventListener('input', () => {
      mark();
      d[t.dataset.k] = t.dataset.type === 'list' ? t.value.split('\n').map((x) => x.trim()).filter(Boolean) : t.value;
    });
  });
  $('#co-back').addEventListener('click', closeCourse);
  $('#co-save').addEventListener('click', saveCourse);
  $('#co-del')?.addEventListener('click', async () => {
    if (!confirm(`Apagar a formação “${c.nome || 'Sem nome'}”? Esta ação não se pode desfazer.`)) return;
    try { await coursesDelete(c.id); CO.open = null; CO.draft = null; CO.dirty = false; toast('Formação apagada.'); renderCourses(); }
    catch (e) { console.error(e); toast('Não foi possível apagar a formação.', true); }
  });
}

async function saveCourse() {
  const c = CO.draft;
  if (!c.nome.trim()) { toast('Dá um nome à formação antes de guardar.', true); $('#co-nome').focus(); return; }
  try {
    await coursesSave({ ...c, nome: c.nome.trim() });
    CO.isNew = false; CO.dirty = false; state.courseTab = c.status;
    $('#co-state').textContent = 'Guardado'; toast('Formação guardada.');
  } catch (e) { console.error(e); toast('Não foi possível guardar. Tenta outra vez.', true); }
}

// ---------- Parcerias ----------
const PA_ESTADOS = ['Nova', 'Em conversa', 'Em negociação', 'Aceite', 'Em curso', 'Concluída', 'Recusada'];
const PA_ABERTO = ['Nova', 'Em conversa', 'Em negociação'], PA_ATIVO = ['Aceite', 'Em curso'], PA_FECHADO_OK = ['Aceite', 'Em curso', 'Concluída'];
const PA_ESTADO_CHIP = { 'Nova': 'gray', 'Em conversa': 'au-warn', 'Em negociação': 'au-warn', 'Aceite': '', 'Em curso': '', 'Concluída': 'ok', 'Recusada': 'err' };
const PA_PAG_CHIP = { 'Por pagar': 'au-warn', 'Parcial': 'au-warn', 'Pago': 'ok', 'N/A': 'gray' };
const PA_TIPOS = ['Conteúdo patrocinado', 'Afiliação', 'Embaixadora', 'Permuta de produtos', 'Evento / Workshop', 'Cocriação', 'Outro'];
const PA_CANAIS = ['Instagram (DM)', 'E-mail', 'WhatsApp', 'Evento', 'Outro'];
const PA_PAGAMENTO = ['Dinheiro', 'Permuta (produtos/serviços)', 'Comissão / afiliação', 'Misto', 'Sem pagamento'];
const PA_FORMAS = ['Transferência bancária', 'MB Way', 'PayPal', 'Outra'];
const PA_COLS = ['nome', 'origem', 'data_sugestao', 'estado', 'tipo', 'oferta', 'pagamento_tipo', 'valor', 'forma_pagamento', 'pagamento_estado', 'data_pagamento'];
// Campos da ficha: [chave, rótulo, tipo, opções]. Tipos: text, longtext, list, date, number, url, bool, select, combo
const PA_SECTIONS = [
  ['Quem e como', [
    ['origem', 'Quem sugeriu', 'select', [['recebida', 'Recebi o convite'], ['enviada', 'Eu própria sugeri']]],
    ['data_sugestao', 'Data da sugestão / convite', 'date'],
    ['estado', 'Estado', 'select', PA_ESTADOS],
    ['tipo', 'Tipo de parceria', 'combo', PA_TIPOS],
    ['canal', 'Canal do contacto', 'combo', PA_CANAIS],
    ['contacto', 'Contacto (@, e-mail ou telefone)', 'text'],
    ['link', 'Link da proposta / briefing', 'url'],
  ]],
  ['Oferta e pagamento', [
    ['oferta', 'Oferta (o que me propõem ou o que proponho)', 'longtext'],
    ['pagamento_tipo', 'Tipo de pagamento', 'select', ['', ...PA_PAGAMENTO]],
    ['valor', 'Valor (€)', 'number'],
    ['forma_pagamento', 'Forma de pagamento', 'select', ['', ...PA_FORMAS]],
    ['pagamento_estado', 'Estado do pagamento', 'select', ['', 'Por pagar', 'Parcial', 'Pago', 'N/A']],
    ['data_pagamento', 'Data prevista de pagamento', 'date'],
    ['prazo_pagamento', 'Condições / prazo de pagamento', 'text'],
    ['permuta', 'Produtos ou serviços em permuta (e valor estimado)', 'longtext'],
    ['fatura', 'Fatura emitida', 'bool'],
  ]],
  ['O que tenho de fazer', [
    ['tarefas', 'O que é necessário da minha parte (um por linha)', 'list'],
    ['data_inicio', 'Data de início', 'date'],
    ['prazo_entrega', 'Prazo de entrega', 'date'],
    ['exclusividade', 'Exige exclusividade', 'bool'],
    ['contrato', 'Contrato assinado', 'bool'],
    ['condicoes', 'Outras condições (direitos de uso, duração, aprovações…)', 'longtext'],
  ]],
  ['Seguimento', [
    ['proximo_passo', 'Próximo passo', 'text'],
    ['data_followup', 'Data de seguimento', 'date'],
    ['notas', 'Notas', 'longtext'],
  ]],
];
const PA = { list: [], loaded: false, open: null, draft: null, dirty: false, isNew: false, q: '', estado: '', origem: '' };
const LS_PA = 'painel_parcerias';

async function paLoad() {
  if (sb) {
    const { data, error } = await sb.from('parcerias').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    PA.list = data || [];
  } else {
    try { PA.list = JSON.parse(localStorage.getItem(LS_PA) || '[]'); } catch { PA.list = []; }
  }
  PA.loaded = true;
}
async function paSave(c) {
  c.updated_at = new Date().toISOString();
  if (sb) { const { error } = await sb.from('parcerias').upsert(c); if (error) throw error; }
  const i = PA.list.findIndex((x) => x.id === c.id);
  if (i >= 0) PA.list[i] = c; else PA.list.push(c);
  if (!sb) { try { localStorage.setItem(LS_PA, JSON.stringify(PA.list)); } catch { /* sem armazenamento */ } }
}
async function paDelete(id) {
  if (sb) { const { error } = await sb.from('parcerias').delete().eq('id', id); if (error) throw error; }
  PA.list = PA.list.filter((x) => x.id !== id);
  if (!sb) { try { localStorage.setItem(LS_PA, JSON.stringify(PA.list)); } catch { /* sem armazenamento */ } }
}
const paGet = (c, k) => (PA_COLS.includes(k) ? c[k] : (c.dados || {})[k]);
const paSet = (c, k, v) => { if (PA_COLS.includes(k)) c[k] = v; else (c.dados ||= {})[k] = v; };
const paNum = (c) => (c.valor == null || c.valor === '' ? 0 : Number(c.valor));
const paChip = (txt, cls) => (txt ? `<span class="chip ${cls || ''}">${esc(txt)}</span>` : '');

async function renderPartnerships() {
  if (PA.open) return drawPartnerDetail();
  $('#view').innerHTML = `<div class="page-head"><h1>🤝 Parcerias</h1></div><div id="pa-body"><div class="card empty"><p>A carregar…</p></div></div>`;
  if (!PA.loaded) {
    try { await paLoad(); } catch (e) { console.error(e); return ($('#pa-body').innerHTML = '<div class="card empty"><p>Não foi possível carregar as parcerias.</p></div>'); }
    if (state.route !== 'partnerships' || PA.open) return;
  }
  drawPartnerList();
}

function drawPartnerList() {
  const L = PA.list, q = PA.q.trim().toLowerCase();
  const money = (arr) => arr.filter((c) => PA_FECHADO_OK.includes(c.estado) && ['Dinheiro', 'Misto'].includes(c.pagamento_tipo));
  const acordado = money(L).reduce((s, c) => s + paNum(c), 0);
  const porReceber = money(L).filter((c) => !['Pago', 'N/A'].includes(c.pagamento_estado)).reduce((s, c) => s + paNum(c), 0);
  const counts = Object.fromEntries(PA_ESTADOS.map((e) => [e, L.filter((c) => c.estado === e).length]));
  let rows = L.filter((c) => (!PA.estado || c.estado === PA.estado) && (!PA.origem || c.origem === PA.origem)
    && (!q || [c.nome, c.oferta, c.tipo, c.dados?.contacto].some((x) => String(x ?? '').toLowerCase().includes(q))));
  rows = rows.sort((a, b) => String(b.data_sugestao || b.created_at).localeCompare(String(a.data_sugestao || a.created_at)));
  $('#pa-body').innerHTML = `
    <div class="grid cols-5 pa-kpis">
      <div class="card"><div class="stat-l">Parcerias</div><div class="stat-n">${fmt(L.length)}</div></div>
      <div class="card"><div class="stat-l">Em aberto</div><div class="stat-n">${fmt(L.filter((c) => PA_ABERTO.includes(c.estado)).length)}</div><div class="muted small">novas, em conversa ou negociação</div></div>
      <div class="card"><div class="stat-l">Ativas</div><div class="stat-n">${fmt(L.filter((c) => PA_ATIVO.includes(c.estado)).length)}</div><div class="muted small">aceites ou em curso</div></div>
      <div class="card"><div class="stat-l">Valor acordado</div><div class="stat-n">${eur(acordado) || '0 €'}</div><div class="muted small">em dinheiro</div></div>
      <div class="card"><div class="stat-l">Por receber</div><div class="stat-n">${eur(porReceber) || '0 €'}</div><div class="muted small">ainda não pago</div></div>
    </div>
    <div class="pa-pipe">
      <button class="au-pill ${PA.estado === '' ? 'active' : ''}" data-e="">Todas <span class="count">${L.length}</span></button>
      ${PA_ESTADOS.map((e) => `<button class="au-pill ${PA.estado === e ? 'active' : ''}" data-e="${e}">${e} <span class="count">${counts[e]}</span></button>`).join('')}
    </div>
    <div class="toolbar">
      <input type="text" id="pa-q" placeholder="Pesquisar marca, pessoa, oferta…" value="${esc(PA.q)}">
      <select id="pa-origem"><option value="">Quem sugeriu: todos</option><option value="recebida" ${PA.origem === 'recebida' ? 'selected' : ''}>Recebi o convite</option><option value="enviada" ${PA.origem === 'enviada' ? 'selected' : ''}>Eu própria sugeri</option></select>
      <button class="btn primary" id="pa-new">+ Nova parceria</button>
    </div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl pa-tbl"><thead><tr>
      <th>Marca / pessoa</th><th>Origem</th><th>Data</th><th>Tipo</th><th>Oferta</th><th>Pagamento</th><th>Estado do pagamento</th><th>Prazo de entrega</th><th>Estado</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="pa-row" data-id="${c.id}">
        <td><strong>${esc(c.nome || 'Sem nome')}</strong></td>
        <td>${c.origem === 'enviada' ? paChip('Eu sugeri', 'gray') : paChip('Convite', '')}</td>
        <td>${c.data_sugestao ? fmtDate(c.data_sugestao) : '—'}</td>
        <td>${esc(c.tipo || '—')}</td>
        <td class="pa-oferta" title="${esc(c.oferta || '')}">${esc(c.oferta || '—')}</td>
        <td>${esc(c.pagamento_tipo ? c.pagamento_tipo.replace(/ \(.*\)/, '') : '—')}${paNum(c) ? ` · <strong>${eur(c.valor)}</strong>` : ''}${c.forma_pagamento ? `<div class="muted small">${esc(c.forma_pagamento)}</div>` : ''}</td>
        <td>${paChip(c.pagamento_estado, PA_PAG_CHIP[c.pagamento_estado]) || '—'}</td>
        <td>${c.dados?.prazo_entrega ? fmtDate(c.dados.prazo_entrega) : '—'}</td>
        <td>${paChip(c.estado, PA_ESTADO_CHIP[c.estado])}</td></tr>`).join('')}
      </tbody></table></div>`
    : `<div class="card empty"><div class="big">🤝</div><h2>${L.length ? 'Nenhuma parceria com estes filtros' : 'Ainda não há parcerias'}</h2><p>${L.length ? 'Limpa a pesquisa ou escolhe outro estado.' : 'Carrega em “+ Nova parceria” para registares a primeira, seja um convite que recebeste ou uma proposta tua.'}</p></div>`}`;
  $('#pa-new').addEventListener('click', newPartner);
  $('#pa-q').addEventListener('input', (e) => { PA.q = e.target.value; const p = e.target.selectionStart; drawPartnerList(); const n = $('#pa-q'); n.focus(); n.setSelectionRange(p, p); });
  $('#pa-origem').addEventListener('change', (e) => { PA.origem = e.target.value; drawPartnerList(); });
  $$('.pa-pipe .au-pill').forEach((b) => b.addEventListener('click', () => { PA.estado = b.dataset.e; drawPartnerList(); }));
  $$('.pa-row').forEach((r) => r.addEventListener('click', () => openPartner(r.dataset.id)));
}

function newPartner() {
  const c = { id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), nome: '', origem: 'recebida', data_sugestao: new Date().toISOString().slice(0, 10), estado: 'Nova', tipo: '', oferta: '', pagamento_tipo: '', valor: null, forma_pagamento: '', pagamento_estado: '', data_pagamento: null, dados: {}, created_at: new Date().toISOString() };
  PA.open = c.id; PA.draft = c; PA.isNew = true; PA.dirty = true; drawPartnerDetail();
}
function openPartner(id) {
  const c = PA.list.find((x) => x.id === id); if (!c) return;
  PA.open = id; PA.draft = JSON.parse(JSON.stringify(c)); PA.isNew = false; PA.dirty = false; drawPartnerDetail();
}
function closePartner() {
  if (PA.dirty && !confirm('Tens alterações por guardar. Sair mesmo assim?')) return;
  PA.open = null; PA.draft = null; PA.dirty = false; renderPartnerships();
}

function paField(c, [k, label, type, opts]) {
  const v = paGet(c, k);
  const lbl = `<span>${esc(label)}</span>`;
  if (type === 'bool') return `<label class="co-field pa-bool"><input type="checkbox" data-k="${k}" data-type="bool" ${v ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  if (type === 'longtext') return `<label class="co-field pa-wide">${lbl}<textarea data-k="${k}" data-type="text">${esc(v ?? '')}</textarea></label>`;
  if (type === 'list') return `<label class="co-field pa-wide">${lbl}<textarea data-k="${k}" data-type="list" placeholder="Ex.: 2 reels, 3 stories com link, 1 post de carrossel">${esc(Array.isArray(v) ? v.join('\n') : '')}</textarea></label>`;
  if (type === 'select') return `<label class="co-field">${lbl}<select data-k="${k}" data-type="text">${opts.map((o) => { const [val, tx] = Array.isArray(o) ? o : [o, o || '—']; return `<option value="${esc(val)}" ${String(v ?? '') === val ? 'selected' : ''}>${esc(tx)}</option>`; }).join('')}</select></label>`;
  if (type === 'combo') return `<label class="co-field">${lbl}<input type="text" list="pa-dl-${k}" data-k="${k}" data-type="text" value="${esc(v ?? '')}"><datalist id="pa-dl-${k}">${opts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist></label>`;
  return `<label class="co-field">${lbl}<input type="${type === 'number' ? 'number' : type}" ${type === 'number' ? 'min="0" step="0.01"' : ''} data-k="${k}" data-type="${type}" value="${esc(v ?? '')}"></label>`;
}

function drawPartnerDetail() {
  const c = PA.draft;
  $('#view').innerHTML = `
    <div class="co-top">
      <button class="btn" id="pa-back">← Voltar</button>
      <div class="co-actions"><span class="muted small" id="pa-state">${PA.dirty ? 'Alterações por guardar' : 'Guardado'}</span>
        ${PA.isNew ? '' : '<button class="btn danger" id="pa-del">Apagar</button>'}<button class="btn primary" id="pa-save">Guardar</button></div>
    </div>
    <div class="card co-head"><input id="pa-nome" type="text" class="co-title" placeholder="Nome da marca ou pessoa" value="${esc(c.nome)}">
      <div class="grid cols-3 co-props">${PA_SECTIONS[0][1].map((f) => paField(c, f)).join('')}</div></div>
    ${PA_SECTIONS.slice(1).map(([t, fields]) => `<div class="card co-sec pa-sec"><h3>${esc(t)}</h3><div class="grid cols-3 co-props">${fields.map((f) => paField(c, f)).join('')}</div></div>`).join('')}`;
  const mark = () => { PA.dirty = true; $('#pa-state').textContent = 'Alterações por guardar'; };
  $('#pa-nome').addEventListener('input', (e) => { c.nome = e.target.value; mark(); });
  $$('[data-k]').forEach((el) => {
    const upd = () => {
      const t = el.dataset.type; let v;
      if (t === 'bool') v = el.checked;
      else if (t === 'list') v = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
      else if (t === 'number') v = el.value === '' ? null : Number(el.value);
      else if (t === 'date') v = el.value || null;
      else v = el.value;
      paSet(c, el.dataset.k, v); mark();
    };
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', upd);
  });
  $('#pa-back').addEventListener('click', closePartner);
  $('#pa-save').addEventListener('click', savePartner);
  $('#pa-del')?.addEventListener('click', async () => {
    if (!confirm(`Apagar a parceria “${c.nome || 'Sem nome'}”? Esta ação não se pode desfazer.`)) return;
    try { await paDelete(c.id); PA.open = null; PA.draft = null; PA.dirty = false; toast('Parceria apagada.'); renderPartnerships(); }
    catch (e) { console.error(e); toast('Não foi possível apagar a parceria.', true); }
  });
}

async function savePartner() {
  const c = PA.draft;
  if (!c.nome.trim()) { toast('Dá um nome à marca ou pessoa antes de guardar.', true); $('#pa-nome').focus(); return; }
  try {
    await paSave({ ...c, nome: c.nome.trim() });
    PA.isNew = false; PA.dirty = false; $('#pa-state').textContent = 'Guardado'; toast('Parceria guardada.');
  } catch (e) { console.error(e); toast('Não foi possível guardar. Tenta outra vez.', true); }
}

// ---------- Instagram ----------
function renderInstagram() {
  $('#view').innerHTML = `
    <div class="page-head"><h1>📸 Automação do Instagram</h1><p class="muted">Métricas e automações de direct.</p></div>
    <div class="tabs">
      <button class="tab" data-tab="metrics">Métricas</button>
      <button class="tab" data-tab="automations">Automações</button>
      <button class="tab" data-tab="interactions">Interações</button>
    </div>
    <div id="ig-body"></div>`;
  $$('.tab').forEach((t) => t.addEventListener('click', () => { state.igTab = t.dataset.tab; renderInstagram(); }));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.igTab));
  if (state.igTab === 'metrics') renderMetrics();
  else if (state.igTab === 'interactions') renderLeads();
  else renderAutomations();
}

// Número com separador de milhares em português (ex: 1.721)
const fmt = (n) => Number(n).toLocaleString('pt-PT');

// Data AAAA-MM-DD para dia/mês/ano (ex: 09/09/2026)
const fmtDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso);

function bars(series) {
  const max = Math.max(1, ...series.map((p) => p.value));
  return `<div class="bars${series.length > 60 ? ' dense' : ''}">${series.map((p) => `<div class="bar-col" data-tip="${esc(fmtDate(p.date))}: ${p.value}"><div class="bar" style="height:${Math.max(2, (p.value / max) * 100)}%"></div></div>`).join('')}</div>`;
}

// Miniatura do post ligado à automação (1.º post + "+N" se houver mais; ícone se for para todos)
function thumbHTML(ids) {
  if (!ids.length) return '<span class="thumb all" title="Vale para todos os posts"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>';
  return `<a class="thumb" data-m="${esc(ids[0])}" target="_blank" rel="noopener" title="Ver o post no Instagram"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg>${ids.length > 1 ? `<span class="more">+${ids.length - 1}</span>` : ''}</a>`;
}

// Vai buscar as fotos dos posts (as ligações do Instagram expiram, por isso pede-se de cada vez)
async function fillThumbs(box, list) {
  const ids = [...new Set(list.flatMap((a) => a.media_ids || []))];
  if (!sb || !ids.length) return;
  let map = {};
  try {
    const r = await sb.functions.invoke('ig-media', { body: { ids } });
    (r.data?.posts || []).forEach((p) => { map[p.id] = p; });
  } catch { return; }
  $$('.thumb[data-m]', box).forEach((el) => {
    const post = map[el.dataset.m]; if (!post) return;
    const img = post.thumbnail_url || post.media_url; if (!img) return;
    el.style.backgroundImage = `url("${img}")`;
    el.classList.add('has-img'); el.innerHTML = el.innerHTML.replace(/<svg[\s\S]*?<\/svg>/, '');
    if (post.permalink) el.href = post.permalink; else el.removeAttribute('href');
    el.title = (post.caption || 'Ver o post no Instagram').slice(0, 120);
  });
}


// ---------- Cartões do topo das Automações: Leads captados e Saúde do envio ----------
// Tira o essencial de uma mensagem de erro guardada (ex: "Graph 400: The comment is invalid...")
function cleanMotivo(m) {
  const t = String(m || '');
  const msg = t.match(/"message":"((?:[^"\\]|\\.)*)"/)?.[1];
  const code = t.match(/"code":(\d+)/)?.[1];
  const base = (msg || t || 'Erro desconhecido').replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
  return (code ? `Graph ${code}: ` : '') + (base.length > 110 ? base.slice(0, 107) + '...' : base);
}

async function loadHealth() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [ok, erro, fila, leads, novos] = await Promise.all([
    safeCount('ig_deliveries', (q) => q.eq('status', 'ok').gte('ts', since)),
    safeCount('ig_deliveries', (q) => q.eq('status', 'erro').gte('ts', since)),
    safeCount('ig_send_queue', (q) => q.in('status', ['pendente', 'expirado']).gte('created_at', since)),
    safeCount('ig_leads'),
    safeCount('ig_leads', (q) => q.gte('created_at', since)),
  ]);
  let motivos = [];
  if (sb && erro) {
    try { const { data } = await sb.from('ig_deliveries').select('motivo').eq('status', 'erro').gte('ts', since).limit(1000); motivos = data || []; } catch { /* sem motivos */ }
  }
  const m = {}; motivos.forEach((r) => { const k = cleanMotivo(r.motivo); m[k] = (m[k] || 0) + 1; });
  const topMotivos = Object.entries(m).map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n).slice(0, 3);
  return { ok, erro, fila, leads, novos, topMotivos };
}

async function drawHealth(list) {
  const box = $('#auto-top'); if (!box) return;
  const h = await loadHealth();
  if (state.igTab !== 'automations' || state.route !== 'instagram' || !$('#auto-top')) return;
  const total = h.ok + h.erro + h.fila;
  const ativas = list.filter((a) => a.active).length;
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const taxa = h.ok + h.erro ? Math.round((h.ok / (h.ok + h.erro)) * 100) : null;
  box.innerHTML = `
    <div class="card hl"><div class="stat-l">Leads captados</div><div class="stat-n">${fmt(h.leads)}</div>
      <div class="stat-sub">${fmt(h.novos)} ${h.novos === 1 ? 'novo' : 'novos'} · 30 dias</div></div>
    <div class="card">
      <div class="row between"><h3 style="margin:0">🩺 Saúde do envio <span class="muted small">últimos 30 dias</span></h3>
        <span class="chip ${ativas ? '' : 'gray'}">${ativas} ${ativas === 1 ? 'automação ativa' : 'automações ativas'}</span></div>
      ${total ? `
        <div class="health-bar" role="img" aria-label="${h.ok} entregues, ${h.erro} falharam, ${h.fila} na fila ou expirados">
          <span style="width:${pct(h.ok)}%;background:var(--ok)"></span><span style="width:${pct(h.erro)}%;background:var(--err)"></span><span style="width:${pct(h.fila)}%;background:var(--accent-mid)"></span>
        </div>
        <div class="health-legend">
          <span><i style="background:var(--ok)"></i><b>${fmt(h.ok)}</b> ${h.ok === 1 ? 'entregue' : 'entregues'}</span>
          <span><i style="background:var(--err)"></i><b>${fmt(h.erro)}</b> ${h.erro === 1 ? 'falhou' : 'falharam'}</span>
          <span><i style="background:var(--accent-mid)"></i><b>${fmt(h.fila)}</b> na fila ou expirados</span>
          ${taxa == null ? '' : `<span class="muted">Taxa de entrega: <b>${taxa}%</b></span>`}
        </div>
        ${h.topMotivos.length ? `<div class="health-errs">${h.topMotivos.map((e) => `<div><span title="${esc(e.t)}">${esc(e.t)}</span><b>${fmt(e.n)}</b></div>`).join('')}</div>` : ''}`
      : '<p class="muted" style="margin:12px 0 0">Ainda não há envios nos últimos 30 dias. Quando alguém comentar uma das tuas palavras, o estado dos envios aparece aqui.</p>'}
    </div>`;
}

// ---------- Lista de automações ----------
async function renderAutomations() {
  const body = $('#ig-body');
  body.innerHTML = `
    <div id="auto-top" class="top-auto"></div>
    <div class="row between" style="margin-bottom:14px">
      <div><h2>✉️ Automações</h2><p class="muted small" style="margin:0">Respostas automáticas de DM a partir de comentários.</p></div>
      <button class="btn primary" id="new-auto">Nova automação</button>
    </div>
    <div class="card" id="auto-list"><div class="muted">A carregar...</div></div>`;
  $('#new-auto').addEventListener('click', () => openEditor(null));

  let list = [];
  if (sb) { try { const { data } = await sb.from('ig_automations').select('*').order('updated_at', { ascending: false }); list = data || []; } catch {} }
  if (state.igTab !== 'automations' || state.route !== 'instagram') return;
  drawHealth(list);
  const box = $('#auto-list');
  if (!list.length) {
    box.innerHTML = `<div class="empty"><div class="big">✉</div><h3>Ainda não tens automações</h3>
      <p>Cria a primeira para responder por direct a quem comentar uma palavra.</p></div>`;
    return;
  }
  box.innerHTML = list.map((a) => {
    const ids = a.media_ids || [];
    return `
    <div class="auto-item" data-id="${esc(a.id)}">
      <div class="auto-main">
        ${thumbHTML(ids)}
        <div>
          <strong>${esc(a.nome || 'Sem nome')}</strong>
          <div>${a.match_any ? '<span class="chip gray">qualquer palavra</span>' : (a.keyword || '').split(',').filter(Boolean).map((k) => `<span class="chip">${esc(k.trim())}</span>`).join('')}</div>
        </div>
      </div>
      <div class="row">
        <label class="switch" title="Ligar ou desligar"><input type="checkbox" data-act="toggle" ${a.active ? 'checked' : ''}><span class="slider"></span></label>
        <button class="btn sm" data-act="edit">Editar</button>
        <button class="btn sm danger" data-act="del">Apagar</button>
      </div>
    </div>`; }).join('');
  fillThumbs(box, list);
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
// INTERAÇÕES: todos os leads captados (Tabela, Planilha ou Gráfico)
// ============================================================
const ORIGENS = { comment: 'Comentário', dm: 'Direct', story_reply: 'Resposta a story' };
const ORIGEM_ICO = { comment: '💬', dm: '📩', story_reply: '↩️' };
const origemTxt = (o) => ORIGENS[o] || (o ? o : '-');
const L = { rows: [], q: '', origem: '', etiqueta: '', automacao: '', sortK: 'updated_at', sortDir: -1, page: 1, size: 25 };

// Data e hora em português: 09/09/2026 14:30
const fmtDateTime = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso); if (isNaN(d)) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Vai buscar todos os leads (a base de dados devolve no máximo 1000 linhas por pedido)
async function loadLeads() {
  if (!sb) return [];
  const all = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await sb.from('ig_leads_view').select('*').order('updated_at', { ascending: false }).range(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

async function renderLeads() {
  const body = $('#ig-body');
  body.innerHTML = '<div class="card muted">A carregar contactos...</div>';
  try { L.rows = await loadLeads(); } catch (e) { console.error(e); L.rows = []; }
  if (state.route !== 'instagram' || state.igTab !== 'interactions') return;
  if (!L.rows.length) {
    body.innerHTML = `<div class="card empty"><div class="big">☺</div><h2>Ainda não há contactos</h2>
      <p>Quando alguém comentar uma das tuas palavras e receber a DM, aparece aqui.</p></div>`;
    return;
  }
  drawLeads();
}

// Linhas depois de filtros e ordenação
function leadsFiltered() {
  const q = L.q.trim().toLowerCase();
  let r = L.rows.filter((x) =>
    (!L.origem || x.last_source === L.origem) &&
    (!L.etiqueta || (x.tags || []).includes(L.etiqueta)) &&
    (!L.automacao || (x.automacao_nome || '') === L.automacao) &&
    (!q || [x.username, x.last_keyword, x.email, x.telefone, x.automacao_nome, (x.tags || []).join(' ')].some((v) => String(v || '').toLowerCase().includes(q))));
  const k = L.sortK, d = L.sortDir;
  const val = (x) => (k === 'contacto' ? (x.email || x.telefone || '') : x[k]);
  r.sort((a, b) => {
    const va = val(a) ?? '', vb = val(b) ?? '';
    if (typeof va === 'number' || typeof vb === 'number') return ((va || 0) - (vb || 0)) * d;
    return String(va).localeCompare(String(vb), 'pt') * d;
  });
  return r;
}

// Colunas da tabela: Conta, Origem, Palavra, Contacto, Etiqueta, Recebeu?, Interações, Última vez
const COLS_TABLE = [
  { k: 'username', t: 'Conta' }, { k: 'last_source', t: 'Origem' }, { k: 'last_keyword', t: 'Palavra' },
  { k: 'contacto', t: 'Contacto' }, { k: 'tags', t: 'Etiqueta', nosort: true }, { k: 'envios_ok', t: 'Recebeu?' },
  { k: 'interacoes', t: 'Interações' }, { k: 'updated_at', t: 'Última vez' },
];
function cellHTML(x, k, sheet) {
  const dash = '<span class="muted">-</span>';
  switch (k) {
    case 'username': return x.username ? `<a class="acct" href="https://instagram.com/${encodeURIComponent(x.username)}" target="_blank" rel="noopener">@${esc(x.username)}</a>` : `<span class="muted">ID ${esc(x.ig_user_id)}</span>`;
    case 'last_source': return `<span class="src">${ORIGEM_ICO[x.last_source] || ''} ${esc(origemTxt(x.last_source))}</span>`;
    case 'last_keyword': return x.last_keyword ? esc(x.last_keyword) : dash;
    case 'automacao_nome': return esc(x.automacao_nome || '-');
    case 'contacto': return [x.email, x.telefone].filter(Boolean).map(esc).join('<br>') || dash;
    case 'email': case 'telefone': case 'flow_step': case 'ig_user_id': return esc(x[k] ?? '');
    case 'tags': return `<span class="tags-cell" data-a="edit-tags" data-id="${esc(x.ig_user_id)}" title="Clicar para editar">${(x.tags || []).length ? (x.tags || []).map((t) => `<span class="chip gray">${esc(t)}</span>`).join('') : '<span class="muted">+ etiqueta</span>'}</span>`;
    case 'envios_ok': return (x.envios_ok > 0 ? 'Sim' : (x.envios_erro > 0 ? 'Erro' : dash));
    case 'interacoes': return String(x.interacoes ?? 0);
    case 'link_sent': return x.link_sent ? 'Sim' : 'Não';
    case 'created_at': case 'updated_at': return fmtDateTime(x[k]);
  }
  return '';
}

function drawLeads() {
  const body = $('#ig-body');
  const rows = L.rows;
  const total = rows.length;
  const comLink = rows.filter((r) => r.link_sent).length;
  const novos30 = rows.filter((r) => new Date(r.created_at).getTime() >= Date.now() - 30 * 864e5).length;
  const ativos7 = rows.filter((r) => new Date(r.updated_at).getTime() >= Date.now() - 7 * 864e5).length;
  const comContacto = rows.filter((r) => r.email || r.telefone).length;
  // Novos contactos por dia (últimos 30 dias)
  const perDay = {};
  rows.forEach((r) => { const k = String(r.created_at).slice(0, 10); perDay[k] = (perDay[k] || 0) + 1; });
  const serie = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10); return { date: d, value: perDay[d] || 0 }; });

  const uniq = (f) => [...new Set(L.rows.flatMap(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  const opt = (arr, cur, label) => `<option value="">${label}</option>` + arr.map((v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const origens = [...new Set(L.rows.map((x) => x.last_source).filter(Boolean))];

  body.innerHTML = `
    <div class="grid cols-4">
      <div class="card hl"><div class="stat-l">Contactos</div><div class="stat-n">${fmt(total)}</div><div class="stat-sub">${fmt(novos30)} ${novos30 === 1 ? 'novo' : 'novos'} · 30 dias</div></div>
      <div class="card"><div class="stat-l">Últimos 7 dias</div><div class="stat-n">${fmt(ativos7)}</div><div class="stat-sub">Movimento recente</div></div>
      <div class="card"><div class="stat-l">Link enviado</div><div class="stat-n">${fmt(comLink)}</div><div class="stat-sub">Receberam o link na conversa</div></div>
      <div class="card"><div class="stat-l">Deixaram contacto</div><div class="stat-n">${fmt(comContacto)}</div><div class="stat-sub">E-mail ou telefone na conversa</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Novos contactos <span class="muted small">por dia · 30 dias</span></h3>${bars(serie)}</div>
    <div class="toolbar" style="margin-top:16px">
      <input type="text" id="l-q" placeholder="Procurar por @ ou palavra..." value="${esc(L.q)}">
      <select id="l-origem"><option value="">Todas as origens</option>${origens.map((o) => `<option value="${esc(o)}" ${o === L.origem ? 'selected' : ''}>${esc(origemTxt(o))}</option>`).join('')}</select>
      <select id="l-etiqueta">${opt(uniq((x) => x.tags || []), L.etiqueta, 'Todas as etiquetas')}</select>
      <select id="l-auto">${opt(uniq((x) => [x.automacao_nome]), L.automacao, 'Todas as automações')}</select>
      <button class="btn" id="l-csv">⬇ Exportar CSV</button>
    </div>
    <div id="l-body"></div>`;

  $('#l-q').addEventListener('input', (e) => { L.q = e.target.value; L.page = 1; drawLeadsBody(); });
  $('#l-origem').addEventListener('change', (e) => { L.origem = e.target.value; L.page = 1; drawLeadsBody(); });
  $('#l-etiqueta').addEventListener('change', (e) => { L.etiqueta = e.target.value; L.page = 1; drawLeadsBody(); });
  $('#l-auto').addEventListener('change', (e) => { L.automacao = e.target.value; L.page = 1; drawLeadsBody(); });
  $('#l-csv').addEventListener('click', exportLeadsCSV);
  drawLeadsBody();
}

function drawLeadsBody() {
  const box = $('#l-body'); if (!box) return;
  const all = leadsFiltered();
  const pages = Math.max(1, Math.ceil(all.length / L.size));
  if (L.page > pages) L.page = pages;
  const rows = all.slice((L.page - 1) * L.size, L.page * L.size);
  const arrow = (k) => (L.sortK === k ? (L.sortDir > 0 ? ' ▲' : ' ▼') : '');
  const cols = COLS_TABLE;

  box.innerHTML = `
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>${cols.map((c) => `<th ${c.nosort ? '' : `data-sort="${c.k}"`}>${c.t}${arrow(c.k)}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map((x) => `<tr>${cols.map((c) => `<td>${cellHTML(x, c.k, false)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="muted" style="text-align:center;padding:28px">Nenhum contacto com estes filtros.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="row between" style="margin-top:12px">
      <div class="row"><span class="muted small">Linhas por página</span>
        <select id="l-size" style="width:auto">${[25, 50, 100].map((n) => `<option ${n === L.size ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="row"><button class="btn sm" id="l-prev" ${L.page <= 1 ? 'disabled' : ''}>Anterior</button>
        <span class="small">${L.page} / ${pages}</span>
        <button class="btn sm" id="l-next" ${L.page >= pages ? 'disabled' : ''}>Seguinte</button></div></div>`;

  $$('[data-sort]', box).forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort; L.sortDir = L.sortK === k ? -L.sortDir : (['updated_at', 'created_at', 'interacoes', 'envios_ok'].includes(k) ? -1 : 1); L.sortK = k; drawLeadsBody();
  }));
  $$('[data-a=edit-tags]', box).forEach((el) => el.addEventListener('click', () => editTags(el.dataset.id)));
  $('#l-size').addEventListener('change', (e) => { L.size = +e.target.value; L.page = 1; drawLeadsBody(); });
  $('#l-prev').addEventListener('click', () => { L.page--; drawLeadsBody(); });
  $('#l-next').addEventListener('click', () => { L.page++; drawLeadsBody(); });
}

// Editar etiquetas de um contacto (separadas por vírgula)
async function editTags(id) {
  const x = L.rows.find((r) => r.ig_user_id === id); if (!x) return;
  const txt = prompt('Etiquetas deste contacto (separadas por vírgula):', (x.tags || []).join(', '));
  if (txt === null) return;
  const tags = [...new Set(txt.split(',').map((t) => t.trim()).filter(Boolean))];
  const { error } = await sb.from('ig_leads').update({ tags }).eq('ig_user_id', id);
  if (error) return toast('Não foi possível guardar as etiquetas.', true);
  x.tags = tags; drawLeads(); toast('Etiquetas guardadas.');
}

// Exporta a lista filtrada para CSV (abre no Excel / Numbers / Google Sheets)
function exportLeadsCSV() {
  const rows = leadsFiltered();
  const head = ['Perfil', 'ID Instagram', 'Origem', 'Palavra', 'Automação', 'E-mail', 'Telefone', 'Etiquetas', 'Interações', 'Link enviado', 'Passo', 'Primeira vez', 'Última vez'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((x) => [x.username ? '@' + x.username : '', x.ig_user_id, origemTxt(x.last_source), x.last_keyword, x.automacao_nome, x.email, x.telefone, (x.tags || []).join(', '), x.interacoes, x.link_sent ? 'Sim' : 'Não', x.flow_step, fmtDateTime(x.created_at), fmtDateTime(x.updated_at)].map(cell).join(';'));
  const blob = new Blob(['﻿' + [head.map(cell).join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `interacoes-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}


// ============================================================
// MÉTRICAS: cartões por período, crescimento e alcance por dia, melhores posts e quem mais comenta
// (o resultado fica guardado na tabela ig_analysis e só atualiza quando se carrega em "Atualizar")
// ============================================================
const AN = { data: null, updated: null, period: '30', sort: 'best', loading: false };
const AN_PERIODS = [['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias'], ['90', '90 dias'], ['all', 'Tudo']];
const AN_SORTS = [['best', 'Melhores'], ['likes', 'Mais curtidos'], ['comments', 'Mais comentados'], ['saves', 'Mais guardados'], ['views', 'Mais vistos']];
const anDays = () => (AN.period === 'all' ? null : Number(AN.period));
const anLabel = () => (AN.period === 'all' ? 'Tudo' : `${AN.period} dias`);

async function renderMetrics() {
  $('#ig-body').innerHTML = '<div class="card muted">A carregar métricas...</div>';
  AN.leads = await safeCount('ig_leads');
  if (sb) {
    try {
      const { data } = await sb.from('ig_analysis').select('data,updated_at').eq('id', 'main').maybeSingle();
      if (data) { AN.data = data.data; AN.updated = data.updated_at; }
    } catch (e) { console.error(e); }
  }
  if (state.route !== 'instagram' || state.igTab !== 'metrics') return;
  drawAnalysis();
}

// Pede à função para recalcular tudo (pode demorar cerca de 1 minuto)
async function runAnalysis() {
  if (!sb) return toast('Liga o Instagram e o Supabase para atualizar a análise.', true);
  if (AN.loading) return;
  AN.loading = true; drawAnalysis();
  try {
    const r = await sb.functions.invoke('ig-analysis');
    const err = r.error?.message || r.data?.error;
    if (err) throw new Error(err);
    AN.data = r.data.data; AN.updated = r.data.updated_at;
    toast('Análise atualizada.');
  } catch (e) { console.error(e); toast('Não foi possível atualizar a análise. Tenta outra vez daqui a pouco.', true); }
  AN.loading = false;
  if (state.route === 'instagram' && state.igTab === 'metrics') drawAnalysis();
}

function drawAnalysis() {
  const body = $('#ig-body');
  const d = AN.data;
  const btn = `<button class="btn" id="an-refresh" ${AN.loading ? 'disabled' : ''}>${AN.loading ? 'A atualizar...' : '↻ Atualizar'}</button>`;
  const bind = () => $('#an-refresh')?.addEventListener('click', runAnalysis);

  if (!d) {
    body.innerHTML = `<div class="card empty"><div class="big">📊</div><h2>${sb ? 'Ainda não há métricas' : 'Liga o teu Instagram para ver as métricas'}</h2>
      <p>${sb ? 'Carrega em Atualizar para analisar os teus posts, o alcance e quem mais comenta.<br>Pode demorar cerca de 1 minuto.' : 'Depois de ligares a conta (ver LEIA-ME), aqui vais ver seguidores, alcance, melhores posts e muito mais.'}</p>
      ${sb ? `<div style="margin-top:14px">${btn.replace('class="btn"', 'class="btn primary"')}</div>` : ''}</div>
      <div class="grid cols-3" style="margin-top:16px"><div class="card hl"><div class="stat-l">Leads captados</div><div class="stat-n">${fmt(AN.leads || 0)}</div></div></div>`;
    return bind();
  }

  // Cartões: totais de 7 ou 30 dias (a API só calcula contas únicas até 30 dias)
  const wd = ['7', '15'].includes(AN.period) ? Number(AN.period) : 30;
  const w = d.windows[wd] || d.windows['30'] || {};
  const dash = (v) => (v == null ? '-' : fmt(v));

  // Alcance por dia
  const n = anDays();
  const serie = n ? d.reach_daily.slice(-n) : d.reach_daily;
  // Novos seguidores por dia: a API só devolve os últimos 30 dias
  const growth = (d.followers_by_day || []).slice(-(n && n < 30 ? n : 30));

  // Melhores posts do período
  const cutoff = n ? Date.now() - n * 864e5 : 0;
  const key = { best: 'interactions', likes: 'likes', comments: 'comments', saves: 'saves', views: 'views' }[AN.sort];
  const posts = d.posts.filter((p) => new Date(p.ts).getTime() >= cutoff).sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 12);

  body.innerHTML = `
    <div class="row between" style="margin-bottom:16px">
      <div class="pills">${AN_PERIODS.map(([v, t]) => `<button class="${AN.period === v ? 'on' : ''}" data-period="${v}">${t}</button>`).join('')}</div>
      ${btn}
    </div>
    <div class="grid cols-6">
      <div class="card"><div class="stat-l">Seguidores</div><div class="stat-n">${fmt(d.followers)}</div><div class="stat-sub">Total atual</div></div>
      <div class="card hl"><div class="stat-l">Leads captados</div><div class="stat-n">${fmt(AN.leads || 0)}</div><div class="stat-sub">Total de contactos</div></div>
      <div class="card"><div class="stat-l">Novos seg.</div><div class="stat-n">${dash(w.new_followers)}</div><div class="stat-sub">Últimos ${wd} dias</div></div>
      <div class="card"><div class="stat-l">Alcance</div><div class="stat-n">${dash(w.reach)}</div><div class="stat-sub">Contas alcançadas · ${wd} dias</div></div>
      <div class="card"><div class="stat-l">Contas engajadas</div><div class="stat-n">${dash(w.engaged)}</div><div class="stat-sub">Últimos ${wd} dias</div></div>
      <div class="card"><div class="stat-l">Interações</div><div class="stat-n">${dash(w.interactions)}</div><div class="stat-sub">Últimos ${wd} dias</div></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>📈 Crescimento do perfil <span class="muted small">novos seguidores por dia · ${growth.length} dias</span></h3>${bars(growth)}</div>
      <div class="card"><h3>📈 Alcance por dia <span class="muted small">(passa o rato para ver os números)</span></h3>${bars(serie)}</div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="row between" style="margin-bottom:14px">
        <h3 style="margin:0">🔥 Melhores posts (${anLabel()})</h3>
        <div class="pills">${AN_SORTS.map(([v, t]) => `<button class="${AN.sort === v ? 'on' : ''}" data-sort-post="${v}">${t}</button>`).join('')}</div>
      </div>
      ${posts.length ? `<div class="post-grid">${posts.map((p) => `
        <a class="pcard" href="${esc(p.permalink || '#')}" target="_blank" rel="noopener" title="${esc(p.caption)}">
          <div class="pimg" ${p.thumb ? `style="background-image:url('${esc(p.thumb)}')"` : ''}></div>
          <div class="pstats"><span>❤️ ${fmt(p.likes)} · 💬 ${fmt(p.comments)}</span><span>🔖 ${fmt(p.saves)} · 👀 ${fmt(p.views)}</span></div>
        </a>`).join('')}</div>` : '<p class="muted">Sem posts neste período.</p>'}
      <p class="muted small" style="margin:14px 0 0">Só aparecem posts publicados por ti. Posts em colaboração publicados por outra conta não vêm pela API do Instagram.</p>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 style="margin:0">🏆 Quem mais comenta <span class="muted small">(nos 60 posts mais recentes)</span></h3>
      <p class="muted small" style="margin:4px 0 12px">Quem mais interage nos teus posts, somando comentários e respostas.</p>
      ${d.commenters.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Perfil</th><th>Comentários</th><th>Última vez</th></tr></thead><tbody>
        ${d.commenters.slice(0, 10).map((c, i) => `<tr><td>${i + 1}</td><td><a class="acct" href="https://instagram.com/${encodeURIComponent(c.username)}" target="_blank" rel="noopener">@${esc(c.username)}</a></td><td>${fmt(c.count)}</td><td>${fmtDateTime(c.last)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Ainda não há comentários para analisar.</p>'}
    </div>`;

  $$('[data-period]', body).forEach((b) => b.addEventListener('click', () => { AN.period = b.dataset.period; drawAnalysis(); }));
  $$('[data-sort-post]', body).forEach((b) => b.addEventListener('click', () => { AN.sort = b.dataset.sortPost; drawAnalysis(); }));
  bind();
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
