// Trocas detectadas pela produção: quem está na escala sem nenhuma consulta e quem está atendendo sem estar
// na escala, no mesmo plantão e na mesma área. Quando não há dúvida (um sai, um entra), a escala do dia é
// ajustada sozinha e o Painel avisa, com "Manter" e "Desfazer". Com dúvida, só avisa.
import {parse, periodKey, baseDoctor, segments, doctorChoices, affiliation, MISSING_CRM} from './scheduling.js';
import {plantaoAtual, mesmoMedico} from './production.js';
import {registrarTroca} from './historico.js';

export const MINIMO_CONSULTAS = 5;          // troca automática: quem entrou atendeu pelo menos isso no plantão
export const MINIMO_SUGESTAO = 3;           // abaixo disso nem sugere (pode ser só uma ajuda pontual)
export const HORAS_ANTES_DE_TROCAR = 2;     // no plantão em andamento, esperar o plantão "engrenar"
const AREAS = {D: {adulto: [0, 1, 2, 3], pediatria: [4, 5]}, N: {adulto: [7, 8, 9, 10], pediatria: [11, 12]}};
// Box e Cinderelas também atendem nos consultórios: quem está neles não é "de fora".
const OUTROS_POSTOS = {D: [6, 14, 15], N: [13, 15]};
const HORA = 3600000;
const nomeDe = doctor => String(doctor || '').split('\n')[0].trim();
const idTroca = (plantao, t) => `${plantao.data}${plantao.turno}|${t.slot}|${nomeDe(t.saiu)}|${t.entrou}`;

// postos: [{slot, area, doctor}] do plantão (doctor vazio = posto vago); registros: produção do plantão
// [{medico, adulto, pediatria}]; outros: médicos do plantão fora dos consultórios (Box, Cinderela, coberturas).
// Quem atende de fora ocupa primeiro os postos vagos e depois os de quem está na escala sem nenhuma consulta.
// Sem dúvida (mesmo número de postos e de médicos de fora, todos com MINIMO_CONSULTAS) vira troca automática;
// senão vira sugestão, com os pares propostos para o RT aplicar com um clique.
export function detectar(postos, registros, outros = []) {
 const automaticas = [], suspeitas = [];
 const conhecido = nome => postos.some(p => p.doctor && mesmoMedico(nome, nomeDe(p.doctor))) || outros.some(o => mesmoMedico(nome, nomeDe(o)));
 for (const area of ['adulto', 'pediatria']) {
  const outra = area === 'adulto' ? 'pediatria' : 'adulto';
  const daArea = postos.filter(p => p.area === area);
  const semConsulta = daArea.filter(p => p.doctor && !registros.some(r => mesmoMedico(r.medico, nomeDe(p.doctor)) && r.adulto + r.pediatria > 0));
  const vagas = daArea.filter(p => !p.doctor);
  const deFora = registros.filter(r => r[area] >= MINIMO_SUGESTAO && r[area] >= r[outra] && !conhecido(r.medico)).sort((a, b) => b[area] - a[area]);
  const abertos = [...vagas, ...semConsulta];
  if (!abertos.length || !deFora.length) continue;
  const pares = deFora.slice(0, abertos.length).map((r, i) => ({area, slot: abertos[i].slot, saiu: abertos[i].doctor, entrou: r.medico, consultas: r[area]}));
  if (deFora.length === abertos.length && deFora.every(r => r[area] >= MINIMO_CONSULTAS)) automaticas.push(...pares);
  else suspeitas.push({area, semConsulta: semConsulta.map(p => nomeDe(p.doctor)), vagas: vagas.length, deFora: deFora.map(r => ({medico: r.medico, consultas: r[area]})), pares});
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

// Médicos do plantão que não entram como posto de consultório: Box, Cinderelas e quem está em cobertura.
export function outrosDoPlantao(seed, storage, data, turno) {
 const nomes = [];
 for (const slot of OUTROS_POSTOS[turno]) for (const s of segments(seed, storage, data, slot)) if (s.doctor) nomes.push(s.doctor);
 for (const slot of Object.values(AREAS[turno]).flat()) {
  const partes = segments(seed, storage, data, slot);
  if (partes.some(s => s.coverage)) for (const s of partes) if (s.doctor) nomes.push(s.doctor);
 }
 return nomes;
}

function gravarPosto(storage, data, slot, doctor) {
 const chave = periodKey(data), edits = parse(storage, chave, {});
 edits[`${data}|${slot}`] = doctor;
 storage.setItem('rt-upa:' + chave, JSON.stringify(edits));
}

// Coloca quem entrou no posto (cadastrando se preciso) e guarda no histórico de trocas.
function aplicarPar(storage, cadastro, historico, plantao, t, agora) {
 let novo = cadastro.find(d => mesmoMedico(d, t.entrou));
 if (!novo) {
  // Fora do cadastro: entra com o nome do Gestor Saúde, o vínculo de quem saiu e CRM a confirmar.
  novo = `${t.entrou}\nCRM ${MISSING_CRM} - ${affiliation(t.saiu) || 'SMS'}`;
  storage.setItem('rt-upa:doctors', JSON.stringify([...parse(storage, 'doctors', []), novo]));
  cadastro.push(novo);
 }
 registrarTroca(storage, {data: plantao.data, slot: t.slot, saiu: t.saiu, entrou: novo, origem: 'produção'}, agora);
 gravarPosto(storage, plantao.data, t.slot, novo);
 historico.push({id: idTroca(plantao, t), data: plantao.data, turno: plantao.turno, slot: t.slot, saiu: t.saiu || '', entrou: novo, consultas: t.consultas, status: 'aplicada', criadoEm: agora.toISOString()});
}

// Trocas e sugestões do plantão, sem as que o RT já aplicou, manteve, desfez ou ignorou.
export function trocasDoPlantao(seed, storage, plantao, registros) {
 const vistas = new Set(parse(storage, 'trocas', []).map(h => h.id));
 const novo = t => !vistas.has(idTroca(plantao, t));
 const r = detectar(postosDoPlantao(seed, storage, plantao.data, plantao.turno), registros, outrosDoPlantao(seed, storage, plantao.data, plantao.turno));
 return {automaticas: r.automaticas.filter(novo), suspeitas: r.suspeitas.map(s => ({...s, pares: s.pares.filter(novo)})).filter(s => s.pares.length)};
}

// Aplica as trocas sem dúvida ainda não vistas; devolve as sugestões para o alerta.
export function aplicarTrocas(seed, storage, plantao, registros, agora = new Date()) {
 const {automaticas, suspeitas} = trocasDoPlantao(seed, storage, plantao, registros);
 if (automaticas.length) {
  const historico = parse(storage, 'trocas', []), cadastro = doctorChoices(seed, storage);
  for (const t of automaticas) aplicarPar(storage, cadastro, historico, plantao, t, agora);
  storage.setItem('rt-upa:trocas', JSON.stringify(historico.slice(-500)));
 }
 return {mudou: automaticas.length > 0, suspeitas};
}

// O RT confirmou uma sugestão: aplica os pares na escala do dia (com "Desfazer" no Painel, como as automáticas).
export function aplicarSugestao(seed, storage, plantao, pares, agora = new Date()) {
 const historico = parse(storage, 'trocas', []), cadastro = doctorChoices(seed, storage);
 const novos = pares.filter(t => !historico.some(h => h.id === idTroca(plantao, t)));
 for (const t of novos) aplicarPar(storage, cadastro, historico, plantao, t, agora);
 if (novos.length) storage.setItem('rt-upa:trocas', JSON.stringify(historico.slice(-500)));
 return novos.length;
}

// O RT descartou a sugestão: não volta a aparecer para esse plantão.
export function ignorarSugestao(storage, plantao, pares, agora = new Date()) {
 const historico = parse(storage, 'trocas', []);
 for (const t of pares) if (!historico.some(h => h.id === idTroca(plantao, t))) historico.push({id: idTroca(plantao, t), data: plantao.data, turno: plantao.turno, slot: t.slot, saiu: t.saiu || '', entrou: t.entrou, consultas: t.consultas, status: 'ignorada', criadoEm: agora.toISOString()});
 storage.setItem('rt-upa:trocas', JSON.stringify(historico.slice(-500)));
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
const descreverPar = t => `${POSTOS[t.slot]}: ${t.saiu ? `sai ${nomeDe(t.saiu)}` : 'posto vago'} → entra ${nomeDe(t.entrou)} (${t.consultas} consultas)`;

// Cartão de uma sugestão com "Aplicar na escala" e "Ignorar". Usado no Painel e na Produção médica.
export function cartaoSugestao(seed, storage, plantao, s, depois = () => {}) {
 const linha = el('div', 'troca suspeita'), texto = el('p');
 const partes = [];
 if (s.semConsulta.length) partes.push(`na escala sem consultas: ${s.semConsulta.join(', ')}`);
 if (s.vagas) partes.push(`${s.vagas} ${s.vagas === 1 ? 'posto vago' : 'postos vagos'}`);
 partes.push(`atendendo fora da escala: ${s.deFora.map(d => `${d.medico} (${d.consultas})`).join(', ')}`);
 texto.append(el('strong', '', `Possível troca · ${rotuloPlantao(plantao.data, plantao.turno)} · ${s.area === 'adulto' ? 'adulto' : 'pediatria'}: `), document.createTextNode(partes.join('; ') + '.'));
 const lista = el('ul', 'troca-pares');
 for (const t of s.pares) lista.append(el('li', '', descreverPar(t)));
 const acoes = el('div', 'actions'), aplicar = el('button', '', 'Aplicar na escala'), ignorar = el('button', 'secondary', 'Ignorar');
 aplicar.type = ignorar.type = 'button';
 aplicar.onclick = () => { aplicarSugestao(seed, storage, plantao, s.pares); document.dispatchEvent(new Event('rt-schedule-changed')); depois(); };
 ignorar.onclick = () => { ignorarSugestao(storage, plantao, s.pares); document.dispatchEvent(new Event('rt-trocas-changed')); depois(); };
 acoes.append(aplicar, ignorar);
 linha.append(texto, el('small', 'muted', 'Sugestão para a escala do dia:'), lista, acoes);
 return linha;
}

export function mountTrocas(storage, seed) {
 const overview = document.querySelector('#overview-panel');
 if (!overview) return;
 const box = el('section', 'trocas-alerta'); box.hidden = true;
 const resumoFluxo = overview.querySelector('.flow-summary');
 if (resumoFluxo) resumoFluxo.after(box); else overview.prepend(box);
 let suspeitas = [];

 function render() {
  const aplicadas = parse(storage, 'trocas', []).filter(t => t.status === 'aplicada');
  // Some a sugestão já aplicada ou ignorada (aqui ou na Produção médica) sem esperar a próxima leitura.
  const vistas = new Set(parse(storage, 'trocas', []).map(h => h.id));
  suspeitas = suspeitas.map(s => ({...s, pares: s.pares.filter(t => !vistas.has(idTroca(s.plantao, t)))})).filter(s => s.pares.length);
  box.replaceChildren();
  box.hidden = !aplicadas.length && !suspeitas.length;
  if (box.hidden) return;
  box.append(el('h3', '', 'Trocas detectadas pela produção'));
  for (const t of aplicadas) {
   const linha = el('div', 'troca');
   const texto = el('p');
   const mudanca = t.saiu ? `saiu ${nomeDe(t.saiu)}, entrou ${nomeDe(t.entrou)}` : `posto vago preenchido por ${nomeDe(t.entrou)}`;
   texto.append(el('strong', '', `${rotuloPlantao(t.data, t.turno)} · ${POSTOS[t.slot]}: `), document.createTextNode(`${mudanca} (${t.consultas} consultas). A escala do dia já foi ajustada.${t.entrou.includes(MISSING_CRM) ? ' Médico novo no cadastro: complete o CRM em Médicos e fixos.' : ''}`));
   const acoes = el('div', 'actions'), ok = el('button', '', 'Manter'), volta = el('button', 'secondary', 'Desfazer');
   ok.type = volta.type = 'button';
   ok.onclick = () => { manter(storage, t.id); render(); };
   volta.onclick = () => { desfazer(storage, t.id); render(); document.dispatchEvent(new Event('rt-schedule-changed')); };
   acoes.append(ok, volta); linha.append(texto, acoes); box.append(linha);
  }
  for (const s of suspeitas) box.append(cartaoSugestao(seed, storage, s.plantao, s, render));
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
    novas.push(...resultado.suspeitas.map(s => ({...s, plantao: {data: plantao.data, turno: plantao.turno}})));
   } catch { /* sem conexão com o Gestor Saúde agora: tenta na próxima */ }
  }
  suspeitas = novas;
  render();
  if (mudou) document.dispatchEvent(new Event('rt-schedule-changed'));
 }

 for (const evento of ['rt-data-restored', 'rt-schedule-changed', 'rt-trocas-changed']) document.addEventListener(evento, render);
 render();
 verificar();
 setInterval(verificar, 5 * 60000);
}
