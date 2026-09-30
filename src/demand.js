// Análise de demanda: consultas médicas (adulto + pediatria) por dia, dia da semana, hora e mês.
// Fonte: /api/demanda (contagens por hora, sem dados de pacientes). Períodos longos são lidos em janelas
// de até 31 dias; janelas já encerradas ficam guardadas neste navegador para não serem pedidas de novo.
import {segments} from './scheduling.js';
import {plantaoAtual, CLASSES} from './production.js';
import {formatarEspera} from './flow.js';
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const COR = '#23a896', PICO = '#e0a44a';       // verde-azulado do tema e âmbar do pico, legíveis no fundo escuro
const HORA_MS = 3600000, DIA_MS = 24 * HORA_MS;
const ROTULO_CURTO = {emergencia: 'Emergência', muitoUrgente: 'Muito urg.', urgente: 'Urgente', prioridade: 'Prioridade', poucoUrgente: 'Pouco urg.', naoUrgente: 'Não urg.', procedimentos: 'Proced.', semClassificacao: 'Sem class.', outros: 'Outros'};
export const PERIODOS_DEMANDA = [['atual', 'Plantão atual'], ['anterior', 'Plantão anterior'], ['plantao', 'Um plantão específico…'],
 ['hoje', 'Hoje (00h até agora)'], ['ontem', 'Ontem (00h–24h)'], ['7', 'Últimos 7 dias'], ['semana', 'Esta semana (desde segunda)'], ['semanaPassada', 'Semana passada'],
 ['30', 'Últimos 30 dias'], ['mes', 'Este mês'], ['mesPassado', 'Mês passado'], ['90', 'Últimos 90 dias'],
 ['ano', 'Este ano'], ['12m', 'Últimos 12 meses'], ['anoPassado', 'Ano passado'], ['livre', 'Escolher datas e horários…']];

const cuiaba = date => new Date(date.getTime() - 4 * HORA_MS);
const texto = d => d.toISOString().slice(0, 16);
const dataBR = iso => iso.slice(0, 10).split('-').reverse().join('/');
const numero = (n, casas = 0) => n.toLocaleString('pt-BR', {minimumFractionDigits: casas, maximumFractionDigits: casas});

// Um plantão específico: diurno 07h–19h ou noturno 19h–07h do dia seguinte.
export const periodoPlantao = (data, turno) => {
 const inicio = new Date(`${data}T${turno === 'N' ? '19' : '07'}:00:00Z`);
 return {inicio: texto(inicio), fim: texto(new Date(inicio.getTime() + 12 * HORA_MS))};
};

export function periodoDemanda(chave, agora = new Date()) {
 const local = cuiaba(agora), hoje = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
 const menosDias = d => new Date(hoje.getTime() - d * DIA_MS);
 const ano = local.getUTCFullYear(), mes = local.getUTCMonth();
 const segunda = menosDias((hoje.getUTCDay() + 6) % 7);
 const plantao = plantaoAtual(agora);
 switch (chave) {
  case 'atual': return {inicio: plantao.inicio, fim: 'agora'};
  case 'anterior': return {inicio: texto(new Date(Date.parse(plantao.inicio + ':00Z') - 12 * HORA_MS)), fim: plantao.inicio};
  case 'hoje': return {inicio: texto(hoje), fim: 'agora'};
  case 'ontem': return {inicio: texto(menosDias(1)), fim: texto(hoje)};
  case '7': return {inicio: texto(menosDias(6)), fim: 'agora'};
  case 'semana': return {inicio: texto(segunda), fim: 'agora'};
  case 'semanaPassada': return {inicio: texto(new Date(segunda.getTime() - 7 * DIA_MS)), fim: texto(segunda)};
  case 'mes': return {inicio: texto(new Date(Date.UTC(ano, mes, 1))), fim: 'agora'};
  case 'mesPassado': return {inicio: texto(new Date(Date.UTC(ano, mes - 1, 1))), fim: texto(new Date(Date.UTC(ano, mes, 1)))};
  case '90': return {inicio: texto(menosDias(89)), fim: 'agora'};
  case 'ano': return {inicio: `${ano}-01-01T00:00`, fim: 'agora'};
  case '12m': return {inicio: texto(new Date(Date.UTC(ano - 1, local.getUTCMonth(), local.getUTCDate()))), fim: 'agora'};
  case 'anoPassado': return {inicio: `${ano - 1}-01-01T00:00`, fim: `${ano}-01-01T00:00`};
  default: return {inicio: texto(menosDias(29)), fim: 'agora'};
 }
}

// Janelas de no máximo 31 dias; "agora" fica só na última.
export function janelas(inicio, fim, agora = new Date()) {
 const fimData = fim === 'agora' ? new Date(texto(cuiaba(agora)) + ':00Z') : new Date(fim + ':00Z');
 const lista = [];
 for (let a = new Date(inicio + ':00Z'); a < fimData;) {
  const b = new Date(Math.min(a.getTime() + 31 * 24 * HORA_MS, fimData.getTime()));
  lista.push({inicio: texto(a), fim: fim === 'agora' && b.getTime() === fimData.getTime() ? 'agora' : texto(b)});
  a = b;
 }
 return lista;
}

// Plantão (data de início + turno) a que pertence uma hora-relógio "AAAA-MM-DDTHH".
export function plantaoDaHora(chave) {
 const h = Number(chave.slice(11, 13)), data = chave.slice(0, 10);
 if (h >= 7 && h < 19) return {data, turno: 'D'};
 if (h >= 19) return {data, turno: 'N'};
 return {data: new Date(Date.parse(data + 'T12:00:00Z') - DIA_MS).toISOString().slice(0, 10), turno: 'N'};
}
const segundaDe = data => { const d = new Date(data + 'T12:00:00Z'); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DIA_MS).toISOString().slice(0, 10); };

// Recebe {"AAAA-MM-DDTHH": {adulto, pediatria, espera?: {classe: [n, minutos]}}} e o período (fim exclusivo);
// devolve as séries da análise. A média por hora do dia divide pelo número de vezes que aquela hora cabe no período,
// então funciona igual para um plantão, um dia, uma semana ou um ano.
export function analisar(horas, inicio, fim) {
 const dias = new Map(), plantoes = new Map(), ocorrencias = Array.from({length: 24}, () => 0), limite = fim.slice(0, 16);
 let horasNoPeriodo = 0;
 for (let t = new Date(inicio.slice(0, 13) + ':00:00Z'); texto(t) < limite; t = new Date(t.getTime() + HORA_MS)) {
  const chave = t.toISOString().slice(0, 13), data = chave.slice(0, 10), p = plantaoDaHora(chave);
  horasNoPeriodo += 1; ocorrencias[t.getUTCHours()] += 1;
  if (!dias.has(data)) dias.set(data, {data, total: 0, adulto: 0, pediatria: 0});
  if (!plantoes.has(p.data + p.turno)) plantoes.set(p.data + p.turno, {...p, total: 0, adulto: 0, pediatria: 0});
 }
 const porHora = Array.from({length: 24}, () => 0), espera = new Map();
 for (const [chave, c] of Object.entries(horas)) {
  const dia = dias.get(chave.slice(0, 10));
  if (!dia || chave < inicio.slice(0, 13) || chave + ':00' >= limite) continue;
  const p = plantoes.get(Object.values(plantaoDaHora(chave)).join(''));
  for (const alvo of [dia, p]) if (alvo) { alvo.adulto += c.adulto; alvo.pediatria += c.pediatria; alvo.total += c.adulto + c.pediatria; }
  porHora[Number(chave.slice(11, 13))] += c.adulto + c.pediatria;
  for (const [classe, [n, soma]] of Object.entries(c.espera || {})) { const e = espera.get(classe) || {n: 0, soma: 0}; e.n += n; e.soma += soma; espera.set(classe, e); }
 }
 const semanas = new Map();
 for (const d of dias.values()) { const k = segundaDe(d.data); const s = semanas.get(k) || {inicio: k, total: 0, dias: 0}; s.total += d.total; s.dias += 1; semanas.set(k, s); }
 const esperaGeral = [...espera.values()].reduce((a, e) => ({n: a.n + e.n, soma: a.soma + e.soma}), {n: 0, soma: 0});
 const listaDias = [...dias.values()], total = listaDias.reduce((s, d) => s + d.total, 0), n = listaDias.length || 1;
 const semana = DIAS_SEMANA.map((nome, i) => { const ds = listaDias.filter(d => new Date(d.data + 'T12:00:00Z').getUTCDay() === i); return {nome, dias: ds.length, total: ds.reduce((s, d) => s + d.total, 0), media: ds.length ? ds.reduce((s, d) => s + d.total, 0) / ds.length : 0}; });
 const meses = new Map();
 for (const d of listaDias) { const k = d.data.slice(0, 7); const m = meses.get(k) || {mes: k, total: 0, dias: 0}; m.total += d.total; m.dias += 1; meses.set(k, m); }
 const listaMeses = [...meses.values()].map(m => ({...m, media: m.total / m.dias}));
 const recorde = listaDias.reduce((a, b) => (b.total > a.total ? b : a), listaDias[0] || {data: inicio.slice(0, 10), total: 0});
 return {
  total, mediaDia: total / n, dias: listaDias, recorde, semana, meses: listaMeses,
  hora: porHora.map((t, h) => ({hora: h, media: ocorrencias[h] ? t / ocorrencias[h] : 0})),
  top: [...listaDias].sort((a, b) => b.total - a.total || a.data.localeCompare(b.data)).slice(0, 10),
  horasNoPeriodo, porHora: horasNoPeriodo ? total / horasNoPeriodo : 0,
  plantoes: [...plantoes.values()], semanas: [...semanas.values()].map(s => ({...s, media: s.total / s.dias})),
  espera: CLASSES.filter(([k]) => espera.has(k)).map(([chave, nome, cor]) => ({chave, nome, cor, n: espera.get(chave).n, media: Math.round(espera.get(chave).soma / espera.get(chave).n)})),
  esperaGeral: {n: esperaGeral.n, media: esperaGeral.n ? Math.round(esperaGeral.soma / esperaGeral.n) : null},
 };
}

// Médicos escalados em cada hora do dia (consultórios adulto e pediátrico e cinderelas, com coberturas),
// só nos dias com escala cadastrada. O noturno (19h–07h) conta nas horas do dia seguinte depois da meia-noite.
const POSTOS_CONSULTA = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15];
export function medicosPorHora(datas, partesDoPosto) {
 const porDia = new Map(datas.map(d => [d, Array.from({length: 24}, () => 0)]));
 const comEscala = new Set();
 for (const data of datas) for (const slot of POSTOS_CONSULTA) for (const parte of partesDoPosto(data, slot)) {
  if (!parte.doctor) continue;
  comEscala.add(data);
  for (let h = parte.start; h < parte.end; h++) {
   const dia = h >= 24 ? new Date(Date.parse(data + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10) : data;
   if (porDia.has(dia)) porDia.get(dia)[h % 24] += 1;
  }
 }
 const dias = [...comEscala];
 return {dias, media: Array.from({length: 24}, (_, h) => dias.length ? dias.reduce((s, d) => s + porDia.get(d)[h], 0) / dias.length : 0)};
}

// Consultas por médico escalado em cada hora, nos mesmos dias com escala.
export function pressaoPorHora(horas, escala) {
 const consultas = Array.from({length: 24}, () => 0);
 for (const [chave, c] of Object.entries(horas)) if (escala.dias.includes(chave.slice(0, 10))) consultas[Number(chave.slice(11, 13))] += c.adulto + c.pediatria;
 return consultas.map((total, hora) => {
  const media = escala.dias.length ? total / escala.dias.length : 0, medicos = escala.media[hora];
  return {hora, consultas: media, medicos, porMedico: medicos ? media / medicos : 0};
 });
}

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const svg =(tag, attrs) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

// Colunas de uma série: barra fina com ponta arredondada, pico em âmbar e rotulado, dica ao passar o mouse e tabela.
function colunas({titulo, subtitulo, itens, rotulo, valor, dica, formato = v => numero(v, 1), rotuloEixo = () => true}) {
 const figura = el('figure', 'chart');
 figura.append(el('figcaption', 'chart-title', titulo));
 if (subtitulo) figura.append(el('p', 'chart-sub', subtitulo));
 const largura = 720, altura = 220, margem = {topo: 22, base: 28, esq: 36, dir: 8};
 const maximo = Math.max(...itens.map(valor), 0) || 1, passo = (largura - margem.esq - margem.dir) / Math.max(itens.length, 1);
 const escala = v => (altura - margem.topo - margem.base) * (v / maximo);
 const indicePico = itens.reduce((m, it, i, a) => (valor(it) > valor(a[m]) ? i : m), 0);
 const grafico = svg('svg', {viewBox: `0 0 ${largura} ${altura}`, role: 'img', 'aria-label': titulo, class: 'chart-svg'});
 for (const f of [0.5, 1]) {
  const y = altura - margem.base - (altura - margem.topo - margem.base) * f;
  grafico.append(svg('line', {x1: margem.esq, x2: largura - margem.dir, y1: y, y2: y, class: 'chart-grid'}));
  const t = svg('text', {x: margem.esq - 6, y: y + 4, class: 'chart-axis', 'text-anchor': 'end'}); t.textContent = numero(maximo * f, maximo < 10 ? 1 : 0); grafico.append(t);
 }
 grafico.append(svg('line', {x1: margem.esq, x2: largura - margem.dir, y1: altura - margem.base, y2: altura - margem.base, class: 'chart-base'}));
 const dicaBox = el('div', 'chart-tip'); dicaBox.hidden = true;
 itens.forEach((item, i) => {
  const v = valor(item), h = Math.max(escala(v), v > 0 ? 2 : 0), largBarra = Math.max(2, Math.min(28, passo - 2));
  const x = margem.esq + i * passo + (passo - largBarra) / 2, y = altura - margem.base - h;
  const barra = svg('path', {d: h ? `M${x},${altura - margem.base} V${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, largBarra / 2)},${y} H${x + largBarra - Math.min(4, largBarra / 2)} Q${x + largBarra},${y} ${x + largBarra},${y + Math.min(4, h)} V${altura - margem.base} Z` : '', fill: i === indicePico ? PICO : COR});
  grafico.append(barra);
  if (i === indicePico && v > 0) { const t = svg('text', {x: x + largBarra / 2, y: y - 6, class: 'chart-peak', 'text-anchor': 'middle'}); t.textContent = formato(v); grafico.append(t); }
  if (rotuloEixo(item, i)) { const t = svg('text', {x: margem.esq + i * passo + passo / 2, y: altura - 10, class: 'chart-axis', 'text-anchor': 'middle'}); t.textContent = rotulo(item); grafico.append(t); }
  const alvo = svg('rect', {x: margem.esq + i * passo, y: margem.topo, width: passo, height: altura - margem.topo - margem.base, class: 'chart-hit'});
  alvo.addEventListener('mouseenter', () => { barra.classList.add('ativo'); dicaBox.hidden = false; dicaBox.textContent = dica(item); });
  alvo.addEventListener('mousemove', e => { const r = figura.getBoundingClientRect(); dicaBox.style.left = `${Math.min(e.clientX - r.left + 12, r.width - 190)}px`; dicaBox.style.top = `${e.clientY - r.top - 12}px`; });
  alvo.addEventListener('mouseleave', () => { barra.classList.remove('ativo'); dicaBox.hidden = true; });
  grafico.append(alvo);
 });
 const tabela = el('details', 'chart-table'), resumoTabela = el('summary', '', 'Ver tabela'), t = el('table', 'prod-table');
 for (const item of itens) { const tr = el('tr'); tr.append(el('td', '', rotulo(item)), el('td', 'num', dica(item).split(': ').slice(1).join(': ') || formato(valor(item)))); t.append(tr); }
 tabela.append(resumoTabela, t);
 figura.append(grafico, dicaBox, tabela);
 return figura;
}

export function mountDemand(storage, seed) {
 const flow = document.querySelector('#flow-panel');
 if (!flow) return;
 const secao = el('section', 'demand');
 secao.innerHTML = '<div class="section-heading"><div><p class="eyebrow">ANÁLISE DE DEMANDA · CONSULTAS MÉDICAS</p><h2>Quando a unidade mais atende</h2></div><div class="actions"><span class="demand-status" role="status" aria-live="polite"></span></div></div>' +
  '<div class="prod-controls"><label>Período<select class="demand-period"></select></label>' +
  '<label class="demand-shift" hidden>Dia do plantão<input type="date" class="demand-shift-date"></label><label class="demand-shift" hidden>Plantão<select class="demand-shift-turno"><option value="D">Diurno (07h–19h)</option><option value="N">Noturno (19h–07h)</option></select></label>' +
  '<label class="demand-free" hidden>Início<input type="datetime-local" class="demand-start"></label><label class="demand-free" hidden>Fim<input type="datetime-local" class="demand-end"></label>' +
  '<label>Turno<select class="demand-turno"><option value="">Diurno + noturno</option><option value="D">Só diurno (07h–19h)</option><option value="N">Só noturno (19h–07h)</option></select></label><label class="demand-comparar-label"><input type="checkbox" class="demand-comparar"> Comparar com período anterior</label></div>' +
  '<div class="flow-kpis demand-kpis"></div><div class="demand-charts"></div>' +
  '<p class="notice">Consultas nos Consultórios Adulto e Pediátrico pelo horário do atendimento (retornos não entram). Médias por dia da semana e por hora consideram todos os dias do período, inclusive os com zero. Espera = do encaminhamento ao consultório até o atendimento. Meses já encerrados ficam guardados neste navegador.</p>';
 flow.append(secao);
 const $ = s => secao.querySelector(s);
 for (const [v, t] of PERIODOS_DEMANDA) $('.demand-period').add(new Option(t, v));
 $('.demand-period').value = '30';
 let pedido = 0, carregado = false, ultimo = null;

 // "rt-demanda2": as janelas agora trazem também a espera por classificação; as antigas (sem espera) são relidas.
 const guardado = janela => { try { return JSON.parse(localStorage.getItem('rt-demanda2:' + janela.inicio + '|' + janela.fim)); } catch { return null; } };
 const guardar = (janela, horas) => { try { localStorage.setItem('rt-demanda2:' + janela.inicio + '|' + janela.fim, JSON.stringify(horas)); } catch { /* sem espaço: só não guarda */ } };

 function escolha() {
  const chave = $('.demand-period').value;
  if (chave === 'plantao') { const d = $('.demand-shift-date').value; return d ? periodoPlantao(d, $('.demand-shift-turno').value) : null; }
  if (chave !== 'livre') return periodoDemanda(chave);
  const [a, b] = [$('.demand-start').value, $('.demand-end').value];
  return a && b && a < b ? {inicio: a, fim: b} : null;
 }

 const variar = (atual, ant) => { if (ant === null || ant === undefined || !ant) return ''; const p = Math.round((atual - ant) / ant * 100); return ` · ${p > 0 ? '▲ +' : p < 0 ? '▼ ' : ''}${p}% vs anterior`; };
 const nomePlantao = p => `${dataBR(p.data).slice(0, 5)} ${p.turno === 'D' ? 'diurno' : 'noturno'}`;
 function render(a, inicio, fimTexto, horas = {}, comparacao = null) {
  const kpi = (rotulo, valor, detalhe) => { const b = el('div', 'flow-kpi'); b.append(el('span', 'flow-kpi-label', rotulo), el('strong', 'flow-kpi-value', valor), el('small', '', detalhe)); return b; };
  const semanaTop = a.semana.reduce((x, y) => (y.media > x.media ? y : x)), horaTop = a.hora.reduce((x, y) => (y.media > x.media ? y : x));
  // Até um dia e meio (um plantão, hoje, ontem): médias por dia e por dia da semana não dizem nada.
  const curto = a.horasNoPeriodo <= 36;
  const plantoes = a.plantoes.filter(p => !turnoDemanda || p.turno === turnoDemanda);
  const kpis = [kpi('CONSULTAS NO PERÍODO', numero(a.total), `${dataBR(inicio)} ${inicio.slice(11, 16)} a ${fimTexto}${comparacao ? variar(a.total, comparacao.total) : ''}`)];
  if (curto) kpis.push(kpi('CONSULTAS POR HORA', numero(a.porHora, 1), `${a.horasNoPeriodo} h no período${comparacao ? variar(a.porHora, comparacao.porHora) : ''}`),
   kpi('HORA MAIS CHEIA', `${String(horaTop.hora).padStart(2, '0')}h`, `${numero(horaTop.media, horaTop.media % 1 ? 1 : 0)} consultas nessa hora`));
  else kpis.push(kpi('MÉDIA POR DIA', numero(a.mediaDia, 1), `${a.dias.length} dias${comparacao ? variar(a.mediaDia, comparacao.mediaDia) : ''}`),
   kpi('DIA RECORDE', numero(a.recorde.total), `${dataBR(a.recorde.data)} · ${DIAS_SEMANA[new Date(a.recorde.data + 'T12:00:00Z').getUTCDay()].toLowerCase()}`),
   kpi('DIA DA SEMANA MAIS CHEIO', semanaTop.nome, `média de ${numero(semanaTop.media, 1)} consultas`),
   kpi('HORÁRIO DE PICO', `${String(horaTop.hora).padStart(2, '0')}h`, `média de ${numero(horaTop.media, 1)} consultas nessa hora`));
  if (plantoes.length >= 2) { const topo = plantoes.reduce((x, y) => (y.total > x.total ? y : x)); kpis.push(kpi('PLANTÃO MAIS CHEIO', numero(topo.total), `${nomePlantao(topo)} · média ${numero(plantoes.reduce((s, p) => s + p.total, 0) / plantoes.length, 1)} por plantão`)); }
  if (a.esperaGeral.n) kpis.push(kpi('ESPERA MÉDIA', formatarEspera(a.esperaGeral.media), `${numero(a.esperaGeral.n)} atendimentos com espera registrada${comparacao?.esperaMedia ? variar(a.esperaGeral.media, comparacao.esperaMedia) : ''}`));
  $('.demand-kpis').replaceChildren(...kpis);
  const graficos = [];
  if (!curto) graficos.push(colunas({titulo: 'Média de consultas por dia da semana', subtitulo: 'Qual dia costuma ser mais pesado', itens: a.semana, rotulo: s => s.nome.slice(0, 3), valor: s => s.media, dica: s => `${s.nome} · ${s.dias} dias no período: ${numero(s.media, 1)} consultas em média`}));
  graficos.push(colunas({titulo: curto ? 'Consultas por hora' : 'Média de consultas por hora do dia', subtitulo: curto ? 'Cada barra é uma hora do período' : 'Horários de maior procura (média de todos os dias)', itens: a.hora, rotulo: h => `${h.hora}h`, valor: h => h.media, rotuloEixo: (_, i) => i % 3 === 0, dica: h => `${String(h.hora).padStart(2, '0')}h–${String((h.hora + 1) % 24).padStart(2, '0')}h: ${numero(h.media, 1)} consultas${curto ? '' : ' em média'}`}));
  if (a.espera.length) graficos.push(colunas({titulo: 'Espera média por classificação', subtitulo: 'Do encaminhamento ao consultório até o atendimento médico', itens: a.espera, rotulo: e => ROTULO_CURTO[e.chave] || e.nome, valor: e => e.media, formato: formatarEspera,
   dica: e => `${e.nome} · ${numero(e.n)} atendimentos: ${formatarEspera(e.media)} de espera média`}));
  if (plantoes.length >= 2 && plantoes.length <= 62) graficos.push(colunas({titulo: 'Consultas por plantão', subtitulo: 'Diurno 07h–19h · noturno 19h–07h', itens: plantoes, rotulo: p => `${dataBR(p.data).slice(0, 5)} ${p.turno}`, valor: p => p.total, formato: v => numero(v), rotuloEixo: (_, i) => i % Math.max(1, Math.ceil(plantoes.length / 10)) === 0,
   dica: p => `${nomePlantao(p)}: ${numero(p.total)} consultas (adulto ${p.adulto} · pediatria ${p.pediatria})`}));
  if (a.semanas.length >= 2 && a.semanas.length <= 60) graficos.push(colunas({titulo: 'Média de consultas por dia, semana a semana', subtitulo: 'Cada barra é uma semana (segunda a domingo)', itens: a.semanas, rotulo: s => dataBR(s.inicio).slice(0, 5), valor: s => s.media, rotuloEixo: (_, i) => i % Math.max(1, Math.ceil(a.semanas.length / 10)) === 0,
   dica: s => `Semana de ${dataBR(s.inicio)} · ${numero(s.total)} consultas em ${s.dias} dias: ${numero(s.media, 1)} por dia`}));
  if (a.meses.length >= 2) graficos.push(colunas({titulo: 'Média de consultas por dia, mês a mês', subtitulo: 'Meses mais movimentados do período', itens: a.meses, rotulo: m => `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(2, 4)}`, valor: m => m.media, dica: m => `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(0, 4)} · ${numero(m.total)} consultas em ${m.dias} dias: ${numero(m.media, 1)} por dia`}));
  if (storage && seed) {
   const escala = medicosPorHora(a.dias.map(d => d.data), (data, slot) => segments(seed, storage, data, slot));
   if (escala.dias.length) graficos.push(colunas({titulo: 'Consultas por médico escalado, por hora', subtitulo: `Onde a escala fica mais apertada · ${escala.dias.length} dias com escala cadastrada`, itens: pressaoPorHora(horas, escala), rotulo: h => `${h.hora}h`, valor: h => h.porMedico, rotuloEixo: (_, i) => i % 3 === 0,
    dica: h => `${String(h.hora).padStart(2, '0')}h · ${numero(h.consultas, 1)} consultas e ${numero(h.medicos, 1)} médicos em média: ${numero(h.porMedico, 1)} por médico`}));
  }
  if (a.dias.length >= 2) graficos.push(colunas({titulo: 'Consultas por dia', subtitulo: 'Cada barra é um dia (00h às 24h)', itens: a.dias, rotulo: d => dataBR(d.data).slice(0, 5), valor: d => d.total, formato: v => numero(v), rotuloEixo: (_, i) => i % Math.max(1, Math.ceil(a.dias.length / 10)) === 0,
   dica: d => `${dataBR(d.data)} · ${DIAS_SEMANA[new Date(d.data + 'T12:00:00Z').getUTCDay()]}: ${numero(d.total)} consultas (adulto ${d.adulto} · pediatria ${d.pediatria})`}));
  if (curto) { $('.demand-charts').replaceChildren(...graficos); return; }
  const top = el('section', 'prod-section'), tabela = el('table', 'prod-table');
  tabela.innerHTML = '<thead><tr><th>#</th><th>Dia</th><th>Dia da semana</th><th class="num">Consultas</th><th class="num">Adulto</th><th class="num">Pediatria</th></tr></thead>';
  const corpo = el('tbody');
  a.top.forEach((d, i) => { const tr = el('tr'); tr.append(el('td', 'pos', String(i + 1)), el('td', '', dataBR(d.data)), el('td', '', DIAS_SEMANA[new Date(d.data + 'T12:00:00Z').getUTCDay()]), el('td', 'num strong', numero(d.total)), el('td', 'num', numero(d.adulto)), el('td', 'num', numero(d.pediatria))); corpo.append(tr); });
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  top.append(el('h3', '', 'Dias mais movimentados'), wrap);
  $('.demand-charts').replaceChildren(...graficos, top);
 }

 // Lê as horas de um intervalo, janela a janela, aproveitando o cache local dos meses encerrados.
 async function lerHoras(ini, fimTexto, meu, rotulo) {
  const lista = janelas(ini, fimTexto), horas = {};
  let falhas = 0;
  for (let i = 0; i < lista.length; i++) {
   if (meu !== pedido) return null;
   $('.demand-status').textContent = `Lendo o Gestor Saúde… ${rotulo}${i + 1} de ${lista.length}`;
   const janela = lista[i];
   let parte = janela.fim !== 'agora' ? guardado(janela) : null;
   if (!parte) {
    try {
     const r = await fetch(`/api/demanda?inicio=${encodeURIComponent(janela.inicio)}&fim=${encodeURIComponent(janela.fim)}`, {cache: 'no-store'});
     const corpo = await r.json().catch(() => ({}));
     if (!r.ok || !corpo.disponivel) throw new Error(corpo.error || corpo.erro || 'falha');
     parte = corpo.horas;
     if (janela.fim !== 'agora') guardar(janela, parte);
    } catch { falhas++; continue; }
   }
   Object.assign(horas, parte);
  }
  return {horas, falhas};
 }

 async function carregar() {
  const periodo = escolha();
  if (!periodo) { $('.demand-status').textContent = 'Escolha início e fim.'; return; }
  const meu = ++pedido;
  const principal = await lerHoras(periodo.inicio, periodo.fim, meu, '');
  if (!principal) return;
  const fimReal = periodo.fim === 'agora' ? texto(cuiaba(new Date())) : periodo.fim;
  let anterior = null;
  if ($('.demand-comparar').checked) {
   // Período anterior de mesma duração, terminando no início do período atual.
   const dur = new Date(fimReal + ':00Z') - new Date(periodo.inicio + ':00Z');
   const iniAnt = texto(new Date(new Date(periodo.inicio + ':00Z') - dur));
   const bloco = await lerHoras(iniAnt, periodo.inicio, meu, 'comparação · ');
   if (!bloco) return;
   anterior = {horas: bloco.horas, inicio: iniAnt, fim: periodo.inicio};
  }
  if (meu !== pedido) return;
  ultimo = {horas: principal.horas, inicio: periodo.inicio, fimReal, rotuloFim: periodo.fim === 'agora' ? 'agora' : `${dataBR(periodo.fim)} ${periodo.fim.slice(11, 16)}`, anterior};
  desenhar();
  $('.demand-status').textContent = principal.falhas ? `Atenção: ${principal.falhas} parte(s) do período não puderam ser lidas agora.` : `Atualizado às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
 }

 // Filtra as horas por turno (diurno 07h–19h · noturno 19h–07h) e redesenha, sem reler o Gestor Saúde.
 let turnoDemanda = '';
 function desenhar() {
  if (!ultimo) return;
  const t = turnoDemanda;
  const dentro = h => t === 'D' ? (h >= 7 && h <= 18) : t === 'N' ? (h >= 19 || h <= 6) : true;
  const soTurno = obj => t ? Object.fromEntries(Object.entries(obj).filter(([k]) => dentro(Number(k.slice(11, 13))))) : obj;
  const horas = soTurno(ultimo.horas);
  let comparacao = null;
  if (ultimo.anterior) {
   const a = analisar(soTurno(ultimo.anterior.horas), ultimo.anterior.inicio, ultimo.anterior.fim);
   comparacao = {total: a.total, mediaDia: a.mediaDia, porHora: a.porHora, esperaMedia: a.esperaGeral.media, rotulo: `${dataBR(ultimo.anterior.inicio)} a ${dataBR(ultimo.anterior.fim)}`};
  }
  render(analisar(horas, ultimo.inicio, ultimo.fimReal), ultimo.inicio, ultimo.rotuloFim, horas, comparacao);
 }

 $('.demand-period').onchange = () => {
  const chave = $('.demand-period').value;
  secao.querySelectorAll('.demand-free').forEach(l => { l.hidden = chave !== 'livre'; });
  secao.querySelectorAll('.demand-shift').forEach(l => { l.hidden = chave !== 'plantao'; });
  // Plantão específico começa no plantão atual; datas livres começam nos últimos 7 dias.
  if (chave === 'plantao' && !$('.demand-shift-date').value) { const p = plantaoAtual(); $('.demand-shift-date').value = p.data; $('.demand-shift-turno').value = p.turno; }
  if (chave === 'livre' && !$('.demand-start').value) { const p = periodoDemanda('7'); $('.demand-start').value = p.inicio; $('.demand-end').value = texto(cuiaba(new Date())); }
  carregar();
 };
 $('.demand-start').onchange = $('.demand-end').onchange = $('.demand-shift-date').onchange = $('.demand-shift-turno').onchange = carregar;
 secao.addEventListener('change', e => { if (e.target.classList.contains('demand-turno')) { turnoDemanda = e.target.value; desenhar(); } if (e.target.classList.contains('demand-comparar')) carregar(); });
 // Carrega na primeira vez que a aba Fluxo de pacientes é aberta.
 document.querySelector('[data-view="flow"]')?.addEventListener('click', () => { if (!carregado) { carregado = true; carregar(); } });
}
