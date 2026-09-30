// Médicos que merecem atenção: a produção de cada médico comparada com a dos colegas da mesma área
// (adulto ou pediatria) no mesmo plantão. Comparar dentro do plantão é justo: dia cheio ou vazio vale
// igual para todos. O índice junta os últimos plantões: 100% = atende como a média dos colegas.
// Entra na atenção abaixo de 85% e só sai quando alcança a média (100%); entre os dois, fica como estava.
import {segments, parse, doctorIdentity} from './scheduling.js';
import {mesmoMedico} from './production.js';

export const ENTRA = 0.85;            // abaixo disso: merece atenção
export const SAI = 1.0;               // sai da atenção quando alcança a média dos colegas
export const JANELA_DIAS = 15;        // últimos dias considerados
export const MIN_PLANTOES = 2;        // com menos plantões comparáveis não dá para julgar
export const ALERTA_HOJE = 0.7;       // no plantão de hoje: bem abaixo dos colegas agora
const POSTOS = {D: [0, 1, 2, 3, 4, 5], N: [7, 8, 9, 10, 11, 12]};
const HORAS_PLANTAO = 12;
const nomeDe = d => String(d || '').split('\n')[0].trim();
const consultas = r => r.adulto + r.pediatria;

// Médicos dos consultórios no plantão, com a área, o posto e as horas na escala (coberturas parciais contam menos).
export function escaladosComArea(seed, storage, data, turno) {
 const lista = [];
 for (const slot of POSTOS[turno]) for (const parte of segments(seed, storage, data, slot)) {
  const nome = nomeDe(parte.doctor);
  if (!nome) continue;
  const area = slot % 7 >= 4 ? 'pediatria' : 'adulto';
  const ja = lista.find(m => mesmoMedico(m.nome, nome));
  if (ja) { ja.horas += parte.end - parte.start; continue; }
  lista.push({nome, doctor: parte.doctor, area, slot, horas: parte.end - parte.start});
 }
 return lista.map(m => ({...m, horas: Math.min(HORAS_PLANTAO, m.horas)}));
}

// Um plantão: cada médico que atendeu, com a média dos colegas da mesma área (sem contar ele mesmo).
// Com escala, só entram os médicos dos consultórios (Box, cinderela e extras ficam fora da conta) e as consultas
// são ajustadas às horas na escala. Sem escala, entram todos que atenderam, cada um na área em que mais atendeu.
export function comparacaoPlantao(registros, escala = []) {
 const participantes = [];
 for (const r of registros) {
  if (!consultas(r)) continue;
  let area = r.adulto >= r.pediatria ? 'adulto' : 'pediatria', fracao = 1;
  if (escala.length) {
   const e = escala.find(m => mesmoMedico(r.medico, m.nome));
   if (!e) continue;
   area = e.area; fracao = Math.max(0.25, e.horas / HORAS_PLANTAO);
  }
  const ja = participantes.find(p => mesmoMedico(p.medico, r.medico));
  if (ja) { ja.consultas += consultas(r); ja.ajustado = ja.consultas / ja.fracao; continue; }
  participantes.push({medico: r.medico, area, consultas: consultas(r), fracao, ajustado: consultas(r) / fracao});
 }
 return participantes.map(p => {
  const colegas = participantes.filter(o => o !== p && o.area === p.area);
  return {...p, colegas: colegas.length, mediaColegas: colegas.length ? colegas.reduce((s, o) => s + o.ajustado, 0) / colegas.length : null};
 });
}

// Histórico por médico: [{medico, plantoes: [{data, turno, consultas, ajustado, mediaColegas, razao}]}], do mais antigo ao mais novo.
export function historico(registros, escalaDe = () => []) {
 const porPlantao = new Map();
 for (const r of registros) {
  const chave = `${r.data}${r.turno}`;
  if (!porPlantao.has(chave)) porPlantao.set(chave, []);
  porPlantao.get(chave).push(r);
 }
 const medicos = [];
 for (const chave of [...porPlantao.keys()].sort()) {
  const lista = porPlantao.get(chave), {data, turno} = lista[0];
  for (const c of comparacaoPlantao(lista, escalaDe(data, turno))) {
   if (!c.mediaColegas) continue;
   let m = medicos.find(x => mesmoMedico(x.medico, c.medico));
   if (!m) { m = {medico: c.medico, plantoes: []}; medicos.push(m); }
   m.plantoes.push({data, turno, area: c.area, consultas: c.consultas, ajustado: c.ajustado, mediaColegas: c.mediaColegas, razao: c.ajustado / c.mediaColegas});
  }
 }
 return medicos;
}

// Índice de um conjunto de plantões: consultas do médico ÷ média dos colegas, somados (plantão cheio pesa mais).
export function indice(plantoes) {
 if (plantoes.length < MIN_PLANTOES) return null;
 const feito = plantoes.reduce((s, p) => s + p.ajustado, 0), esperado = plantoes.reduce((s, p) => s + p.mediaColegas, 0);
 return esperado ? feito / esperado : null;
}

// 'atencao' | 'ok' | 'poucos'. Entre ENTRA e SAI mantém a situação anterior: quem foi cobrado só sai ao alcançar a média.
export function situacao(valor, anterior) {
 if (valor === null || valor === undefined) return anterior === 'atencao' ? 'atencao' : 'poucos';
 if (valor < ENTRA) return 'atencao';
 if (valor >= SAI) return 'ok';
 return anterior === 'atencao' ? 'atencao' : 'ok';
}

// Acompanhamento salvo: {identidade: {nome, emAtencao, desde, conversas: [datas], saiuEm}}.
export const lerAcompanhamento = storage => { const d = parse(storage, 'atencao', {}); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; };

// Atualiza quem entrou/saiu da atenção. Só grava quando algo muda (cada gravação vai para o salvamento online).
export function atualizarAcompanhamento(storage, avaliacoes, hoje) {
 const dados = lerAcompanhamento(storage);
 let mudou = false;
 for (const a of avaliacoes) {
  const id = doctorIdentity(a.nome), atual = dados[id];
  if (a.situacao === 'atencao' && !atual?.emAtencao) { dados[id] = {...(atual || {conversas: []}), nome: a.nome, emAtencao: true, desde: hoje, saiuEm: null}; mudou = true; }
  else if (a.situacao === 'ok' && atual?.emAtencao) { dados[id] = {...atual, emAtencao: false, saiuEm: hoje}; mudou = true; }
 }
 if (mudou) storage.setItem('rt-upa:atencao', JSON.stringify(dados));
 return dados;
}

export function registrarConversa(storage, nome, hoje) {
 const dados = lerAcompanhamento(storage), id = doctorIdentity(nome);
 const atual = dados[id] || {nome, emAtencao: false, desde: null, conversas: [], saiuEm: null};
 if (!atual.conversas.includes(hoje)) atual.conversas = [...atual.conversas, hoje].slice(-20);
 dados[id] = atual;
 storage.setItem('rt-upa:atencao', JSON.stringify(dados));
}

export function desfazerConversa(storage, nome, hoje) {
 const dados = lerAcompanhamento(storage), atual = dados[doctorIdentity(nome)];
 if (!atual) return;
 atual.conversas = atual.conversas.filter(d => d !== hoje);
 storage.setItem('rt-upa:atencao', JSON.stringify(dados));
}

// Avaliação dos médicos do plantão atual: índice dos últimos dias, situação, evolução desde a última conversa
// e o desempenho de agora (hoje) contra os colegas. emAndamentoHoras: horas desde o início do plantão.
export function avaliarPlantao({escala, hist, agora = [], acompanhamento = {}, emAndamentoHoras = 0}) {
 const hojeComp = comparacaoPlantao(agora, escala);
 return escala.map(m => {
  const h = hist.find(x => mesmoMedico(x.medico, m.nome));
  const plantoes = h?.plantoes || [];
  const valor = indice(plantoes);
  const salvo = acompanhamento[doctorIdentity(m.doctor || m.nome)] || acompanhamento[doctorIdentity(m.nome)];
  const sit = situacao(valor, salvo?.emAtencao ? 'atencao' : undefined);
  const ultimaConversa = salvo?.conversas?.at(-1) || null;
  const depois = ultimaConversa ? plantoes.filter(p => p.data > ultimaConversa) : [];
  const antes = ultimaConversa ? plantoes.filter(p => p.data <= ultimaConversa) : [];
  const hoje = hojeComp.find(c => mesmoMedico(c.medico, m.nome));
  const colegasHoje = hojeComp.filter(c => c.area === m.area && !mesmoMedico(c.medico, m.nome));
  const mediaHoje = colegasHoje.length ? colegasHoje.reduce((s, c) => s + c.consultas, 0) / colegasHoje.length : null;
  const consultasHoje = hoje?.consultas || 0;
  const abaixoHoje = emAndamentoHoras >= 2 && m.horas >= HORAS_PLANTAO && mediaHoje !== null && mediaHoje >= 4 && consultasHoje < mediaHoje * ALERTA_HOJE;
  return {
   nome: m.nome, doctor: m.doctor, area: m.area, slot: m.slot,
   indice: valor, plantoes, situacao: sit, desde: salvo?.emAtencao ? salvo.desde : null,
   ultimaConversa, indiceAntes: antes.length ? antes.reduce((s, p) => s + p.ajustado, 0) / antes.reduce((s, p) => s + p.mediaColegas, 0) : null,
   indiceDepois: depois.length ? depois.reduce((s, p) => s + p.ajustado, 0) / depois.reduce((s, p) => s + p.mediaColegas, 0) : null,
   plantoesDepois: depois.length, consultasHoje, mediaHoje, abaixoHoje,
  };
 }).sort((a, b) => ordem(a) - ordem(b) || (a.indice ?? 9) - (b.indice ?? 9));
}
const ordem = a => a.situacao === 'atencao' ? 0 : a.abaixoHoje ? 1 : a.situacao === 'poucos' ? 3 : 2;
