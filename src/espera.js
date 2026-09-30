// Tempo médio de espera por classificação: da chegada ao consultório até o atendimento médico, a partir do
// relatório Produção Analítico (/api/producao → esperas: somas e contagens por plantão, fila e classificação).
// Nenhum dado de paciente chega à tela.
import {CLASSES, PERIODOS, AGRUPAR, periodo, chaveGrupo} from './production.js';
import {ALVO_MANCHESTER, formatarEspera} from './flow.js';

// Classificações do relatório → tempo-alvo de Manchester (minutos).
export const ALVO_CLASSE = {emergencia: ALVO_MANCHESTER.vermelho, muitoUrgente: ALVO_MANCHESTER.laranja, urgente: ALVO_MANCHESTER.amarelo,
 poucoUrgente: ALVO_MANCHESTER.verde, naoUrgente: ALVO_MANCHESTER.azul};
const dataBR = iso => iso.slice(0, 10).split('-').reverse().join('/');

const vazio = () => ({n: 0, soma: 0, maior: 0});
const somar = (alvo, e) => { alvo.n += e.n; alvo.soma += e.soma; alvo.maior = Math.max(alvo.maior, e.maior); return alvo; };
export const media = s => (s && s.n ? Math.round(s.soma / s.n) : null);

// Filtra por fila (adulto/pediatria) e turno (D/N); vazio = todos.
export const filtrarEspera = (esperas, {fila = '', turno = ''} = {}) => (esperas || []).filter(e => (!fila || e.fila === fila) && (!turno || e.turno === turno));

// Por classificação no período inteiro, na ordem de gravidade, mais o geral.
export function resumoEspera(esperas) {
 const porClasse = new Map(), geral = vazio();
 for (const e of esperas) { somar(porClasse.get(e.classe) || porClasse.set(e.classe, vazio()).get(e.classe), e); somar(geral, e); }
 const classes = CLASSES.filter(([chave]) => porClasse.has(chave)).map(([chave, nome, cor]) => {
  const s = porClasse.get(chave);
  return {chave, nome, cor, ...s, media: media(s), alvo: ALVO_CLASSE[chave]};
 });
 return {classes, geral: {...geral, media: media(geral)}};
}

// Linhas por plantão, dia, semana ou mês (mesmos agrupamentos da Produção), com a espera de cada classificação.
export function esperaPorGrupo(esperas, agrupamento) {
 const mapa = new Map();
 for (const e of esperas) {
  const [chave, rotulo] = chaveGrupo(e, agrupamento);
  const g = mapa.get(chave) || mapa.set(chave, {chave, rotulo, classes: {}, geral: vazio()}).get(chave);
  somar(g.classes[e.classe] || (g.classes[e.classe] = vazio()), e);
  somar(g.geral, e);
 }
 return [...mapa.values()].sort((a, b) => a.chave.localeCompare(b.chave));
}

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };

export function mountEspera() {
 const flow = document.querySelector('#flow-panel');
 if (!flow) return;
 const secao = el('section', 'espera');
 secao.innerHTML = '<div class="section-heading"><div><p class="eyebrow">GESTOR SAÚDE · PRODUÇÃO ANALÍTICO</p><h2>Tempo médio de espera por classificação</h2></div><div class="actions"><span class="espera-status" role="status" aria-live="polite"></span><button type="button" class="secondary espera-refresh">Atualizar</button></div></div>' +
  '<div class="prod-controls"><label>Período<select class="espera-period"></select></label><label class="espera-free" hidden>Início<input type="datetime-local" class="espera-start"></label><label class="espera-free" hidden>Fim<input type="datetime-local" class="espera-end"></label>' +
  '<label>Turno<select class="espera-turno"><option value="">Diurno + noturno</option><option value="D">Só diurno (07h–19h)</option><option value="N">Só noturno (19h–07h)</option></select></label>' +
  '<label>Consultório<select class="espera-fila"><option value="">Adulto + pediatria</option><option value="adulto">Só adulto</option><option value="pediatria">Só pediatria</option></select></label>' +
  '<label>Mostrar<select class="espera-group"></select></label></div>' +
  '<div class="flow-risks espera-cards"></div><div class="espera-tabela"></div>' +
  '<p class="notice">Espera = do encaminhamento ao consultório até o atendimento médico, pelo horário do atendimento. Só consultas nos Consultórios Adulto e Pediátrico (retornos não entram). Esperas acima de 12 h são tratadas como registro esquecido e ficam fora da média.</p>';
 flow.append(secao);
 const $ = s => secao.querySelector(s);
 for (const [v, t] of PERIODOS) $('.espera-period').add(new Option(t, v));
 for (const [v, t] of AGRUPAR) $('.espera-group').add(new Option(t, v));
 $('.espera-group').value = 'plantao';
 let dados = null, pedido = 0, carregado = false;

 function escolha() {
  const chave = $('.espera-period').value;
  if (chave !== 'livre') return periodo(chave);
  return {inicio: $('.espera-start').value, fim: $('.espera-end').value || 'agora'};
 }

 function cartao(c) {
  const card = el('article', 'flow-risk');
  card.style.setProperty('--risk', c.cor);
  const acima = c.alvo !== undefined && c.media !== null && c.media > c.alvo;
  if (acima) card.classList.add('flow-estourou');
  const head = el('div', 'flow-risk-head');
  head.append(el('span', 'flow-dot'), el('h3', '', c.nome.toUpperCase()));
  const valor = el('p', 'flow-count');
  valor.append(el('strong', '', formatarEspera(c.media)), document.createTextNode(' em média'));
  card.append(head, valor, el('p', acima ? 'flow-maior-alerta' : '', `${c.n} ${c.n === 1 ? 'atendimento' : 'atendimentos'}${c.alvo !== undefined ? ` · alvo ${c.alvo === 0 ? 'imediato' : formatarEspera(c.alvo)}` : ''}`),
   el('small', 'flow-split', `Maior espera: ${formatarEspera(c.maior)}`));
  if (acima) card.append(el('p', 'flow-estourou-nota', '⚠ Média acima do tempo-alvo de Manchester'));
  return card;
 }

 function tabela(lista, classes) {
  const t = el('table', 'prod-table'), head = el('tr');
  head.append(el('th', '', 'Período'));
  for (const c of classes) { const th = el('th', 'num'), dot = el('span', 'flow-dot'); dot.style.setProperty('--risk', c.cor); th.append(dot, document.createTextNode(' ' + c.nome)); head.append(th); }
  head.append(el('th', 'num', 'Geral'));
  const thead = el('thead'); thead.append(head); t.append(thead);
  const corpo = el('tbody');
  for (const g of lista) {
   const tr = el('tr'); tr.append(el('td', '', g.rotulo));
   for (const c of classes) {
    const s = g.classes[c.chave], m = media(s);
    const td = el('td', `num${m !== null && c.alvo !== undefined && m > c.alvo ? ' alerta' : ''}`, m === null ? '—' : formatarEspera(m));
    if (s) td.title = `${s.n} atendimentos · maior espera ${formatarEspera(s.maior)}`;
    tr.append(td);
   }
   tr.append(el('td', 'num strong', formatarEspera(media(g.geral))));
   corpo.append(tr);
  }
  t.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(t);
  return wrap;
 }

 function render() {
  const cards = $('.espera-cards'), caixa = $('.espera-tabela');
  cards.replaceChildren(); caixa.replaceChildren();
  if (!dados) return;
  if (!dados.disponivel) { caixa.append(el('p', 'flow-alert', `Não foi possível ler agora: ${dados.erro || 'falha na leitura'}`)); return; }
  const esperas = filtrarEspera(dados.esperas, {fila: $('.espera-fila').value, turno: $('.espera-turno').value});
  if (!esperas.length) {
   const houveConsulta = (dados.registros || []).some(r => r.adulto + r.pediatria);
   const campos = (dados.camposRelatorio || []).join(', ');
   caixa.append(el('p', 'notice', houveConsulta && !(dados.esperas || []).length
    ? `O relatório de produção do Gestor Saúde não trouxe o horário de chegada do paciente, então não dá para calcular a espera deste período.${campos ? ` Campos recebidos: ${campos}.` : ''}`
    : 'Sem atendimentos com espera registrada neste período.'));
   return;
  }
  const {classes, geral} = resumoEspera(esperas);
  cards.append(cartao({chave: 'geral', nome: 'Geral', cor: '#23a896', ...geral}), ...classes.map(cartao));
  const agrupamento = $('.espera-group').value;
  if (agrupamento === 'total') return;
  const titulo = el('h3', '', `Espera média ${AGRUPAR.find(a => a[0] === agrupamento)[1].toLowerCase()}`);
  caixa.append(titulo, tabela(esperaPorGrupo(esperas, agrupamento), classes), el('small', 'muted', 'Em vermelho: média acima do tempo-alvo de Manchester. Passe o mouse para ver quantos atendimentos e a maior espera.'));
 }

 async function carregar() {
  const {inicio, fim} = escolha();
  if (!inicio) { $('.espera-status').textContent = 'Escolha o início do período.'; return; }
  const meu = ++pedido;
  $('.espera-refresh').disabled = true;
  $('.espera-status').textContent = 'Lendo o Gestor Saúde…';
  try {
   const r = await fetch(`/api/producao?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`, {cache: 'no-store'});
   const corpo = await r.json().catch(() => ({}));
   if (!r.ok) throw new Error(corpo.error || 'O servidor do RT UPA Sul não respondeu.');
   if (meu === pedido) dados = corpo;
  } catch (erro) {
   if (meu === pedido) dados = {disponivel: false, erro: erro.message};
  } finally {
   if (meu === pedido) {
    $('.espera-refresh').disabled = false;
    $('.espera-status').textContent = dados?.disponivel ? `${dataBR(dados.inicio)} ${dados.inicio.slice(11, 16)} → ${dados.emAndamento ? 'agora' : `${dataBR(dados.fim)} ${dados.fim.slice(11, 16)}`}` : '';
    render();
   }
  }
 }

 $('.espera-period').onchange = () => {
  const livre = $('.espera-period').value === 'livre';
  secao.querySelectorAll('.espera-free').forEach(l => { l.hidden = !livre; });
  if (livre && !$('.espera-start').value) { const p = periodo('ontem'); $('.espera-start').value = p.inicio; $('.espera-end').value = p.fim; }
  carregar();
 };
 $('.espera-start').onchange = $('.espera-end').onchange = carregar;
 $('.espera-refresh').onclick = carregar;
 secao.addEventListener('change', e => { if (e.target.matches('.espera-turno, .espera-fila, .espera-group')) render(); });
 // Carrega na primeira vez que a aba Fluxo de pacientes é aberta; plantão atual relido a cada 5 min com a aba aberta.
 document.querySelector('[data-view="flow"]')?.addEventListener('click', () => { if (!carregado) { carregado = true; carregar(); } });
 setInterval(() => { if (carregado && !document.hidden && !flow.hidden && $('.espera-period').value === 'atual') carregar(); }, 5 * 60000);
}
