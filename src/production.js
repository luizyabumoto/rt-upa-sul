// Produção médica: consultas por médico a partir do relatório Produção Analítico do Gestor Saúde.
// Retornos aparecem só como informação: dar baixa em retorno não significa ter atendido.
import {segments, doctorIdentity} from './scheduling.js';

export const CLASSES = [
 ['emergencia', 'Emergência', '#FF0000'], ['muitoUrgente', 'Muito urgente', '#FF8000'], ['urgente', 'Urgente', '#FFFF00'],
 ['prioridade', 'Prioridade', '#8a11b6'], ['poucoUrgente', 'Pouco urgente', '#008000'], ['naoUrgente', 'Não urgente', '#0000FF'],
 ['procedimentos', 'Procedimentos', '#0d0d0d'], ['semClassificacao', 'Sem classificação', '#C0C0C0'], ['outros', 'Outros', '#888888']];
const PERIODOS = [['atual', 'Plantão atual · tempo real'], ['anterior', 'Plantão anterior'], ['hoje', 'Hoje (desde 07h)'], ['ontem', 'Ontem (07h a 07h)'],
 ['semana', 'Últimos 7 dias'], ['mes', 'Este mês'], ['mesPassado', 'Mês passado'], ['livre', 'Escolher datas…']];
const AGRUPAR = [['total', 'Período inteiro'], ['plantao', 'Por plantão'], ['dia', 'Por dia'], ['semana', 'Por semana'], ['mes', 'Por mês']];
const HORA = 3600000;

// Horário de Cuiabá (UTC-4 fixo) independente do fuso do aparelho.
const cuiaba = date => new Date(date.getTime() - 4 * HORA);
const texto = d => d.toISOString().slice(0, 16);                  // d já está em "hora de Cuiabá" nos campos UTC
const dataBR = iso => iso.slice(0, 10).split('-').reverse().join('/');

export function plantaoAtual(agora = new Date()) {
 const local = cuiaba(agora), inicio = new Date(local);
 inicio.setUTCMinutes(0, 0, 0);
 const hora = local.getUTCHours();
 if (hora >= 7 && hora < 19) inicio.setUTCHours(7);
 else { if (hora < 7) inicio.setUTCDate(inicio.getUTCDate() - 1); inicio.setUTCHours(19); }
 return {inicio: texto(inicio), data: texto(inicio).slice(0, 10), turno: inicio.getUTCHours() === 7 ? 'D' : 'N'};
}

export function periodo(chave, agora = new Date()) {
 const atual = plantaoAtual(agora), inicioAtual = new Date(atual.inicio + ':00Z'), local = cuiaba(agora);
 const hoje7 = new Date(local); hoje7.setUTCHours(7, 0, 0, 0);
 if (local.getUTCHours() < 7) hoje7.setUTCDate(hoje7.getUTCDate() - 1);
 const menos = (d, horas) => new Date(d.getTime() - horas * HORA);
 const primeiroDia = (ano, mes) => new Date(Date.UTC(ano, mes, 1, 7));
 switch (chave) {
  case 'anterior': return {inicio: texto(menos(inicioAtual, 12)), fim: atual.inicio};
  case 'hoje': return {inicio: texto(hoje7), fim: 'agora'};
  case 'ontem': return {inicio: texto(menos(hoje7, 24)), fim: texto(hoje7)};
  case 'semana': return {inicio: texto(menos(hoje7, 24 * 6)), fim: 'agora'};
  case 'mes': return {inicio: texto(primeiroDia(hoje7.getUTCFullYear(), hoje7.getUTCMonth())), fim: 'agora'};
  case 'mesPassado': return {inicio: texto(primeiroDia(hoje7.getUTCFullYear(), hoje7.getUTCMonth() - 1)), fim: texto(primeiroDia(hoje7.getUTCFullYear(), hoje7.getUTCMonth()))};
  default: return {inicio: atual.inicio, fim: 'agora'};
 }
}

const somaClasses = (alvo, classes) => { for (const [k, v] of Object.entries(classes || {})) alvo[k] = (alvo[k] || 0) + v; return alvo; };
const consultas = r => r.adulto + r.pediatria;

export function ranking(registros) {
 const porMedico = new Map();
 for (const r of registros) {
  const m = porMedico.get(r.medico) || {medico: r.medico, total: 0, adulto: 0, pediatria: 0, retornos: 0, plantoes: new Set(), classes: {}};
  m.total += consultas(r); m.adulto += r.adulto; m.pediatria += r.pediatria; m.retornos += r.retornos;
  if (consultas(r)) m.plantoes.add(`${r.data}${r.turno}`);
  somaClasses(m.classes, r.classes);
  porMedico.set(r.medico, m);
 }
 return [...porMedico.values()].map(m => ({...m, plantoes: m.plantoes.size, mediaPlantao: m.plantoes.size ? Math.round(m.total / m.plantoes.size) : 0}))
  .sort((a, b) => b.total - a.total || b.retornos - a.retornos || a.medico.localeCompare(b.medico, 'pt-BR'));
}

const segundaFeira = data => { const d = new Date(data + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
export function chaveGrupo(r, agrupamento) {
 if (agrupamento === 'plantao') return [`${r.data}${r.turno}`, `${dataBR(r.data)} · ${r.turno === 'D' ? 'Diurno 07h–19h' : 'Noturno 19h–07h'}`];
 if (agrupamento === 'dia') return [r.data, dataBR(r.data)];
 if (agrupamento === 'semana') { const s = segundaFeira(r.data); return [s, `Semana de ${dataBR(s)}`]; }
 if (agrupamento === 'mes') return [r.data.slice(0, 7), r.data.slice(0, 7).split('-').reverse().join('/')];
 return ['total', 'Período'];
}

export function grupos(registros, agrupamento) {
 const mapa = new Map();
 for (const r of registros) {
  const [chave, rotulo] = chaveGrupo(r, agrupamento);
  if (!mapa.has(chave)) mapa.set(chave, {chave, rotulo, registros: []});
  mapa.get(chave).registros.push(r);
 }
 return [...mapa.values()].sort((a, b) => a.chave.localeCompare(b.chave)).map(g => {
  const lista = ranking(g.registros).filter(m => m.total);
  return {chave: g.chave, rotulo: g.rotulo, total: lista.reduce((s, m) => s + m.total, 0), medicos: lista.length, top: lista.slice(0, 3)};
 });
}

// Nomes da escala já seguem o Gestor Saúde; a comparação ignora acentos, espaços e sobrenomes extras.
const tokens = nome => new Set(String(nome).split(/CRM/i)[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/\s+/).filter(Boolean));
export function mesmoMedico(a, b) {
 if (doctorIdentity(a) === doctorIdentity(b)) return true;
 const [x, y] = [tokens(a), tokens(b)], [menor, maior] = x.size <= y.size ? [x, y] : [y, x];
 return menor.size >= 2 && [...menor].every(t => maior.has(t));
}

export function escalados(seed, storage, data, turno) {
 const postos = turno === 'D' ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];   // clínicos e pediatria (Box fica fora)
 const nomes = [];
 for (const slot of postos) for (const parte of segments(seed, storage, data, slot)) {
  const nome = String(parte.doctor || '').split('\n')[0].trim();
  if (nome && !nomes.some(n => mesmoMedico(n, nome))) nomes.push(nome);
 }
 return nomes;
}

export function csv(lista, rotuloPeriodo) {
 const cabecalho = ['Posição', 'Médico', 'Consultas', 'Adulto', 'Pediatria', 'Plantões', 'Média por plantão', ...CLASSES.map(c => c[1]), 'Retornos baixados (não contam)'];
 const linhas = lista.map((m, i) => [i + 1, m.medico, m.total, m.adulto, m.pediatria, m.plantoes, m.mediaPlantao, ...CLASSES.map(c => m.classes[c[0]] || 0), m.retornos]);
 const campo = v => `"${String(v).replaceAll('"', '""')}"`;
 return '﻿' + [[`Produção médica · ${rotuloPeriodo}`], cabecalho, ...linhas].map(l => l.map(campo).join(';')).join('\r\n');
}

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };

export function mountProduction(storage, seed) {
 const panel = document.querySelector('#production-panel');
 if (!panel) return;
 panel.innerHTML = '<div class="section-heading"><div><p class="eyebrow">GESTOR SAÚDE · PRODUÇÃO ANALÍTICO</p><h2>Produção médica</h2></div><div class="actions"><span class="prod-updated" role="status" aria-live="polite"></span><button type="button" class="secondary prod-refresh">Atualizar</button></div></div>' +
  '<div class="prod-controls"><label>Período<select class="prod-period"></select></label><label class="prod-free" hidden>Início<input type="datetime-local" class="prod-start"></label><label class="prod-free" hidden>Fim<input type="datetime-local" class="prod-end"></label><label>Ranking<select class="prod-group"></select></label><button type="button" class="secondary prod-csv">Baixar tabela (CSV)</button></div>' +
  '<p class="flow-alert prod-alert" role="alert" hidden></p><div class="flow-kpis prod-kpis"></div><div class="prod-escala"></div><div class="prod-tables"></div>' +
  '<p class="notice">Consultas nos Consultórios Adulto (Médico Clínico) e Pediátrico (Médico Pediatra), pelo horário do atendimento. Plantões de 12 h: diurno 07h–19h e noturno 19h–07h. Retornos baixados aparecem à parte e não entram no total nem no ranking. Clique no nome do médico para ver os plantões dele na escala.</p>';
 const $ = s => panel.querySelector(s);
 for (const [v, t] of PERIODOS) $('.prod-period').add(new Option(t, v));
 for (const [v, t] of AGRUPAR) $('.prod-group').add(new Option(t, v));
 let dados = null, lista = [], carregando = false, pedido = 0;

 function escolha() {
  const chave = $('.prod-period').value;
  if (chave !== 'livre') return periodo(chave);
  return {inicio: $('.prod-start').value, fim: $('.prod-end').value || 'agora'};
 }

 function abrirMedico(nome) {
  document.querySelector('[data-view="overview"]')?.click();
  const busca = document.querySelector('#quick-search');
  if (!busca) return;
  busca.value = nome;
  busca.dispatchEvent(new Event('input'));
  busca.scrollIntoView({block: 'center'});
  busca.focus();
 }

 function botaoMedico(nome) {
  const b = el('button', 'prod-doctor', nome);
  b.type = 'button'; b.title = 'Ver plantões deste médico na escala';
  b.onclick = () => abrirMedico(nome);
  return b;
 }

 function tabelaRanking() {
  const tabela = el('table', 'prod-table'), head = el('tr');
  for (const [t, cls] of [['#'], ['Médico'], ['Consultas', 'num'], ['Adulto', 'num'], ['Pediatria', 'num'], ['Plantões', 'num'], ['Média/plantão', 'num']]) head.append(el('th', cls || '', t));
  for (const [chave, nome, cor] of CLASSES) {
   if (!lista.some(m => m.classes[chave])) continue;
   const th = el('th', 'num'); const dot = el('span', 'flow-dot'); dot.style.setProperty('--risk', cor); th.append(dot, document.createTextNode(' ' + nome)); head.append(th);
  }
  head.append(el('th', 'num muted', 'Retornos*'));
  const thead = el('thead'); thead.append(head); tabela.append(thead);
  const body = el('tbody');
  lista.forEach((m, i) => {
   const tr = el('tr');
   const nome = el('td'); nome.append(botaoMedico(m.medico));
   tr.append(el('td', 'pos', m.total ? String(i + 1) : '—'), nome, el('td', 'num strong', String(m.total)), el('td', 'num', String(m.adulto)), el('td', 'num', String(m.pediatria)), el('td', 'num', String(m.plantoes)), el('td', 'num', String(m.mediaPlantao)));
   for (const [chave] of CLASSES) if (lista.some(x => x.classes[chave])) tr.append(el('td', 'num', String(m.classes[chave] || 0)));
   tr.append(el('td', 'num muted', String(m.retornos)));
   body.append(tr);
  });
  tabela.append(body);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  const box = el('section', 'prod-section'); box.append(el('h3', '', 'Ranking de consultas'), wrap, el('small', 'muted', '* Retornos baixados: só para conhecimento, fora do total e do ranking.'));
  return box;
 }

 function tabelaGrupos(agrupamento) {
  const lista = grupos(dados.registros, agrupamento);
  const tabela = el('table', 'prod-table'), head = el('tr');
  for (const [t, cls] of [['Período'], ['Consultas', 'num'], ['Médicos', 'num'], ['1º lugar'], ['2º lugar'], ['3º lugar']]) head.append(el('th', cls || '', t));
  const thead = el('thead'); thead.append(head); tabela.append(thead);
  const body = el('tbody');
  for (const g of lista) {
   const tr = el('tr'); tr.append(el('td', '', g.rotulo), el('td', 'num strong', String(g.total)), el('td', 'num', String(g.medicos)));
   for (let i = 0; i < 3; i++) { const td = el('td'); const m = g.top[i]; if (m) { td.append(botaoMedico(m.medico), el('small', 'muted', ` ${m.total}`)); } tr.append(td); }
   body.append(tr);
  }
  tabela.append(body);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  const box = el('section', 'prod-section'); box.append(el('h3', '', `Ranking ${AGRUPAR.find(a => a[0] === agrupamento)[1].toLowerCase()}`), wrap);
  return box;
 }

 function cartaoEscala() {
  const box = $('.prod-escala'); box.replaceChildren();
  const chave = $('.prod-period').value;
  if (!dados || !['atual', 'anterior'].includes(chave)) return;
  const inicio = dados.inicio.slice(0, 16), data = inicio.slice(0, 10), turno = inicio.slice(11, 13) === '07' ? 'D' : 'N';
  const nomes = escalados(seed, storage, data, turno);
  if (!nomes.length) return;
  const card = el('section', 'prod-section prod-escala-card');
  card.append(el('h3', '', `Escalados no plantão ${turno === 'D' ? 'diurno' : 'noturno'} de ${dataBR(data)} (consultórios)`));
  const ul = el('ul', 'prod-escala-list');
  for (const nome of nomes) {
   const m = lista.find(x => mesmoMedico(x.medico, nome));
   const li = el('li', m?.total ? '' : 'prod-zero'); li.append(botaoMedico(m?.medico || nome), el('span', '', m?.total ? ` ${m.total} consultas` : ' sem consultas registradas ainda'));
   ul.append(li);
  }
  const fora = lista.filter(m => m.total && !nomes.some(n => mesmoMedico(m.medico, n)));
  card.append(ul);
  if (fora.length) card.append(el('p', 'notice', `Atenderam sem estar nos consultórios da escala deste plantão: ${fora.map(m => `${m.medico} (${m.total})`).join(', ')}.`));
  box.append(card);
 }

 function render() {
  const updated = $('.prod-updated'), alerta = $('.prod-alert');
  if (!dados) return;
  const horas = Math.max(1, (Date.parse(dados.fim) - Date.parse(dados.inicio)) / HORA);
  updated.textContent = dados.atualizadoEm ? `${dados.emAndamento ? 'Em andamento · ' : ''}lido às ${new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}` : '';
  alerta.hidden = dados.disponivel;
  if (!dados.disponivel) alerta.textContent = `Não foi possível ler a produção agora: ${dados.erro || 'falha na leitura'}${dados.registros?.length ? ' Mostrando a última leitura válida.' : ''}`;
  lista = ranking(dados.registros || []);
  const comConsulta = lista.filter(m => m.total), total = comConsulta.reduce((s, m) => s + m.total, 0);
  $('.prod-kpis').replaceChildren(
   ...[['CONSULTAS', total, `${dataBR(dados.inicio)} ${dados.inicio.slice(11, 16)} → ${dados.emAndamento ? 'agora' : `${dataBR(dados.fim)} ${dados.fim.slice(11, 16)}`}`],
    ['ADULTO', comConsulta.reduce((s, m) => s + m.adulto, 0), 'Médico Clínico'],
    ['PEDIATRIA', comConsulta.reduce((s, m) => s + m.pediatria, 0), 'Médico Pediatra'],
    ['MÉDICOS', comConsulta.length, `${(total / horas).toFixed(1).replace('.', ',')} consultas por hora`],
    ['RETORNOS BAIXADOS', lista.reduce((s, m) => s + m.retornos, 0), 'à parte · não contam']].map(([rotulo, valor, detalhe]) => {
    const box = el('div', 'flow-kpi'); box.append(el('span', 'flow-kpi-label', rotulo), el('strong', 'flow-kpi-value', String(valor)), el('small', '', detalhe)); return box; }));
  cartaoEscala();
  const agrupamento = $('.prod-group').value, tabelas = $('.prod-tables');
  tabelas.replaceChildren();
  if (!lista.length) { tabelas.append(el('p', 'notice', 'Nenhuma consulta registrada neste período.')); return; }
  if (agrupamento !== 'total') tabelas.append(tabelaGrupos(agrupamento));
  tabelas.append(tabelaRanking());
 }

 async function carregar() {
  const {inicio, fim} = escolha();
  if (!inicio) { $('.prod-updated').textContent = 'Escolha o início do período.'; return; }
  const meu = ++pedido;
  carregando = true; $('.prod-refresh').disabled = true;
  $('.prod-updated').textContent = 'Lendo o Gestor Saúde…';
  try {
   const resposta = await fetch(`/api/producao?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`, {cache: 'no-store'});
   const corpo = await resposta.json().catch(() => ({}));
   if (!resposta.ok) throw new Error(corpo.error || 'O servidor do RT UPA Sul não respondeu.');
   if (meu === pedido) dados = corpo;
  } catch (erro) {
   if (meu === pedido) dados = {...(dados || {registros: [], inicio, fim: new Date().toISOString()}), disponivel: false, erro: erro.message};
  } finally {
   if (meu === pedido) { carregando = false; $('.prod-refresh').disabled = false; render(); }
  }
 }

 $('.prod-period').onchange = () => {
  const livre = $('.prod-period').value === 'livre';
  panel.querySelectorAll('.prod-free').forEach(l => { l.hidden = !livre; });
  if (livre && !$('.prod-start').value) { const p = periodo('ontem'); $('.prod-start').value = p.inicio; $('.prod-end').value = p.fim; }
  carregar();
 };
 $('.prod-start').onchange = $('.prod-end').onchange = carregar;
 $('.prod-group').onchange = render;
 $('.prod-refresh').onclick = carregar;
 $('.prod-csv').onclick = () => {
  if (!lista.length) return;
  const rotulo = $('.prod-period').selectedOptions[0].textContent;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv(lista, `${rotulo} · ${dataBR(dados.inicio)} a ${dados.emAndamento ? 'agora' : dataBR(dados.fim)}`)], {type: 'text/csv;charset=utf-8'}));
  a.download = `producao-medica-${dados.inicio.slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
 };
 const aberto = () => !document.hidden && !panel.hidden;
 document.querySelector('[data-view="production"]')?.addEventListener('click', () => { if (!dados || ($('.prod-period').value === 'atual' && Date.now() - Date.parse(dados.atualizadoEm || 0) > 120000)) carregar(); });
 // Plantão em andamento: nova leitura a cada 2 minutos enquanto a aba está aberta.
 setInterval(() => { if (aberto() && $('.prod-period').value === 'atual' && !carregando) carregar(); }, 120000);
}
