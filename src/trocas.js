// Trocas detectadas pela produção: quem está na escala sem nenhuma consulta e quem está atendendo sem estar
// na escala, no mesmo plantão e na mesma área. Quando não há dúvida (um sai, um entra), a escala do dia é
// ajustada sozinha e o Painel avisa, com "Manter" e "Desfazer". Com dúvida, só avisa.
import {parse, periodKey, baseDoctor, segments, doctorChoices, affiliation, MISSING_CRM} from './scheduling.js';
import {plantaoAtual, mesmoMedico} from './production.js';
import {registrarTroca} from './historico.js';

export const MINIMO_CONSULTAS = 5;          // quem entrou precisa ter atendido pelo menos isso no plantão
export const HORAS_ANTES_DE_TROCAR = 2;     // no plantão em andamento, esperar o plantão "engrenar"
const AREAS = {D: {adulto: [0, 1, 2, 3], pediatria: [4, 5]}, N: {adulto: [7, 8, 9, 10], pediatria: [11, 12]}};
const HORA = 3600000;
const nomeDe = doctor => String(doctor || '').split('\n')[0].trim();

// postos: [{slot, area, doctor}] do plantão; registros: produção do plantão [{medico, adulto, pediatria}].
export function detectar(postos, registros) {
 const automaticas = [], suspeitas = [];
 for (const area of ['adulto', 'pediatria']) {
  const daArea = postos.filter(p => p.area === area && p.doctor);
  const consultasDe = nome => registros.filter(r => mesmoMedico(r.medico, nome)).reduce((s, r) => s + r[area], 0);
  const semConsulta = daArea.filter(p => !registros.some(r => mesmoMedico(r.medico, nomeDe(p.doctor)) && r.adulto + r.pediatria > 0));
  const deFora = registros.filter(r => r[area] >= MINIMO_CONSULTAS && !postos.some(p => p.doctor && mesmoMedico(r.medico, nomeDe(p.doctor))));
  if (!semConsulta.length || !deFora.length) continue;
  if (semConsulta.length === 1 && deFora.length === 1) automaticas.push({area, slot: semConsulta[0].slot, saiu: semConsulta[0].doctor, entrou: deFora[0].medico, consultas: consultasDe(deFora[0].medico)});
  else suspeitas.push({area, semConsulta: semConsulta.map(p => nomeDe(p.doctor)), deFora: deFora.map(r => ({medico: r.medico, consultas: r[area]}))});
 }
 return {automaticas, suspeitas};
}

export function postosDoPlantao(seed, storage, data, turno) {
 const lista = [];
 for (const [area, slots] of Object.entries(AREAS[turno])) for (const slot of slots) {
  // Posto com cobertura confirmada já foi tratado pela pendência: não mexer.
  if (segments(seed, storage, data, slot).some(s => s.coverage)) continue;
  lista.push({slot, area, doctor: baseDoctor(seed, storage, data, slot)});
 }
 return lista;
}

function gravarPosto(storage, data, slot, doctor) {
 const chave = periodKey(data), edits = parse(storage, chave, {});
 edits[`${data}|${slot}`] = doctor;
 storage.setItem('rt-upa:' + chave, JSON.stringify(edits));
}

// Aplica as trocas sem dúvida ainda não vistas; devolve as suspeitas para o alerta.
export function aplicarTrocas(seed, storage, plantao, registros, agora = new Date()) {
 const historico = parse(storage, 'trocas', []);
 const {automaticas, suspeitas} = detectar(postosDoPlantao(seed, storage, plantao.data, plantao.turno), registros);
 const cadastro = doctorChoices(seed, storage);
 const pendentes = [];
 let mudou = false;
 for (const t of automaticas) {
  const id = `${plantao.data}${plantao.turno}|${t.slot}|${nomeDe(t.saiu)}|${t.entrou}`;
  if (historico.some(h => h.id === id)) continue;                         // já aplicada, mantida ou desfeita
  let novo = cadastro.find(d => mesmoMedico(d, t.entrou));
  if (!novo) {
   // Fora do cadastro: entra com o nome do Gestor Saúde, o vínculo de quem saiu e CRM a confirmar.
   novo = `${t.entrou}\nCRM ${MISSING_CRM} - ${affiliation(t.saiu) || 'SMS'}`;
   storage.setItem('rt-upa:doctors', JSON.stringify([...parse(storage, 'doctors', []), novo]));
  }
  registrarTroca(storage, {data: plantao.data, slot: t.slot, saiu: t.saiu, entrou: novo, origem: 'produção'}, agora);
  gravarPosto(storage, plantao.data, t.slot, novo);
  historico.push({id, data: plantao.data, turno: plantao.turno, slot: t.slot, saiu: t.saiu, entrou: novo, consultas: t.consultas, status: 'aplicada', criadoEm: agora.toISOString()});
  mudou = true;
 }
 if (mudou) storage.setItem('rt-upa:trocas', JSON.stringify(historico.slice(-500)));
 return {mudou, suspeitas: [...suspeitas, ...pendentes.map(p => ({area: p.area, semConsulta: [nomeDe(p.saiu)], deFora: [{medico: p.entrou, consultas: p.consultas}], motivo: p.motivo}))]};
}

export function desfazer(storage, id) {
 const historico = parse(storage, 'trocas', []), item = historico.find(h => h.id === id);
 if (!item || item.status === 'desfeita') return false;
 registrarTroca(storage, {data: item.data, slot: item.slot, saiu: item.entrou, entrou: item.saiu, origem: 'desfeita'});
 gravarPosto(storage, item.data, item.slot, item.saiu);
 item.status = 'desfeita';
 storage.setItem('rt-upa:trocas', JSON.stringify(historico));
 return true;
}

export function manter(storage, id) {
 const historico = parse(storage, 'trocas', []), item = historico.find(h => h.id === id);
 if (!item || item.status !== 'aplicada') return false;
 item.status = 'mantida';
 storage.setItem('rt-upa:trocas', JSON.stringify(historico));
 return true;
}

// Plantão atual (depois de 2 h) e o anterior (já encerrado).
export function plantoesParaVerificar(agora = new Date()) {
 const atual = plantaoAtual(agora), inicio = new Date(atual.inicio + ':00-04:00');
 const anterior = new Date(inicio.getTime() - 12 * HORA), local = new Date(anterior.getTime() - 4 * HORA).toISOString();
 const lista = [{data: local.slice(0, 10), turno: local.slice(11, 13) === '07' ? 'D' : 'N', inicio: local.slice(0, 16), fim: atual.inicio}];
 if (agora - inicio >= HORAS_ANTES_DE_TROCAR * HORA) lista.push({data: atual.data, turno: atual.turno, inicio: atual.inicio, fim: 'agora'});
 return lista;
}

const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const rotuloPlantao = (data, turno) => `${data.split('-').reverse().slice(0, 2).join('/')} ${turno === 'D' ? 'diurno' : 'noturno'}`;
const POSTOS = ['Clínico 1', 'Clínico 2', 'Clínico 3', 'Clínico 4', 'Pediatria 1', 'Pediatria 2', 'Box', 'Clínico 1', 'Clínico 2', 'Clínico 3', 'Clínico 4', 'Pediatria 1', 'Pediatria 2', 'Box'];

export function mountTrocas(storage, seed) {
 const overview = document.querySelector('#overview-panel');
 if (!overview) return;
 const box = el('section', 'trocas-alerta'); box.hidden = true;
 const resumoFluxo = overview.querySelector('.flow-summary');
 if (resumoFluxo) resumoFluxo.after(box); else overview.prepend(box);
 let suspeitas = [];

 function render() {
  const aplicadas = parse(storage, 'trocas', []).filter(t => t.status === 'aplicada');
  box.replaceChildren();
  box.hidden = !aplicadas.length && !suspeitas.length;
  if (box.hidden) return;
  box.append(el('h3', '', 'Trocas detectadas pela produção'));
  for (const t of aplicadas) {
   const linha = el('div', 'troca');
   const texto = el('p');
   texto.append(el('strong', '', `${rotuloPlantao(t.data, t.turno)} · ${POSTOS[t.slot]}: `), document.createTextNode(`saiu ${nomeDe(t.saiu)}, entrou ${nomeDe(t.entrou)} (${t.consultas} consultas). A escala do dia já foi ajustada.${t.entrou.includes(MISSING_CRM) ? ' Médico novo no cadastro: complete o CRM em Médicos e fixos.' : ''}`));
   const acoes = el('div', 'actions'), ok = el('button', '', 'Manter'), volta = el('button', 'secondary', 'Desfazer');
   ok.type = volta.type = 'button';
   ok.onclick = () => { manter(storage, t.id); render(); };
   volta.onclick = () => { desfazer(storage, t.id); render(); document.dispatchEvent(new Event('rt-schedule-changed')); };
   acoes.append(ok, volta); linha.append(texto, acoes); box.append(linha);
  }
  for (const s of suspeitas) {
   const p = el('p', 'troca suspeita');
   p.append(el('strong', '', `Possível troca · ${s.plantao} · ${s.area === 'adulto' ? 'adulto' : 'pediatria'}: `), document.createTextNode(`na escala sem consultas: ${s.semConsulta.join(', ')}; atendendo fora da escala: ${s.deFora.map(d => `${d.medico} (${d.consultas})`).join(', ')}.${s.motivo ? ` ${s.motivo}.` : ''} Confira e ajuste na Escala.`));
   box.append(p);
  }
 }

 async function verificar() {
  if (document.hidden) return;
  const novas = [];
  let mudou = false;
  for (const plantao of plantoesParaVerificar()) {
   try {
    const r = await fetch(`/api/producao?inicio=${encodeURIComponent(plantao.inicio)}&fim=${encodeURIComponent(plantao.fim)}`, {cache: 'no-store'});
    const dados = await r.json();
    if (!r.ok || !dados.disponivel) continue;
    const registros = dados.registros.filter(x => x.data === plantao.data && x.turno === plantao.turno);
    const resultado = aplicarTrocas(seed, storage, plantao, registros);
    mudou ||= resultado.mudou;
    novas.push(...resultado.suspeitas.map(s => ({...s, plantao: rotuloPlantao(plantao.data, plantao.turno)})));
   } catch { /* sem conexão com o Gestor Saúde agora: tenta na próxima */ }
  }
  suspeitas = novas;
  render();
  if (mudou) document.dispatchEvent(new Event('rt-schedule-changed'));
 }

 document.addEventListener('rt-data-restored', render);
 render();
 verificar();
 setInterval(verificar, 5 * 60000);
}
