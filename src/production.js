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

// Período de comparação com a mesma duração: o imediatamente anterior ou o mesmo do ano passado.
// Recebe e devolve horários locais de Cuiabá (AAAA-MM-DDTHH:MM).
export function periodoComparado(inicio, fim, modo) {
 const a = new Date(inicio.slice(0, 16) + ':00Z'), b = new Date(fim.slice(0, 16) + ':00Z');
 if (modo === 'ano') { a.setUTCFullYear(a.getUTCFullYear() - 1); b.setUTCFullYear(b.getUTCFullYear() - 1); return {inicio: a.toISOString().slice(0, 16), fim: b.toISOString().slice(0, 16)}; }
 const duracao = b - a;
 return {inicio: new Date(a.getTime() - duracao).toISOString().slice(0, 16), fim: a.toISOString().slice(0, 16)};
}

export function variacao(atual, anterior) {
 if (!anterior) return atual ? 'novo' : '0%';
 const pct = Math.round((atual - anterior) / anterior * 100);
 return `${pct > 0 ? '+' : ''}${pct}%`;
}

// Plantões (início às 07h ou 19h) que começam dentro do período, no horário de Cuiabá.
export function plantoesDoPeriodo(inicio, fim) {
 const lista = [], limite = new Date(fim.slice(0, 16) + ':00Z');
 let atual = new Date(inicio.slice(0, 16) + ':00Z');
 const hora = atual.getUTCHours();
 atual.setUTCMinutes(0, 0, 0);
 if (hora < 7) { atual.setUTCDate(atual.getUTCDate() - 1); atual.setUTCHours(19); } else if (hora < 19) atual.setUTCHours(7); else atual.setUTCHours(19);
 for (; atual < limite && lista.length < 400; atual = new Date(atual.getTime() + 12 * HORA)) {
  lista.push({data: atual.toISOString().slice(0, 10), turno: atual.getUTCHours() === 7 ? 'D' : 'N'});
 }
 return lista;
}

// Escala × produção por médico. escalas: [{data, turno, nomes: [...]}] (consultórios); registros: produção por plantão.
export function cruzamento(registros, escalas) {
 const linhas = [];
 const linha = nome => {
  let l = linhas.find(x => mesmoMedico(x.medico, nome));
  if (!l) { l = {medico: nome, escalados: 0, comConsulta: 0, semConsulta: [], consultasEscalado: 0, consultasFora: 0}; linhas.push(l); }
  return l;
 };
 const escaladoEm = new Set();
 for (const plantao of escalas) for (const nome of plantao.nomes) {
  const l = linha(nome); l.escalados += 1;
  const feito = registros.filter(r => r.data === plantao.data && r.turno === plantao.turno && mesmoMedico(r.medico, nome)).reduce((s, r) => s + consultas(r), 0);
  escaladoEm.add(`${plantao.data}${plantao.turno}|${l.medico}`);
  if (feito) { l.comConsulta += 1; l.consultasEscalado += feito; } else l.semConsulta.push(plantao);
 }
 for (const r of registros) {
  if (!consultas(r)) continue;
  const l = linha(r.medico);
  if (!escaladoEm.has(`${r.data}${r.turno}|${l.medico}`)) l.consultasFora += consultas(r);
 }
 return linhas.map(l => ({...l, mediaEscalado: l.escalados ? Math.round(l.consultasEscalado / l.escalados) : 0}))
  .sort((a, b) => b.escalados - a.escalados || b.consultasEscalado - a.consultasEscalado || a.medico.localeCompare(b.medico, 'pt-BR'));
}

// Duração real de cada plantão para "por hora": diurno 12 h, noturno 12 h.
const HORAS_PLANTAO = 12;
const diaSemana = data => new Date(data + 'T12:00:00Z').getUTCDay();
const NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Um resumo por plantão (data+turno): total de consultas, médicos que atenderam, média por médico e por hora.
export function plantoes(registros) {
 const mapa = new Map();
 for (const r of registros) {
  const chave = `${r.data}${r.turno}`;
  const p = mapa.get(chave) || {data: r.data, turno: r.turno, total: 0, medicos: 0};
  if (consultas(r)) { p.total += consultas(r); p.medicos += 1; }
  mapa.set(chave, p);
 }
 return [...mapa.values()].filter(p => p.total).map(p => ({...p,
  porMedico: p.medicos ? p.total / p.medicos : 0,
  porMedicoHora: p.medicos ? p.total / p.medicos / HORAS_PLANTAO : 0}))
  .sort((a, b) => a.data.localeCompare(b.data) || a.turno.localeCompare(b.turno));
}

// Equipes agrupadas por dia da semana + turno (ex.: "Segunda · diurno"), com médias por plantão e por médico.
export function equipes(registros) {
 const lista = plantoes(registros), mapa = new Map();
 for (const p of lista) {
  const chave = `${diaSemana(p.data)}${p.turno}`;
  const e = mapa.get(chave) || {weekday: diaSemana(p.data), turno: p.turno, plantoes: 0, total: 0, medicos: 0};
  e.plantoes += 1; e.total += p.total; e.medicos += p.medicos;
  mapa.set(chave, e);
 }
 return [...mapa.values()].map(e => ({
  nome: `${NOMES_DIA[e.weekday]} · ${e.turno === 'D' ? 'diurno' : 'noturno'}`,
  weekday: e.weekday, turno: e.turno, plantoes: e.plantoes, total: e.total,
  mediaPorPlantao: e.plantoes ? e.total / e.plantoes : 0,
  mediaMedicos: e.plantoes ? e.medicos / e.plantoes : 0,
  porMedico: e.medicos ? e.total / e.medicos : 0,
  porMedicoHora: e.medicos ? e.total / e.medicos / HORAS_PLANTAO : 0,
 })).sort((a, b) => b.porMedico - a.porMedico || b.mediaPorPlantao - a.mediaPorPlantao);
}

// Média geral da unidade por plantão e por médico, no período.
export function mediaUnidade(registros) {
 const lista = plantoes(registros);
 if (!lista.length) return {plantoes: 0, mediaPorPlantao: 0, porMedico: 0, porMedicoHora: 0};
 const total = lista.reduce((s, p) => s + p.total, 0), medicos = lista.reduce((s, p) => s + p.medicos, 0);
 return {plantoes: lista.length, mediaPorPlantao: total / lista.length, porMedico: medicos ? total / medicos : 0, porMedicoHora: medicos ? total / medicos / HORAS_PLANTAO : 0};
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
 panel.innerHTML = '<div class="section-heading"><div><p class="eyebrow">GESTOR SAÚDE · PRODUÇÃO ANALÍTICO</p><h2>Produção médica</h2></div><div class="actions"><span class="prod-updated" role="status" aria-live="polite"></span><button type="button" class="secondary prod-refresh">Atualizar</button><button type="button" class="secondary prod-print">Relatório do mês (PDF)</button></div></div>' +
  '<div class="prod-controls"><label>Período<select class="prod-period"></select></label><label class="prod-free" hidden>Início<input type="datetime-local" class="prod-start"></label><label class="prod-free" hidden>Fim<input type="datetime-local" class="prod-end"></label><label>Turno<select class="prod-turno"><option value="">Diurno + noturno</option><option value="D">Só diurno (07h–19h)</option><option value="N">Só noturno (19h–07h)</option></select></label><label>Ranking<select class="prod-group"></select></label><label>Comparar com<select class="prod-compare"><option value="">Sem comparação</option><option value="anterior">Período anterior</option><option value="ano">Mesmo período do ano passado</option></select></label><button type="button" class="secondary prod-csv">Baixar tabela (CSV)</button></div>' +
  '<p class="flow-alert prod-alert" role="alert" hidden></p><div class="flow-kpis prod-kpis"></div><div class="prod-escala"></div><div class="prod-tables"></div>' +
  '<p class="notice">Consultas nos Consultórios Adulto (Médico Clínico) e Pediátrico (Médico Pediatra), pelo horário do atendimento. Plantões de 12 h: diurno 07h–19h e noturno 19h–07h. Retornos baixados aparecem à parte e não entram no total nem no ranking. Clique no nome do médico para ver os plantões dele na escala.</p>';
 const $ = s => panel.querySelector(s);
 for (const [v, t] of PERIODOS) $('.prod-period').add(new Option(t, v));
 for (const [v, t] of AGRUPAR) $('.prod-group').add(new Option(t, v));
 let dados = null, lista = [], carregando = false, pedido = 0, comparado = null;
 // Filtro de turno (diurno/noturno) aplicado a todas as tabelas; é filtro local, não recarrega o Gestor Saúde.
 let turnoAtual = '';
 const filtra = rs => turnoAtual ? (rs || []).filter(r => r.turno === turnoAtual) : (rs || []);

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
  if (comparado?.registros) head.append(el('th', 'num', 'Δ vs comparação'));
  head.append(el('th', 'num muted', 'Retornos*'));
  const thead = el('thead'); thead.append(head); tabela.append(thead);
  const body = el('tbody');
  lista.forEach((m, i) => {
   const tr = el('tr');
   const nome = el('td'); nome.append(botaoMedico(m.medico));
   tr.append(el('td', 'pos', m.total ? String(i + 1) : '—'), nome, el('td', 'num strong', String(m.total)), el('td', 'num', String(m.adulto)), el('td', 'num', String(m.pediatria)), el('td', 'num', String(m.plantoes)), el('td', 'num', String(m.mediaPlantao)));
   for (const [chave] of CLASSES) if (lista.some(x => x.classes[chave])) tr.append(el('td', 'num', String(m.classes[chave] || 0)));
   if (comparado?.registros) { const antes = ranking(comparado.registros).find(x => mesmoMedico(x.medico, m.medico))?.total || 0, dif = m.total - antes; tr.append(el('td', `num ${dif > 0 ? 'sobe' : dif < 0 ? 'desce' : 'muted'}`, `${dif > 0 ? '+' : ''}${dif} (${antes})`)); }
   tr.append(el('td', 'num muted', String(m.retornos)));
   body.append(tr);
  });
  tabela.append(body);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  const box = el('section', 'prod-section'); box.append(el('h3', '', 'Ranking de consultas'), wrap, el('small', 'muted', '* Retornos baixados: só para conhecimento, fora do total e do ranking.'));
  return box;
 }

 function tabelaGrupos(agrupamento) {
  const lista = grupos(filtra(dados.registros), agrupamento);
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

 function tabelaPerfilHora() {
  const um = n => Number(n).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const hh = h => `${String(h).padStart(2, '0')}h`;
  const lista = (dados.perfilMedicos || []).filter(m => m.total);
  const box = el('section', 'prod-section');
  box.append(el('h3', '', 'Ritmo por hora dos médicos'), el('p', 'chart-sub', 'Pacientes por hora de cada médico no período, com o horário em que mais e menos produz.' + (turnoAtual ? ' (Considera o período inteiro; o filtro de turno não se aplica a esta tabela.)' : '')));
  if (!lista.length) { box.append(el('p', 'notice', 'Sem consultas no período.')); return box; }
  const tabela = el('table', 'prod-table'), head = el('tr');
  for (const [t, cls] of [['#'], ['Médico'], ['Consultas', 'num'], ['Pacientes/hora', 'num'], ['Pico numa hora', 'num'], ['Horário que mais produz'], ['Horário que menos produz']]) head.append(el('th', cls || '', t));
  const thead = el('thead'); thead.append(head); tabela.append(thead);
  const corpo = el('tbody');
  lista.forEach((m, i) => {
   const tr = el('tr'); if (i === 0) tr.className = 'destaque';
   const nome = el('td'); nome.append(botaoMedico(m.medico));
   tr.append(el('td', 'pos', String(i + 1)), nome, el('td', 'num', String(m.total)), el('td', 'num strong', um(m.porHora)),
    el('td', 'num', String(m.maxHora)), el('td', '', `${hh(m.horaPico)} · ${um(m.mediaPico)}/h`), el('td', 'muted', `${hh(m.horaVale)} · ${um(m.mediaVale)}/h`));
   corpo.append(tr);
  });
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  box.append(wrap, el('small', 'muted', '"Pacientes/hora" = consultas ÷ horas em que o médico atendeu. "Pico numa hora" é o maior número de pacientes num único intervalo de 1 hora. Os horários usam a média por faixa do dia.'));
  return box;
 }

 // Minutos em formato humano (0, 18 min, 1h12).
 const minutos = m => m < 1 ? 'na hora' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
 function tabelaAtrasos() {
  const lista = dados.perfilMedicos ? (dados.atrasos || []) : [];
  const box = el('section', 'prod-section');
  box.append(el('h3', '', 'Início do atendimento e intervalos'), el('p', 'chart-sub', 'Tempo entre o início do plantão (07h diurno · 19h noturno) e o 1º atendimento do médico, e o maior intervalo entre dois atendimentos no mesmo plantão. Período inteiro.' + (turnoAtual ? ' (O filtro de turno não se aplica a esta tabela.)' : '')));
  if (!lista.length) { box.append(el('p', 'notice', 'Sem consultas no período.')); return box; }
  const tabela = el('table', 'prod-table'), head = el('tr');
  for (const [t, cls] of [['#'], ['Médico'], ['Plantões', 'num'], ['1º atendimento após início (médio)', 'num'], ['Maior demora num plantão', 'num'], ['Maior intervalo sem atender', 'num']]) head.append(el('th', cls || '', t));
  const thead = el('thead'); thead.append(head); tabela.append(thead);
  const corpo = el('tbody');
  lista.forEach((m, i) => {
   const tr = el('tr');
   const nome = el('td'); nome.append(botaoMedico(m.medico));
   tr.append(el('td', 'pos', String(i + 1)), nome, el('td', 'num', String(m.plantoes)),
    el('td', 'num strong', minutos(m.atrasoMedio)), el('td', 'num', minutos(m.piorAtraso)), el('td', 'num', minutos(m.maiorIntervalo)));
   corpo.append(tr);
  });
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  box.append(wrap, el('small', 'muted', 'Atenção: Cinderelas (12h/18h), extras e médicos que entram em horário diferente das 07h/19h aparecem com valores altos aqui, sem terem se atrasado. Há ainda direito a até 2h de repouso e ao transporte. Use como ponto de conversa, nunca como punição automática.'));
  return box;
 }

 function tabelaEquipes() {
  const um = n => Number(n).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const lista = equipes(filtra(dados.registros)), media = mediaUnidade(filtra(dados.registros));
  const box = el('section', 'prod-section');
  box.append(el('h3', '', 'Desempenho das equipes'), el('p', 'chart-sub', 'Equipes por dia da semana e turno, ordenadas por consultas por médico. Média da unidade no período: ' + `${um(media.mediaPorPlantao)} consultas por plantão · ${um(media.porMedico)} por médico · ${um(media.porMedicoHora)} por médico/hora.`));
  if (!lista.length) { box.append(el('p', 'notice', 'Sem plantões com consulta no período.')); return box; }
  const tabela = el('table', 'prod-table'), head = el('tr');
  for (const [t, cls] of [['#'], ['Equipe'], ['Plantões', 'num'], ['Consultas/plantão', 'num'], ['Médicos/plantão', 'num'], ['Consultas/médico', 'num'], ['Por médico/hora', 'num']]) head.append(el('th', cls || '', t));
  const thead = el('thead'); thead.append(head); tabela.append(thead);
  const corpo = el('tbody'), maxMed = Math.max(...lista.map(e => e.porMedico));
  lista.forEach((e, i) => {
   const tr = el('tr'); if (i === 0) tr.className = 'destaque';
   tr.append(el('td', 'pos', String(i + 1)), el('td', 'strong', e.nome), el('td', 'num', String(e.plantoes)),
    el('td', 'num', um(e.mediaPorPlantao)), el('td', 'num', um(e.mediaMedicos)),
    el('td', 'num strong', um(e.porMedico)), el('td', 'num', um(e.porMedicoHora)));
   corpo.append(tr);
  });
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  box.append(wrap, el('small', 'muted', 'Consultas/médico = total de consultas do plantão ÷ médicos que atenderam, na média dos plantões daquele dia e turno. É a medida mais justa entre equipes de tamanhos diferentes.'));
  return box;
 }

 function tabelaCruzamento() {
  const escalas = plantoesDoPeriodo(dados.inicio, dados.fim).map(p => ({...p, nomes: escalados(seed, storage, p.data, p.turno)}));
  const linhas = cruzamento(filtra(dados.registros), escalas);
  const box = el('section', 'prod-section');
  box.append(el('h3', '', 'Escala × produção'), el('p', 'chart-sub', `${escalas.length} plantões no período · consultórios adulto e pediátrico da escala comparados com as consultas registradas no Gestor Saúde.`));
  const tabela = el('table', 'prod-table'), head = el('tr');
  for (const [t, cls] of [['Médico'], ['Plantões na escala', 'num'], ['Com consultas', 'num'], ['Sem consultas', 'num'], ['Consultas nos plantões', 'num'], ['Média por plantão', 'num'], ['Consultas fora da escala', 'num']]) head.append(el('th', cls || '', t));
  const thead = el('thead'); thead.append(head); tabela.append(thead);
  const body = el('tbody');
  for (const l of linhas) {
   const tr = el('tr'), nome = el('td'); nome.append(botaoMedico(l.medico));
   const sem = el('td', `num${l.semConsulta.length ? ' alerta' : ''}`, String(l.semConsulta.length));
   if (l.semConsulta.length) sem.title = 'Plantões na escala sem consulta registrada: ' + l.semConsulta.map(p => `${dataBR(p.data)} ${p.turno === 'D' ? 'diurno' : 'noturno'}`).join(', ');
   tr.append(nome, el('td', 'num strong', String(l.escalados)), el('td', 'num', String(l.comConsulta)), sem, el('td', 'num', String(l.consultasEscalado)), el('td', 'num', String(l.mediaEscalado)), el('td', `num${l.consultasFora ? ' strong' : ' muted'}`, String(l.consultasFora)));
   body.append(tr);
  }
  tabela.append(body);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  box.append(wrap, el('small', 'muted', '"Sem consultas": escalado sem nenhuma consulta registrada naquele plantão (passe o mouse no número para ver as datas). Pode ser troca, cobertura não registrada ou plantão no Box. "Fora da escala": consultas em plantões em que o médico não estava nos consultórios da escala.'));
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
  lista = ranking(filtra(dados.registros));
  const comConsulta = lista.filter(m => m.total), total = comConsulta.reduce((s, m) => s + m.total, 0);
  // Comparação: mesmos indicadores no outro período, com a variação em %.
  const base = comparado?.registros ? ranking(filtra(comparado.registros)).filter(m => m.total) : null;
  const soma = (l, campo) => l.reduce((s, m) => s + m[campo], 0);
  const rotuloComp = comparado ? `${dataBR(comparado.inicio)} a ${dataBR(comparado.fim)}` : '';
  const comp = (atual, anterior) => base ? ` · ${variacao(atual, anterior)} vs ${anterior} (${rotuloComp})` : '';
  $('.prod-kpis').replaceChildren(
   ...[['CONSULTAS', total, `${dataBR(dados.inicio)} ${dados.inicio.slice(11, 16)} → ${dados.emAndamento ? 'agora' : `${dataBR(dados.fim)} ${dados.fim.slice(11, 16)}`}${comp(total, base && soma(base, 'total'))}`],
    ['ADULTO', soma(comConsulta, 'adulto'), `Médico Clínico${comp(soma(comConsulta, 'adulto'), base && soma(base, 'adulto'))}`],
    ['PEDIATRIA', soma(comConsulta, 'pediatria'), `Médico Pediatra${comp(soma(comConsulta, 'pediatria'), base && soma(base, 'pediatria'))}`],
    ['MÉDICOS', comConsulta.length, `${(total / horas).toFixed(1).replace('.', ',')} consultas por hora`],
    ['RETORNOS BAIXADOS', lista.reduce((s, m) => s + m.retornos, 0), 'à parte · não contam']].map(([rotulo, valor, detalhe]) => {
    const box = el('div', 'flow-kpi'); box.append(el('span', 'flow-kpi-label', rotulo), el('strong', 'flow-kpi-value', String(valor)), el('small', '', detalhe)); return box; }));
  cartaoEscala();
  const agrupamento = $('.prod-group').value, tabelas = $('.prod-tables');
  tabelas.replaceChildren();
  if (!lista.length) { tabelas.append(el('p', 'notice', 'Nenhuma consulta registrada neste período.')); return; }
  if (agrupamento !== 'total') tabelas.append(tabelaGrupos(agrupamento));
  tabelas.append(tabelaRanking(), tabelaEquipes(), tabelaPerfilHora(), tabelaAtrasos(), tabelaCruzamento());
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
   comparado = null;
   const modo = $('.prod-compare').value;
   if (modo && corpo.disponivel && meu === pedido) {
    const p = periodoComparado(corpo.inicio, corpo.fim, modo);
    $('.prod-updated').textContent = 'Lendo o período de comparação…';
    const r2 = await fetch(`/api/producao?inicio=${encodeURIComponent(p.inicio)}&fim=${encodeURIComponent(p.fim)}`, {cache: 'no-store'});
    const c2 = await r2.json().catch(() => ({}));
    if (r2.ok && c2.disponivel && meu === pedido) comparado = c2;
   }
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
 // Delegação no painel: sobrevive a qualquer re-render e capta a mudança do turno de forma confiável.
 panel.addEventListener('change', e => { if (e.target.classList.contains('prod-turno')) { turnoAtual = e.target.value; render(); } });
 $('.prod-compare').onchange = carregar;
 $('.prod-refresh').onclick = carregar;
 // Relatório do mês: usa a impressão do navegador (Salvar como PDF). O @media print deixa só este painel.
 $('.prod-print').onclick = () => { document.body.classList.add('imprimindo-producao'); window.print(); setTimeout(() => document.body.classList.remove('imprimindo-producao'), 500); };
 window.addEventListener('afterprint', () => document.body.classList.remove('imprimindo-producao'));
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
