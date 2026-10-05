// Painel › "Quem está atendendo agora": a equipe real do plantão pela produção do Gestor Saúde
// (consultórios + evoluções no Box), cruzada com a escala: quem está presente, parado, fora da escala
// e quem está escalado mas ainda não atendeu ninguém.
import {plantaoAtual, mesmoMedico} from './production.js';
import {segments} from './scheduling.js';
import {escaladosComArea} from './atencao.js';

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const nome = d => String(d || '').split('\n')[0].trim();
const tempo = min => min < 1 ? 'agora' : min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
export const COLUNAS = [['adulto', 'Clínicos', 4], ['pediatria', 'Pediatras', 2], ['box', 'Box de emergência', 1], ['cinderela', 'Cinderelas', 2]];

// Coluna do médico: cinderela (diurno, começou depois das 11h) ou a área em que mais atendeu.
export const colunaDe = m => m.cinderela && m.area !== 'box' ? 'cinderela' : m.area;

// Escalados do plantão (consultórios + Box) que ainda não registraram atendimento no Gestor Saúde.
export function semAtendimento(escala, equipe) {
 return escala.filter(e => !equipe.some(m => mesmoMedico(m.medico, e.nome)));
}

export function mountEquipeAgora(storage, seed) {
 const overview = document.querySelector('#overview-panel');
 const antes = overview?.querySelector('[data-slot="atencao"]');
 if (!overview || !antes) return;
 const host = el('section', 'eq-agora');
 antes.before(host);
 let dados = null, carregando = false;

 function escalaDoPlantao() {
  const p = plantaoAtual();
  const lista = escaladosComArea(seed, storage, p.data, p.turno).map(m => ({nome: m.nome, area: m.area}));
  for (const slot of p.turno === 'D' ? [6] : [13]) for (const s of segments(seed, storage, p.data, slot)) if (nome(s.doctor)) lista.push({nome: nome(s.doctor), area: 'box'});
  return lista;
 }

 function cartao(m, escala) {
  const naEscala = escala.some(e => mesmoMedico(m.medico, e.nome));
  const estado = m.ativo ? 'ativo' : m.minutosParado < 180 ? 'parado' : 'saiu';
  const c = el('article', `eq-medico ${estado}`);
  const topo = el('div', 'eq-medico-topo');
  topo.append(el('span', `eq-ponto ${estado}`), el('strong', 'eq-nome', nome(m.medico)));
  c.append(topo);
  const linha = el('div', 'eq-numeros');
  if (m.area === 'box') linha.append(el('span', '', `${m.box} ${m.box === 1 ? 'evolução' : 'evoluções'}`));
  else linha.append(el('span', '', `${m.consultas} consultas`), el('span', 'muted', `${String(m.porHora).replace('.', ',')}/h`));
  c.append(linha);
  const rodape = el('small', 'muted', estado === 'ativo' ? `Último atendimento ${tempo(m.minutosParado)}` : `Sem atender ${tempo(m.minutosParado).replace('há ', 'há ')}`);
  c.append(rodape);
  if (!naEscala) topo.append(el('span', 'eq-selo', 'Fora da escala'));
  return c;
 }

 function render() {
  const p = plantaoAtual();
  host.replaceChildren();
  const cab = el('div', 'section-heading eq-cab');
  const titulo = el('div');
  titulo.append(el('p', 'eyebrow', `PLANTÃO ${p.turno === 'D' ? 'DIURNO' : 'NOTURNO'} · PELA PRODUÇÃO DO GESTOR SAÚDE`), el('h2', '', 'Quem está atendendo agora'),
   el('p', '', 'Identificado pelos atendimentos registrados neste plantão — não só pela escala. Ponto verde: atendeu na última hora.'));
  cab.append(titulo);
  const lido = el('span', 'muted eq-lido', dados?.atualizadoEm ? `lido às ${new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}` : carregando ? 'lendo…' : '');
  cab.append(lido);
  host.append(cab);
  if (!dados) { host.append(el('div', 'eq-esqueleto')); return; }
  if (!dados.disponivel && !dados.equipe?.length) { host.append(el('p', 'empty-state', `Produção indisponível agora${dados.erro ? `: ${dados.erro.replace(/\.$/, '')}` : ''}.`)); return; }
  const escala = escalaDoPlantao();
  const equipe = (dados.equipe || []).filter(m => !m.avulso && !m.restoAnterior);
  const grade = el('div', 'eq-grade');
  for (const [chave, titulo, esperado] of COLUNAS) {
   if (chave === 'cinderela' && p.turno === 'N') continue;
   const daColuna = equipe.filter(m => colunaDe(m) === chave);
   const ativos = daColuna.filter(m => m.ativo).length;
   const col = el('section', `eq-coluna ${chave}`);
   const ch = el('div', 'eq-col-cab');   // div, não <header>: o estilo global do topo do site não pode pegar aqui
   ch.append(el('h3', '', titulo), el('span', `eq-conta ${ativos >= esperado ? 'ok' : ativos ? 'medio' : 'ruim'}`, `${ativos}/${esperado} atendendo`));
   col.append(ch);
   if (!daColuna.length) col.append(el('p', 'muted eq-vazio', 'Ninguém registrou atendimento ainda.'));
   for (const m of daColuna) col.append(cartao(m, escala));
   grade.append(col);
  }
  host.append(grade);
  const horas = (Date.now() - Date.parse(p.inicio + ':00-04:00')) / 3600000;
  const faltando = horas >= 1 ? semAtendimento(escala, dados.equipe || []) : [];
  if (faltando.length) {
   const aviso = el('div', 'eq-aviso');
   aviso.append(el('strong', '', `Escalados sem nenhum atendimento: ${faltando.length}`), el('span', '', faltando.map(f => `${f.nome} (${f.area === 'box' ? 'Box' : f.area === 'pediatria' ? 'pediatria' : 'clínico'})`).join(' · ')));
   host.append(aviso);
  }
  const extras = (dados.equipe || []).filter(m => m.avulso || m.restoAnterior);
  if (extras.length) host.append(el('small', 'muted eq-nota', `Fora da conta: ${extras.map(m => `${nome(m.medico)} (${m.restoAnterior ? 'fechando o plantão anterior' : 'atendimento avulso'})`).join(' · ')}.`));
 }

 async function carregar() {
  if (carregando || document.hidden) return;
  carregando = true; render();
  try {
   const r = await fetch('/api/equipe', {cache: 'no-store'});
   const d = await r.json().catch(() => ({}));
   dados = r.ok ? d : {disponivel: false, erro: d.error || 'O servidor não respondeu.', equipe: dados?.equipe || []};
  } catch (e) { dados = {disponivel: false, erro: e.message, equipe: dados?.equipe || []}; }
  finally { carregando = false; render(); }
 }
 for (const ev of ['rt-schedule-changed', 'rt-data-restored']) document.addEventListener(ev, render);
 document.querySelector('[data-view="overview"]')?.addEventListener('click', carregar);
 render(); carregar();
 setInterval(() => { if (!overview.hidden) carregar(); }, 120000);
}
