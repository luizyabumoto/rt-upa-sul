// Produção médica: consultas por médico a partir do relatório Produção Analítico do Gestor Saúde.
// Retornos aparecem só como informação: dar baixa em retorno não significa ter atendido.
import {segments, doctorIdentity, parse, slots} from './scheduling.js';
import {trocasDoPlantao, cartaoSugestao, aplicarSugestao, HORAS_ANTES_DE_TROCAR} from './trocas.js';

// Cores de Manchester em tons sóbrios para o fundo escuro (mesmo significado das cores do Gestor Saúde).
export const CLASSES = [
 ['emergencia', 'Emergência', '#e5484d'], ['muitoUrgente', 'Muito urgente', '#f0883e'], ['urgente', 'Urgente', '#e2b33c'],
 ['prioridade', 'Prioridade', '#a071e6'], ['poucoUrgente', 'Pouco urgente', '#3fb772'], ['naoUrgente', 'Não urgente', '#4c8dea'],
 ['procedimentos', 'Procedimentos', '#5b6474'], ['semClassificacao', 'Sem classificação', '#8391a7'], ['outros', 'Outros', '#6b7688']];
export const PERIODOS = [['atual', 'Plantão atual · tempo real'], ['anterior', 'Plantão anterior'], ['hoje', 'Hoje (desde 07h)'], ['ontem', 'Ontem (07h a 07h)'],
 ['semana', 'Últimos 7 dias'], ['mes', 'Este mês'], ['mesPassado', 'Mês passado'], ['livre', 'Escolher datas…']];
export const AGRUPAR = [['total', 'Período inteiro'], ['plantao', 'Por plantão'], ['dia', 'Por dia'], ['semana', 'Por semana'], ['mes', 'Por mês']];
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

// Área do médico no período: pediatra quem atendeu mais no Consultório Pediátrico; senão, clínico.
export const areaMedico = m => m.pediatria > m.adulto ? 'pediatria' : 'adulto';
export const AREAS_PROD = [['adulto', 'Médicos clínicos'], ['pediatria', 'Médicos pediatras']];
// Só os registros dos médicos da área (a área vem do período inteiro, para não mudar com o filtro de turno).
export function filtrarArea(registros, area) {
 if (!area) return registros;
 const pediatras = new Set(ranking(registros).filter(m => areaMedico(m) === 'pediatria').map(m => m.medico));
 return registros.filter(r => (pediatras.has(r.medico) ? 'pediatria' : 'adulto') === area);
}

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

// Ranking proporcional: consultas por plantão trabalhado (quem fez 10 plantões não fica na frente só por isso).
// Plantão curto (primeira → última consulta em até 7 h: cinderela, saiu no meio, entrou no meio) conta como meio plantão.
export const MIN_PLANTOES_RANKING = 2;
export function pesoPlantao(r) {
 if (!r.primeiro || !r.ultimo) return 1;
 return (Date.parse(r.ultimo) - Date.parse(r.primeiro)) / HORA <= 7 ? 0.5 : 1;
}
export function rankingProporcional(registros) {
 const porMedico = new Map();
 for (const r of registros) {
  if (!consultas(r)) continue;
  const m = porMedico.get(r.medico) || {medico: r.medico, total: 0, adulto: 0, pediatria: 0, plantoes: 0, curtos: 0};
  m.total += consultas(r); m.adulto += r.adulto; m.pediatria += r.pediatria;
  const peso = pesoPlantao(r);
  m.plantoes += peso; if (peso < 1) m.curtos += 1;
  porMedico.set(r.medico, m);
 }
 const todos = [...porMedico.values()].map(m => ({...m, porPlantao: m.total / m.plantoes}));
 const entram = todos.filter(m => m.plantoes >= MIN_PLANTOES_RANKING).sort((a, b) => b.porPlantao - a.porPlantao || b.plantoes - a.plantoes);
 const somaT = entram.reduce((s, m) => s + m.total, 0), somaP = entram.reduce((s, m) => s + m.plantoes, 0);
 return {ranking: entram, poucos: todos.filter(m => m.plantoes < MIN_PLANTOES_RANKING).sort((a, b) => b.porPlantao - a.porPlantao), mediaUnidade: somaP ? somaT / somaP : 0};
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

// Escala ORIGINAL do plantão: a atual, mas desfazendo as trocas que a própria produção aplicou (quem faltou volta,
// quem entrou no lugar sai). Sem isso, quem faltou sumia da "Escala × produção" depois da troca automática.
export function escaladosOriginais(seed, storage, data, turno) {
 const trocas = parse(storage, 'trocas', []).filter(t => t.data === data && t.turno === turno && ['aplicada', 'mantida'].includes(t.status));
 const nome = d => String(d || '').split('\n')[0].trim();
 const nomes = escalados(seed, storage, data, turno).filter(n => !trocas.some(t => mesmoMedico(nome(t.entrou), n)));
 for (const t of trocas) if (t.saiu && !nomes.some(n => mesmoMedico(n, nome(t.saiu)))) nomes.push(nome(t.saiu));
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

// Possíveis faltas e trocas, plantão a plantão, a partir da escala e da produção. Cada linha é um posto de consultório:
//  falta    → escalado sem nenhuma consulta e sem troca/cobertura registrada (com a sugestão de quem atendeu no lugar);
//  producao → a produção detectou a troca (quem saiu não atendeu, quem entrou atendeu) e a escala já foi ajustada;
//  vaga     → posto vago em que alguém de fora atendeu;
//  cobertura / manual → escalado sem consultas, mas com cobertura confirmada ou troca registrada à mão (justificado).
// Plantão em andamento só entra depois das 2 primeiras horas (o escalado pode estar chegando).
const POSTOS_CONSULTORIO = {D: [0, 1, 2, 3, 4, 5], N: [7, 8, 9, 10, 11, 12]};
export function faltasETrocas(seed, storage, registros, lista, agora = Date.now()) {
 const trocasProd = parse(storage, 'trocas', []).filter(t => ['aplicada', 'mantida'].includes(t.status));
 const manuais = parse(storage, 'historico', []).filter(h => h.origem === 'manual');
 const coberturas = parse(storage, 'coverages', []).filter(c => c.confirmed);
 const nome = d => String(d || '').split('\n')[0].trim();
 const linhas = [];
 for (const p of lista) {
  const inicio = Date.parse(`${p.data}T${p.turno === 'D' ? '07' : '19'}:00:00-04:00`);
  if (agora - inicio < HORAS_ANTES_DE_TROCAR * HORA) continue;
  const doPlantao = registros.filter(r => r.data === p.data && r.turno === p.turno);
  const consultasDe = medico => doPlantao.filter(r => mesmoMedico(r.medico, nome(medico))).reduce((s, r) => s + consultas(r), 0);
  const sugestoes = (() => { try { const t = trocasDoPlantao(seed, storage, p, doPlantao); return [...t.automaticas, ...t.suspeitas.flatMap(s => s.pares)]; } catch { return []; } })();
  const base = {data: p.data, turno: p.turno};
  for (const slot of POSTOS_CONSULTORIO[p.turno]) {
   const troca = trocasProd.find(t => t.data === p.data && t.turno === p.turno && t.slot === slot);
   if (troca) { linhas.push({...base, slot, tipo: troca.saiu ? 'producao' : 'vaga', escalado: nome(troca.saiu), substituto: nome(troca.entrou), consultasSubstituto: consultasDe(troca.entrou)}); continue; }
   for (const cob of coberturas.filter(c => c.date === p.data && c.slot === slot)) {
    if (cob.original && !consultasDe(cob.original)) linhas.push({...base, slot, tipo: 'cobertura', escalado: nome(cob.original), substituto: nome(cob.doctor), consultasSubstituto: consultasDe(cob.doctor)});
   }
   const manual = [...manuais].reverse().find(h => h.data === p.data && h.slot === slot && h.saiu);
   if (manual && !consultasDe(manual.saiu)) linhas.push({...base, slot, tipo: 'manual', escalado: nome(manual.saiu), substituto: nome(manual.entrou), consultasSubstituto: consultasDe(manual.entrou)});
   const partes = segments(seed, storage, p.data, slot);
   const vagaSugerida = sugestoes.find(t => t.slot === slot && !t.saiu);
   if (partes.every(s => !s.doctor) && vagaSugerida) linhas.push({...base, slot, tipo: 'vaga', escalado: '', substituto: nome(vagaSugerida.entrou), consultasSubstituto: vagaSugerida.consultas, sugestao: vagaSugerida});
   for (const parte of partes) {
    if (!parte.doctor || consultasDe(parte.doctor)) continue;
    if (linhas.some(l => l.data === p.data && l.turno === p.turno && l.slot === slot && mesmoMedico(l.escalado, nome(parte.doctor)))) continue;
    const sugestao = sugestoes.find(t => t.slot === slot);
    linhas.push({...base, slot, tipo: 'falta', escalado: nome(parte.doctor), substituto: sugestao ? nome(sugestao.entrou) : '', consultasSubstituto: sugestao?.consultas || 0, sugestao: sugestao || null});
   }
  }
 }
 return linhas.sort((a, b) => b.data.localeCompare(a.data) || b.turno.localeCompare(a.turno) || a.slot - b.slot);
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
  '<div class="prod-controls"><label>Período<select class="prod-period"></select></label><label class="prod-free" hidden>Início<input type="datetime-local" class="prod-start"></label><label class="prod-free" hidden>Fim<input type="datetime-local" class="prod-end"></label><label>Turno<select class="prod-turno"><option value="">Diurno + noturno</option><option value="D">Só diurno (07h–19h)</option><option value="N">Só noturno (19h–07h)</option></select></label><label>Área<select class="prod-area"><option value="">Clínicos + pediatras</option><option value="adulto">Só médicos clínicos</option><option value="pediatria">Só médicos pediatras</option></select></label><label>Buscar médico<input type="search" class="prod-busca" placeholder="Nome do médico"></label><label>Ranking<select class="prod-group"></select></label><label>Comparar com<select class="prod-compare"><option value="">Sem comparação</option><option value="anterior">Período anterior</option><option value="ano">Mesmo período do ano passado</option></select></label><button type="button" class="secondary prod-csv">Baixar tabela (CSV)</button></div>' +
  '<p class="flow-alert prod-alert" role="alert" hidden></p><div class="flow-kpis prod-kpis"></div><div class="prod-escala"></div><div class="prod-tables"></div>' +
  '<p class="notice">Consultas nos Consultórios Adulto (Médico Clínico) e Pediátrico (Médico Pediatra), pelo horário do atendimento. Plantões de 12 h: diurno 07h–19h e noturno 19h–07h. Retornos baixados aparecem à parte e não entram no total nem no ranking. Clique no nome do médico para ver os plantões dele na escala.</p>';
 const $ = s => panel.querySelector(s);
 for (const [v, t] of PERIODOS) $('.prod-period').add(new Option(t, v));
 for (const [v, t] of AGRUPAR) $('.prod-group').add(new Option(t, v));
 let dados = null, lista = [], carregando = false, pedido = 0, comparado = null;
 // Filtro de turno (diurno/noturno) aplicado a todas as tabelas; é filtro local, não recarrega o Gestor Saúde.
 let turnoAtual = '', buscaAtual = '', areaAtual = '';
 const filtra = rs => { const l = filtrarArea(rs || [], areaAtual); return turnoAtual ? l.filter(r => r.turno === turnoAtual) : l; };
 // Busca de médico: casa por nome sem acento; vazio mostra todos.
 const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
 const casaMedico = m => !buscaAtual || semAcento(m.medico).includes(buscaAtual);

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

 function tabelaRanking(lista, titulo = 'Ranking de consultas') {
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
  const box = el('section', 'prod-section'); box.append(el('h3', '', titulo), wrap, el('small', 'muted', '* Retornos baixados: só para conhecimento, fora do total e do ranking.'));
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
  const lista = (dados.perfilMedicos || []).filter(m => m.total).filter(casaMedico);
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
  const lista = (dados.perfilMedicos ? (dados.atrasos || []) : []).filter(casaMedico);
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
  box.append(wrap, el('small', 'muted', 'Atenção: Cinderelas (11h/12h), extras e médicos que entram em horário diferente das 07h/19h aparecem com valores altos aqui, sem terem se atrasado. Há ainda direito a até 2h de repouso e ao transporte. Use como ponto de conversa, nunca como punição automática.'));
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
  const escalas = plantoesDoPeriodo(dados.inicio, dados.fim).map(p => ({...p, nomes: escaladosOriginais(seed, storage, p.data, p.turno)}));
  const linhas = cruzamento(filtra(dados.registros), escalas).filter(casaMedico);
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

 // Possíveis faltas e trocas do período, posto a posto (ver faltasETrocas).
 function tabelaFaltas() {
  const lista = plantoesDoPeriodo(dados.inicio, dados.fim).filter(p => !turnoAtual || p.turno === turnoAtual);
  const linhas = faltasETrocas(seed, storage, dados.registros || [], lista).filter(l => !buscaAtual || semAcento(l.escalado).includes(buscaAtual) || semAcento(l.substituto).includes(buscaAtual));
  const conta = tipo => linhas.filter(l => tipo.includes(l.tipo)).length;
  const box = el('section', 'prod-section');
  box.append(el('h3', '', 'Possíveis faltas e trocas'), el('p', 'chart-sub', 'Posto a posto: quem estava na escala e não registrou nenhuma consulta, as trocas que a produção detectou e os postos vagos em que alguém atendeu. Confira caso a caso antes de qualquer cobrança.'));
  if (!linhas.length) { box.append(el('p', 'notice', 'Nenhuma falta ou troca no período: todos os escalados dos consultórios registraram consultas.')); return box; }
  const resumo = el('div', 'faltas-resumo');
  for (const [um, varios, tipos, cls] of [['possível falta', 'possíveis faltas', ['falta'], 'falta'], ['troca detectada pela produção', 'trocas detectadas pela produção', ['producao'], 'producao'], ['vaga preenchida', 'vagas preenchidas', ['vaga'], 'vaga'], ['justificada (cobertura ou troca registrada)', 'justificadas (cobertura ou troca registrada)', ['cobertura', 'manual'], 'justificada']]) {
   const n = conta(tipos); if (n) resumo.append(el('span', `faltas-chip ${cls}`, `${n} ${n === 1 ? um : varios}`));
  }
  box.append(resumo);
  const SITUACAO = {falta: 'Possível falta', producao: 'Troca detectada pela produção', vaga: 'Posto vago preenchido', cobertura: 'Cobertura confirmada', manual: 'Troca registrada na escala'};
  const tabela = el('table', 'prod-table'), head = el('tr');
  for (const t of ['Plantão', 'Posto', 'Escalado (sem consultas)', 'Situação', 'Quem atendeu no lugar']) head.append(el('th', '', t));
  const thead = el('thead'); thead.append(head); tabela.append(thead);
  const corpo = el('tbody');
  for (const l of linhas) {
   const tr = el('tr', `falta-${l.tipo}`), escalado = el('td'), no = el('td');
   if (l.escalado) escalado.append(botaoMedico(l.escalado)); else escalado.append(el('span', 'muted', 'Posto vago'));
   if (l.substituto) no.append(botaoMedico(l.substituto), el('small', 'muted', ` ${l.consultasSubstituto} consultas${l.tipo === 'falta' ? ' · atendeu fora da escala' : ''}`));
   else if (l.tipo === 'falta') no.append(el('span', 'muted', 'Ninguém de fora atendeu no lugar'));
   if (l.sugestao) {
    const botao = el('button', 'secondary', 'Registrar troca');
    botao.type = 'button'; botao.title = `Colocar ${l.substituto} no posto e registrar a troca (dá para desfazer no Painel)`;
    botao.onclick = () => { aplicarSugestao(seed, storage, {data: l.data, turno: l.turno}, [l.sugestao]); document.dispatchEvent(new Event('rt-schedule-changed')); render(); };
    no.append(document.createTextNode(' '), botao);
   }
   tr.append(el('td', '', `${dataBR(l.data).slice(0, 5)} ${l.turno === 'D' ? 'diurno' : 'noturno'}`), el('td', '', slots[l.slot].split(' · ')[1]), escalado,
    el('td', l.tipo === 'falta' ? 'strong alerta' : l.tipo === 'producao' || l.tipo === 'vaga' ? 'strong' : 'muted', SITUACAO[l.tipo]), no);
   corpo.append(tr);
  }
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  // Quem mais aparece como possível falta no período.
  const porMedico = new Map();
  for (const l of linhas.filter(x => x.tipo === 'falta' || x.tipo === 'producao')) porMedico.set(l.escalado, (porMedico.get(l.escalado) || 0) + 1);
  const repetidos = [...porMedico].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  box.append(wrap);
  if (repetidos.length) box.append(el('p', 'notice', `Mais de uma vez no período: ${repetidos.map(([m, n]) => `${m} (${n})`).join(', ')}.`));
  box.append(el('small', 'muted', '"Troca detectada pela produção": quem estava na escala não atendeu e outro médico atendeu no lugar; a escala do dia já foi ajustada (desfaça no Painel se estiver errado). "Registrar troca" aplica a sugestão na escala. Plantão em andamento só aparece depois das 2 primeiras horas. Box fica fora (não registra consultas de consultório).'));
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
  // Possível troca: quem atendeu de fora ocupa os postos vagos e os de quem está sem consultas.
  // No plantão em andamento, só depois das 2 primeiras horas (o escalado pode estar chegando).
  const jaEngrenou = !dados.emAndamento || Date.now() - Date.parse(dados.inicio) >= HORAS_ANTES_DE_TROCAR * HORA;
  if (jaEngrenou) {
   const plantao = {data, turno}, registros = (dados.registros || []).filter(r => r.data === data && r.turno === turno);
   const {automaticas, suspeitas} = trocasDoPlantao(seed, storage, plantao, registros);
   // As automáticas o Painel aplica sozinho; aqui aparecem junto para o RT não precisar esperar a próxima leitura.
   const todas = [...suspeitas, ...['adulto', 'pediatria'].map(area => automaticas.filter(t => t.area === area)).filter(l => l.length)
    .map(pares => ({area: pares[0].area, semConsulta: pares.filter(t => t.saiu).map(t => t.saiu.split('\n')[0]), vagas: pares.filter(t => !t.saiu).length, deFora: pares.map(t => ({medico: t.entrou, consultas: t.consultas})), pares}))];
   for (const s of todas) card.append(cartaoSugestao(seed, storage, plantao, s, render));
  }
  box.append(card);
 }

 // Gráfico do ranking proporcional (uma série: barras horizontais ordenadas + linha da média da unidade).
 const um = n => n.toFixed(1).replace('.', ',');
 const fmtPl = n => `${Number.isInteger(n) ? n : um(n)} ${n === 1 ? 'plantão' : 'plantões'}`;
 let dica = null;
 function graficoProporcional(registros, nomeArea) {
  const {ranking: lista, poucos, mediaUnidade} = rankingProporcional(registros);
  const box = el('section', 'rp-card');
  const cab = el('div', 'rp-cab');
  cab.append(el('h3', '', `Ranking proporcional · ${nomeArea.toLowerCase()}`),
   el('p', 'muted', `Consultas por plantão trabalhado. Média da unidade: ${um(mediaUnidade)} por plantão. Plantão curto (até 7 h de atendimento) conta como meio.`));
  box.append(cab);
  if (!lista.length) { box.append(el('p', 'notice', `Nenhum médico com ${MIN_PLANTOES_RANKING} ou mais plantões neste período. Escolha um período maior (ex.: mês).`)); return box; }
  const max = Math.max(...lista.map(m => m.porPlantao), mediaUnidade) * 1.08;
  const grafico = el('div', 'rp-grafico');
  grafico.style.setProperty('--media', `${(mediaUnidade / max) * 100}%`);
  grafico.setAttribute('role', 'img');
  grafico.setAttribute('aria-label', `Ranking proporcional ${nomeArea}: ` + lista.map((m, i) => `${i + 1}º ${m.medico}, ${um(m.porPlantao)} por plantão`).join('; '));
  lista.forEach((m, i) => {
   const linha = el('div', 'rp-linha');
   const nome = el('button', 'rp-nome', m.medico.split(' ').slice(0, 3).join(' '));
   nome.type = 'button'; nome.title = 'Ver detalhes do médico'; nome.onclick = () => abrirMedico(m.medico);
   const trilho = el('div', 'rp-trilho'), barra = el('span', 'rp-barra');
   barra.style.width = `${(m.porPlantao / max) * 100}%`;
   trilho.append(barra);
   const valor = el('span', 'rp-valor');
   valor.append(el('strong', '', um(m.porPlantao)), el('small', '', ` · ${fmtPl(m.plantoes)}`));
   linha.append(el('span', 'rp-pos', `${i + 1}º`), nome, trilho, valor);
   const dif = mediaUnidade ? Math.round((m.porPlantao / mediaUnidade - 1) * 100) : 0;
   linha.addEventListener('mousemove', e => {
    if (!dica) { dica = el('div', 'rp-dica'); document.body.append(dica); }
    dica.replaceChildren(el('strong', '', m.medico), el('span', '', `${um(m.porPlantao)} consultas por plantão (${dif >= 0 ? '+' : ''}${dif}% vs média)`),
     el('span', '', `${m.total} consultas em ${fmtPl(m.plantoes)}${m.curtos ? ` · ${m.curtos} curto${m.curtos > 1 ? 's' : ''}` : ''}`));
    dica.hidden = false;
    dica.style.left = `${Math.min(e.clientX + 14, innerWidth - dica.offsetWidth - 8)}px`;
    dica.style.top = `${e.clientY + 14}px`;
   });
   linha.addEventListener('mouseleave', () => { if (dica) dica.hidden = true; });
   grafico.append(linha);
  });
  const legenda = el('p', 'rp-legenda');
  legenda.append(el('span', 'rp-leg-barra'), document.createTextNode(' Consultas por plantão   '), el('span', 'rp-leg-media'), document.createTextNode(` Média da unidade (${um(mediaUnidade)}): quem passa da linha está acima da média`));
  box.append(grafico, legenda);
  if (poucos.length) box.append(el('p', 'muted rp-poucos', `Fora do ranking (menos de ${MIN_PLANTOES_RANKING} plantões no período): ${poucos.map(m => `${m.medico.split(' ').slice(0, 2).join(' ')} (${m.total} em ${fmtPl(m.plantoes)})`).join(' · ')}`));
  return box;
 }

 function render() {
  const updated = $('.prod-updated'), alerta = $('.prod-alert');
  if (!dados) return;
  const horas = Math.max(1, (Date.parse(dados.fim) - Date.parse(dados.inicio)) / HORA);
  updated.textContent = dados.atualizadoEm ? `${dados.emAndamento ? 'Em andamento · ' : ''}lido às ${new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}` : '';
  alerta.hidden = dados.disponivel;
  if (!dados.disponivel) alerta.textContent = `Não foi possível ler a produção agora: ${dados.erro || 'falha na leitura'}${dados.registros?.length ? ' Mostrando a última leitura válida.' : ''}`;
  lista = ranking(filtra(dados.registros)).filter(casaMedico);
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
    ['MÉDICOS', comConsulta.length, `${comConsulta.filter(m => areaMedico(m) === 'adulto').length} clínicos · ${comConsulta.filter(m => areaMedico(m) === 'pediatria').length} pediatras · ${(total / horas).toFixed(1).replace('.', ',')} consultas/h`],
    ['RETORNOS BAIXADOS', lista.reduce((s, m) => s + m.retornos, 0), 'à parte · não contam']].map(([rotulo, valor, detalhe]) => {
    const box = el('div', 'flow-kpi'); box.append(el('span', 'flow-kpi-label', rotulo), el('strong', 'flow-kpi-value', String(valor)), el('small', '', detalhe)); return box; }));
  cartaoEscala();
  const agrupamento = $('.prod-group').value, tabelas = $('.prod-tables');
  tabelas.replaceChildren();
  if (!lista.length) { tabelas.append(el('p', 'notice', 'Nenhuma consulta registrada neste período.')); return; }
  if (agrupamento !== 'total' && !buscaAtual) tabelas.append(tabelaGrupos(agrupamento));
  // Clínicos e pediatras em rankings separados (cada um com a sua numeração).
  const areas = AREAS_PROD.filter(([a]) => !areaAtual || a === areaAtual).map(([a, nome]) => [nome, lista.filter(m => areaMedico(m) === a)]).filter(([, l]) => l.length);
  if (!buscaAtual) {
   const doPeriodo = filtra(dados.registros);
   for (const [area, nome] of AREAS_PROD.filter(([a]) => !areaAtual || a === areaAtual)) {
    const nomes = new Set(lista.filter(m => areaMedico(m) === area).map(m => m.medico));
    if (nomes.size) tabelas.append(graficoProporcional(doPeriodo.filter(r => nomes.has(r.medico)), nome));
   }
  }
  for (const [nome, l] of areas) tabelas.append(tabelaRanking(l, `Ranking de consultas · ${nome.toLowerCase()} (${l.filter(m => m.total).length})`));
  if (!buscaAtual) tabelas.append(tabelaEquipes());
  tabelas.append(tabelaPerfilHora(), tabelaAtrasos(), tabelaCruzamento(), tabelaFaltas());
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
 panel.addEventListener('change', e => { if (e.target.classList.contains('prod-turno')) { turnoAtual = e.target.value; render(); } if (e.target.classList.contains('prod-area')) { areaAtual = e.target.value; render(); } });
 $('.prod-compare').onchange = carregar;
 $('.prod-refresh').onclick = carregar;
 panel.addEventListener('input', e => { if (e.target.classList.contains('prod-busca')) { buscaAtual = semAcento(e.target.value.trim()); render(); } });
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
