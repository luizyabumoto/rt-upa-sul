// Análise de demanda: consultas médicas (adulto + pediatria) por dia, dia da semana, hora e mês.
// Fonte: /api/demanda (contagens por hora, sem dados de pacientes). Períodos longos são lidos em janelas
// de até 31 dias; janelas já encerradas ficam guardadas neste navegador para não serem pedidas de novo.
import {segments} from './scheduling.js';
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const COR = '#2b9e8a', PICO = '#c98233';       // validadas contra o fundo escuro (dataviz: todas as checagens passam)
const HORA_MS = 3600000;
const PERIODOS = [['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias'], ['ano', 'Este ano'], ['12m', 'Últimos 12 meses'], ['anoPassado', 'Ano passado'], ['livre', 'Escolher datas…']];

const cuiaba = date => new Date(date.getTime() - 4 * HORA_MS);
const texto = d => d.toISOString().slice(0, 16);
const dataBR = iso => iso.slice(0, 10).split('-').reverse().join('/');
const numero = (n, casas = 0) => n.toLocaleString('pt-BR', {minimumFractionDigits: casas, maximumFractionDigits: casas});

export function periodoDemanda(chave, agora = new Date()) {
 const local = cuiaba(agora), hoje = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
 const menosDias = d => new Date(hoje.getTime() - d * 24 * HORA_MS);
 const ano = local.getUTCFullYear();
 switch (chave) {
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

// Recebe {"AAAA-MM-DDTHH": {adulto, pediatria}} e o período; devolve as séries da análise.
export function analisar(horas, inicio, fim) {
 const dias = new Map();
 for (let d = new Date(inicio.slice(0, 10) + 'T00:00:00Z'), ultimo = new Date(fim.slice(0, 10) + 'T00:00:00Z'); d <= ultimo; d = new Date(d.getTime() + 24 * HORA_MS))
  dias.set(d.toISOString().slice(0, 10), {data: d.toISOString().slice(0, 10), total: 0, adulto: 0, pediatria: 0});
 const porHora = Array.from({length: 24}, () => 0);
 for (const [chave, c] of Object.entries(horas)) {
  const dia = dias.get(chave.slice(0, 10));
  if (!dia) continue;
  dia.adulto += c.adulto; dia.pediatria += c.pediatria; dia.total += c.adulto + c.pediatria;
  porHora[Number(chave.slice(11, 13))] += c.adulto + c.pediatria;
 }
 const listaDias = [...dias.values()], total = listaDias.reduce((s, d) => s + d.total, 0), n = listaDias.length || 1;
 const semana = DIAS_SEMANA.map((nome, i) => { const ds = listaDias.filter(d => new Date(d.data + 'T12:00:00Z').getUTCDay() === i); return {nome, dias: ds.length, total: ds.reduce((s, d) => s + d.total, 0), media: ds.length ? ds.reduce((s, d) => s + d.total, 0) / ds.length : 0}; });
 const meses = new Map();
 for (const d of listaDias) { const k = d.data.slice(0, 7); const m = meses.get(k) || {mes: k, total: 0, dias: 0}; m.total += d.total; m.dias += 1; meses.set(k, m); }
 const listaMeses = [...meses.values()].map(m => ({...m, media: m.total / m.dias}));
 const recorde = listaDias.reduce((a, b) => (b.total > a.total ? b : a), listaDias[0] || {data: inicio.slice(0, 10), total: 0});
 return {
  total, mediaDia: total / n, dias: listaDias, recorde, semana, meses: listaMeses,
  hora: porHora.map((t, h) => ({hora: h, media: t / n})),
  top: [...listaDias].sort((a, b) => b.total - a.total || a.data.localeCompare(b.data)).slice(0, 10),
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
  '<div class="prod-controls"><label>Período<select class="demand-period"></select></label><label class="demand-free" hidden>Início<input type="date" class="demand-start"></label><label class="demand-free" hidden>Fim<input type="date" class="demand-end"></label></div>' +
  '<div class="flow-kpis demand-kpis"></div><div class="demand-charts"></div>' +
  '<p class="notice">Consultas nos Consultórios Adulto e Pediátrico pelo horário do atendimento (retornos não entram). Médias por dia da semana e por hora consideram todos os dias do período, inclusive os com zero. Meses já encerrados ficam guardados neste navegador.</p>';
 flow.append(secao);
 const $ = s => secao.querySelector(s);
 for (const [v, t] of PERIODOS) $('.demand-period').add(new Option(t, v));
 let pedido = 0, carregado = false;

 const guardado = janela => { try { return JSON.parse(localStorage.getItem('rt-demanda:' + janela.inicio + '|' + janela.fim)); } catch { return null; } };
 const guardar = (janela, horas) => { try { localStorage.setItem('rt-demanda:' + janela.inicio + '|' + janela.fim, JSON.stringify(horas)); } catch { /* sem espaço: só não guarda */ } };

 function escolha() {
  const chave = $('.demand-period').value;
  if (chave !== 'livre') return periodoDemanda(chave);
  const [a, b] = [$('.demand-start').value, $('.demand-end').value];
  return a && b ? {inicio: `${a}T00:00`, fim: `${b}T23:59`} : null;
 }

 function render(a, inicio, fimTexto, horas = {}) {
  const kpi = (rotulo, valor, detalhe) => { const b = el('div', 'flow-kpi'); b.append(el('span', 'flow-kpi-label', rotulo), el('strong', 'flow-kpi-value', valor), el('small', '', detalhe)); return b; };
  const semanaTop = a.semana.reduce((x, y) => (y.media > x.media ? y : x)), horaTop = a.hora.reduce((x, y) => (y.media > x.media ? y : x));
  $('.demand-kpis').replaceChildren(
   kpi('CONSULTAS NO PERÍODO', numero(a.total), `${dataBR(inicio)} a ${fimTexto}`),
   kpi('MÉDIA POR DIA', numero(a.mediaDia, 1), `${a.dias.length} dias`),
   kpi('DIA RECORDE', numero(a.recorde.total), `${dataBR(a.recorde.data)} · ${DIAS_SEMANA[new Date(a.recorde.data + 'T12:00:00Z').getUTCDay()].toLowerCase()}`),
   kpi('DIA DA SEMANA MAIS CHEIO', semanaTop.nome, `média de ${numero(semanaTop.media, 1)} consultas`),
   kpi('HORÁRIO DE PICO', `${String(horaTop.hora).padStart(2, '0')}h`, `média de ${numero(horaTop.media, 1)} consultas nessa hora`));
  const graficos = [
   colunas({titulo: 'Média de consultas por dia da semana', subtitulo: 'Qual dia costuma ser mais pesado', itens: a.semana, rotulo: s => s.nome.slice(0, 3), valor: s => s.media, dica: s => `${s.nome} · ${s.dias} dias no período: ${numero(s.media, 1)} consultas em média`}),
   colunas({titulo: 'Média de consultas por hora do dia', subtitulo: 'Horários de maior procura (média de todos os dias)', itens: a.hora, rotulo: h => `${h.hora}h`, valor: h => h.media, rotuloEixo: (_, i) => i % 3 === 0, dica: h => `${String(h.hora).padStart(2, '0')}h–${String((h.hora + 1) % 24).padStart(2, '0')}h: ${numero(h.media, 1)} consultas em média`}),
  ];
  if (a.meses.length >= 2) graficos.push(colunas({titulo: 'Média de consultas por dia, mês a mês', subtitulo: 'Meses mais movimentados do período', itens: a.meses, rotulo: m => `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(2, 4)}`, valor: m => m.media, dica: m => `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(0, 4)} · ${numero(m.total)} consultas em ${m.dias} dias: ${numero(m.media, 1)} por dia`}));
  if (storage && seed) {
   const escala = medicosPorHora(a.dias.map(d => d.data), (data, slot) => segments(seed, storage, data, slot));
   if (escala.dias.length) graficos.push(colunas({titulo: 'Consultas por médico escalado, por hora', subtitulo: `Onde a escala fica mais apertada · ${escala.dias.length} dias com escala cadastrada`, itens: pressaoPorHora(horas, escala), rotulo: h => `${h.hora}h`, valor: h => h.porMedico, rotuloEixo: (_, i) => i % 3 === 0,
    dica: h => `${String(h.hora).padStart(2, '0')}h · ${numero(h.consultas, 1)} consultas e ${numero(h.medicos, 1)} médicos em média: ${numero(h.porMedico, 1)} por médico`}));
  }
  graficos.push(colunas({titulo: 'Consultas por dia', subtitulo: 'Cada barra é um dia (00h às 24h)', itens: a.dias, rotulo: d => dataBR(d.data).slice(0, 5), valor: d => d.total, formato: v => numero(v), rotuloEixo: (_, i) => i % Math.max(1, Math.ceil(a.dias.length / 10)) === 0,
   dica: d => `${dataBR(d.data)} · ${DIAS_SEMANA[new Date(d.data + 'T12:00:00Z').getUTCDay()]}: ${numero(d.total)} consultas (adulto ${d.adulto} · pediatria ${d.pediatria})`}));
  const top = el('section', 'prod-section'), tabela = el('table', 'prod-table');
  tabela.innerHTML = '<thead><tr><th>#</th><th>Dia</th><th>Dia da semana</th><th class="num">Consultas</th><th class="num">Adulto</th><th class="num">Pediatria</th></tr></thead>';
  const corpo = el('tbody');
  a.top.forEach((d, i) => { const tr = el('tr'); tr.append(el('td', 'pos', String(i + 1)), el('td', '', dataBR(d.data)), el('td', '', DIAS_SEMANA[new Date(d.data + 'T12:00:00Z').getUTCDay()]), el('td', 'num strong', numero(d.total)), el('td', 'num', numero(d.adulto)), el('td', 'num', numero(d.pediatria))); corpo.append(tr); });
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  top.append(el('h3', '', 'Dias mais movimentados'), wrap);
  $('.demand-charts').replaceChildren(...graficos, top);
 }

 async function carregar() {
  const periodo = escolha();
  if (!periodo) { $('.demand-status').textContent = 'Escolha início e fim.'; return; }
  const meu = ++pedido, lista = janelas(periodo.inicio, periodo.fim), horas = {};
  let falhas = 0;
  for (let i = 0; i < lista.length; i++) {
   if (meu !== pedido) return;
   $('.demand-status').textContent = `Lendo o Gestor Saúde… ${i + 1} de ${lista.length}`;
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
  if (meu !== pedido) return;
  const fimReal = periodo.fim === 'agora' ? texto(cuiaba(new Date())) : periodo.fim;
  render(analisar(horas, periodo.inicio, fimReal), periodo.inicio, periodo.fim === 'agora' ? 'hoje' : dataBR(periodo.fim), horas);
  $('.demand-status').textContent = falhas ? `Atenção: ${falhas} de ${lista.length} partes do período não puderam ser lidas agora.` : `Atualizado às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
 }

 $('.demand-period').onchange = () => { secao.querySelectorAll('.demand-free').forEach(l => { l.hidden = $('.demand-period').value !== 'livre'; }); if ($('.demand-period').value !== 'livre') carregar(); };
 $('.demand-start').onchange = $('.demand-end').onchange = carregar;
 // Carrega na primeira vez que a aba Fluxo de pacientes é aberta.
 document.querySelector('[data-view="flow"]')?.addEventListener('click', () => { if (!carregado) { carregado = true; carregar(); } });
}
