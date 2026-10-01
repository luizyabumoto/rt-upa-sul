// Painel: cabeçalho do plantão (saudação, data e quanto falta para acabar) e o quadro "Médicos do plantão",
// com quem merece atenção pela produção dos últimos dias (regras em atencao.js).
import {plantaoAtual} from './production.js';
import {slots} from './scheduling.js';
import {lerProducao} from './resumo.js';
import {escaladosComArea, historico, avaliarPlantao, atualizarAcompanhamento, lerAcompanhamento, registrarConversa, desfazerConversa, chaveSalva, indice, situacao, JANELA_DIAS, ENTRA} from './atencao.js';

const HORA = 3600000;
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const dataBR = d => d.slice(0, 10).split('-').reverse().slice(0, 2).join('/');
const pct = v => `${Math.round(v * 100)}%`;
const svg = (tag, attrs) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const tom = r => r < ENTRA ? 'ruim' : r < 1 ? 'medio' : 'bom';
const menosDias = (inicio, dias) => new Date(Date.parse(inicio + ':00Z') - dias * 24 * HORA).toISOString().slice(0, 16);

// ---------- Cabeçalho ----------
export function mountCabecalho() {
 const hero = document.querySelector('#overview-panel .painel-hero');
 if (!hero) return;
 const dataLonga = new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Cuiaba', weekday: 'long', day: 'numeric', month: 'long'});
 const horaCuiaba = new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Cuiaba', hour: '2-digit', minute: '2-digit'});
 function render() {
  const agora = new Date(), p = plantaoAtual(agora), h = Number(horaCuiaba.format(agora).slice(0, 2));
  const fim = Date.parse(p.inicio + ':00-04:00') + 12 * HORA, falta = Math.max(0, fim - agora.getTime());
  const faltaTxt = `${Math.floor(falta / HORA)}h${String(Math.floor(falta % HORA / 60000)).padStart(2, '0')}`;
  hero.querySelector('.painel-saudacao').textContent = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  const d = dataLonga.format(agora);
  hero.querySelector('.painel-data').textContent = d.charAt(0).toUpperCase() + d.slice(1);
  const turno = hero.querySelector('.painel-turno');
  turno.replaceChildren(el('span', `painel-turno-dot ${p.turno === 'D' ? 'dia' : 'noite'}`), el('strong', '', p.turno === 'D' ? 'Plantão diurno · 07h–19h' : 'Plantão noturno · 19h–07h'), el('span', '', ` · agora ${horaCuiaba.format(agora)} · termina em ${faltaTxt}`));
 }
 render();
 setInterval(() => { if (!document.hidden) render(); }, 30000);
}

// ---------- Gráficos pequenos ----------
// Régua do índice: 0 a 150% da média dos colegas, com a marca da média (100%) e do limite de atenção.
function regua(valor) {
 const box = el('div', 'atc-regua');
 box.setAttribute('role', 'img');
 box.setAttribute('aria-label', `Índice ${pct(valor)} da média dos colegas`);
 const fill = el('span', `atc-regua-fill ${tom(valor)}`); fill.style.width = `${Math.min(valor, 1.5) / 1.5 * 100}%`;
 const media = el('span', 'atc-regua-media'); media.style.left = `${1 / 1.5 * 100}%`; media.title = 'Média dos colegas (100%)';
 const limite = el('span', 'atc-regua-limite'); limite.style.left = `${ENTRA / 1.5 * 100}%`; limite.title = `Abaixo de ${pct(ENTRA)}: merece atenção`;
 box.append(fill, limite, media);
 return box;
}

// Barrinhas dos últimos plantões: cada uma é o plantão do médico em % da média dos colegas; a linha é a média.
function barrinhas(plantoes) {
 const ultimos = plantoes.slice(-10), L = 150, A = 34, passo = L / Math.max(ultimos.length, 5), largura = Math.max(4, passo - 3), escala = r => Math.min(r, 1.6) / 1.6 * (A - 2);
 const s = svg('svg', {viewBox: `0 0 ${L} ${A}`, width: L, height: A, class: 'atc-barras', role: 'img', 'aria-label': 'Últimos plantões em relação à média dos colegas'});
 ultimos.forEach((p, i) => {
  const h = Math.max(2, escala(p.razao));
  const r = svg('rect', {x: i * passo, y: A - h, width: largura, height: h, rx: 2, class: tom(p.razao)});
  const t = svg('title', {}); t.textContent = `${dataBR(p.data)} ${p.turno === 'D' ? 'diurno' : 'noturno'}: ${p.consultas} consultas · colegas ${Math.round(p.mediaColegas)} em média (${pct(p.razao)})`;
  r.append(t); s.append(r);
 });
 s.append(svg('line', {x1: 0, x2: L, y1: A - escala(1), y2: A - escala(1), class: 'atc-barras-media'}));
 return s;
}

// ---------- Médicos do plantão ----------
export function mountAtencao(storage, seed) {
 const host = document.querySelector('#overview-panel [data-slot="atencao"]');
 if (!host) return;
 host.className = 'atc';
 let hist = null, histRegistros = null, histDe = '', agora = null, carregando = false, erro = '';

 function cartao(a, hoje) {
  const card = el('article', `atc-card ${a.situacao}${a.abaixoHoje && a.situacao !== 'atencao' ? ' hoje-baixo' : ''}`);
  const topo = el('div', 'atc-topo');
  const selo = a.situacao === 'atencao' ? ['⚠ Merece atenção', 'ruim'] : a.situacao === 'poucos' ? ['Poucos dados', 'neutro'] : a.indice >= 1 ? ['✓ Na média', 'bom'] : ['✓ Perto da média', 'bom'];
  topo.append(el('span', `atc-selo ${selo[1]}`, selo[0]), el('span', 'atc-posto', slots[a.slot].split(' · ')[1]));
  card.append(topo, el('h3', 'atc-nome', a.nome));

  const hist15 = el('div', 'atc-bloco');
  if (a.indice !== null) {
   const linha = el('p', 'atc-linha');
   linha.append(el('strong', `atc-indice ${tom(a.indice)}`, pct(a.indice)), el('span', 'muted', 'da média dos colegas'));
   hist15.append(el('span', 'atc-rotulo', `Últimos ${JANELA_DIAS} dias`), linha, regua(a.indice));
   const graf = el('div', 'atc-graf'); graf.append(barrinhas(a.plantoes), el('small', 'muted', `${a.plantoes.length} plantões`));
   hist15.append(graf);
  } else hist15.append(el('p', 'muted', a.plantoes.length ? `Só ${a.plantoes.length} plantão comparável nos últimos ${JANELA_DIAS} dias.` : `Sem plantões comparáveis nos últimos ${JANELA_DIAS} dias.`));
  card.append(hist15);

  const agoraTxt = el('p', `atc-agora${a.abaixoHoje ? ' alerta' : ''}`);
  agoraTxt.append(el('span', 'atc-rotulo', 'Agora'), el('strong', '', `${a.consultasHoje} consultas`), el('span', 'muted', a.mediaHoje !== null ? ` · colegas ${Math.round(a.mediaHoje)} em média` : ''));
  card.append(agoraTxt);
  if (a.abaixoHoje) card.append(el('p', 'atc-aviso', 'Bem abaixo dos colegas neste plantão'));

  if (a.situacao === 'atencao' && a.desde) card.append(el('p', 'atc-meta', `Em atenção desde ${dataBR(a.desde)}. Sai quando alcançar 100%.`));
  if (a.ultimaConversa) {
   const evolucao = el('p', 'atc-meta');
   evolucao.append(document.createTextNode(`Conversa em ${dataBR(a.ultimaConversa)}`));
   if (a.indiceDepois !== null) {
    const melhorou = a.indiceAntes === null || a.indiceDepois > a.indiceAntes;
    evolucao.append(document.createTextNode(' → depois: '), el('strong', melhorou ? 'sobe' : 'desce', `${pct(a.indiceDepois)}${melhorou ? ' ↑' : ' ↓'}`), document.createTextNode(` em ${a.plantoesDepois} ${a.plantoesDepois === 1 ? 'plantão' : 'plantões'}${a.indiceAntes !== null ? ` (antes ${pct(a.indiceAntes)})` : ''}`));
   } else evolucao.append(document.createTextNode(' · aguardando os próximos plantões'));
   card.append(evolucao);
  }
  if (a.situacao === 'atencao' || a.abaixoHoje || a.ultimaConversa) {
   const acoes = el('div', 'atc-acoes');
   if (a.ultimaConversa === hoje) {
    const b = el('button', 'secondary', 'Desfazer'); b.type = 'button';
    b.onclick = () => { desfazerConversa(storage, a.doctor || a.nome, hoje); render(); };
    acoes.append(el('span', 'atc-feito', '✓ Conversado hoje'), b);
   } else {
    const b = el('button', a.situacao === 'atencao' ? '' : 'secondary', 'Conversei hoje'); b.type = 'button';
    b.title = 'Registra a conversa. Daqui para frente o painel mostra se ele melhorou.';
    b.onclick = () => { registrarConversa(storage, a.doctor || a.nome, hoje); render(); };
    acoes.append(b);
   }
   card.append(acoes);
  }
  return card;
 }

 function todos(acomp) {
  const det = el('details', 'atc-todos');
  const lista = (hist || []).map(h => {
   const v = indice(h.plantoes), salvo = acomp[chaveSalva(acomp, h.medico)];
   return {medico: h.medico, plantoes: h.plantoes.length, indice: v, situacao: situacao(v, salvo?.emAtencao ? 'atencao' : undefined)};
  }).filter(m => m.indice !== null).sort((a, b) => a.indice - b.indice);
  const n = lista.filter(m => m.situacao === 'atencao').length;
  det.append(el('summary', '', `Todos os médicos · últimos ${JANELA_DIAS} dias${n ? ` · ${n} em atenção` : ''}`));
  if (!lista.length) { det.append(el('p', 'muted', 'Sem dados de produção suficientes.')); return det; }
  const tabela = el('table', 'prod-table atc-tabela'), cab = el('tr');
  for (const [t, c] of [['Médico'], ['Plantões', 'num'], ['% da média dos colegas', 'num'], ['Situação']]) cab.append(el('th', c || '', t));
  const thead = el('thead'); thead.append(cab); tabela.append(thead);
  const corpo = el('tbody');
  for (const m of lista) {
   const tr = el('tr', m.situacao === 'atencao' ? 'atc-linha-ruim' : '');
   const barra = el('td', 'num'); barra.append(el('strong', `atc-indice ${tom(m.indice)}`, pct(m.indice)));
   tr.append(el('td', 'strong', m.medico), el('td', 'num', String(m.plantoes)), barra, el('td', m.situacao === 'atencao' ? 'alerta strong' : 'muted', m.situacao === 'atencao' ? '⚠ Merece atenção' : 'Na média'));
   corpo.append(tr);
  }
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  det.append(wrap);
  return det;
 }

 function render() {
  const p = plantaoAtual(), hoje = new Date(Date.now() - 4 * HORA).toISOString().slice(0, 10);
  const escala = escaladosComArea(seed, storage, p.data, p.turno);
  host.replaceChildren();
  const cab = el('div', 'section-heading atc-cab');
  const titulo = el('div');
  titulo.append(el('p', 'eyebrow', `PLANTÃO ${p.turno === 'D' ? 'DIURNO' : 'NOTURNO'} · ${dataBR(p.data)} · CONSULTÓRIOS`), el('h2', '', 'Médicos do plantão'), el('p', '', `Cada médico comparado com a média dos colegas da mesma área (adulto ou pediatria) nos mesmos plantões, nos últimos ${JANELA_DIAS} dias.`));
  cab.append(titulo);
  host.append(cab);
  if (!escala.length) { host.append(el('p', 'empty-state', 'Nenhum médico nos consultórios da escala deste plantão.')); return; }
  if (!hist) { host.append(el('p', 'empty-state', erro ? `Produção indisponível agora: ${erro}` : 'Lendo a produção dos últimos dias…')); return; }
  // Guarda quem entrou ou saiu da atenção (todos os médicos com dados, não só os de hoje).
  const avaliacoesTodos = hist.map(h => {
   const salvos = lerAcompanhamento(storage), salvo = salvos[chaveSalva(salvos, h.medico)];
   return {nome: h.medico, situacao: situacao(indice(h.plantoes), salvo?.emAtencao ? 'atencao' : undefined)};
  });
  const acomp = atualizarAcompanhamento(storage, avaliacoesTodos, hoje);
  const horas = (Date.now() - Date.parse(p.inicio + ':00-04:00')) / HORA;
  const avaliados = avaliarPlantao({escala, hist, agora: agora || [], acompanhamento: acomp, emAndamentoHoras: horas});
  const atencao = avaliados.filter(a => a.situacao === 'atencao').length, baixoHoje = avaliados.filter(a => a.abaixoHoje && a.situacao !== 'atencao').length;
  const resumo = el('div', `atc-resumo ${atencao ? 'ruim' : baixoHoje ? 'medio' : 'bom'}`);
  resumo.textContent = atencao ? `⚠ ${atencao} ${atencao === 1 ? 'médico merece' : 'médicos merecem'} atenção` : baixoHoje ? `${baixoHoje} abaixo dos colegas agora` : '✓ Todos na média';
  cab.append(resumo);
  const grade = el('div', 'atc-grade');
  for (const a of avaliados) grade.append(cartao(a, hoje));
  host.append(grade, todos(acomp),
   el('small', 'muted atc-nota', `Merece atenção: abaixo de ${pct(ENTRA)} da média dos colegas. Depois de cobrado, só sai quando alcançar a média (100%). Box, cinderelas e extras ficam fora da conta; coberturas parciais contam pelas horas. Plantão com sala vermelha ou procedimentos pode ter menos consultas — use como ponto de conversa.`));
 }

 async function carregar() {
  if (carregando || document.hidden) return;
  carregando = true;
  const p = plantaoAtual();
  try {
   // Histórico e plantão atual pedidos ao mesmo tempo (antes um esperava o outro).
   const pedidoHist = histDe !== p.inicio ? lerProducao(menosDias(p.inicio, JANELA_DIAS), p.inicio) : null;
   const pedidoAtual = lerProducao(p.inicio, 'agora');
   if (pedidoHist) {
    const d = await pedidoHist;
    if (d.disponivel || d.registros?.length) { histRegistros = d.registros || []; recalcular(); histDe = p.inicio; erro = ''; }
    else erro = d.erro || 'falha na leitura';
   }
   const atual = await pedidoAtual;
   agora = (atual.registros || []).filter(r => r.data === p.data && r.turno === p.turno);
  } catch (e) { erro = e.message; }
  finally { carregando = false; render(); }
 }

 // A produção não muda quando a escala é editada: só refaz a conta com a escala nova, sem reler 30 dias do Gestor Saúde.
 function recalcular() { if (histRegistros) hist = historico(histRegistros, (data, turno) => escaladosComArea(seed, storage, data, turno)); }
 for (const evento of ['rt-schedule-changed', 'rt-data-restored']) document.addEventListener(evento, () => { recalcular(); render(); });
 document.querySelector('[data-view="overview"]')?.addEventListener('click', carregar);
 document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
 render();
 carregar();
 setInterval(() => { if (!document.querySelector('#overview-panel').hidden) carregar(); }, 180000);
}
