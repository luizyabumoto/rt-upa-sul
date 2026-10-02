import test from 'node:test';
import assert from 'node:assert/strict';
import {proximoNumero, filtrar, novaCI, numeroCI, numeroOficial, dataExtenso, blocosDoTexto, MODELOS, lerCIs, PADRAO} from '../src/documentos.js';
import {areaMedico, filtrarArea} from '../src/production.js';
import {grupoDoPosto} from '../src/quick-view.js';
import {MemoryStore} from '../src/online-store.js';

const ci = (numero, ano, extra = {}) => ({id: `${ano}-${numero}`, numero, ano, data: `${ano}-10-01`, para: 'Direção Geral da UPA Sul', de: 'RT', assunto: '', corpo: '', anexos: '', assinante: 'Luiz', cargo: 'RT', crm: '1', status: 'rascunho', ...extra});

test('numeração da CI: segue o maior número do ano e recomeça no ano novo', () => {
 const lista = [ci(1, 2026), ci(7, 2026), ci(40, 2025)];
 assert.equal(proximoNumero(lista, 2026), 8);
 assert.equal(proximoNumero(lista, 2027), 1);
 assert.equal(numeroCI(ci(7, 2026)), '7/2026');
 assert.equal(numeroOficial(ci(448, 2026)), 'C.I N° 448/UPA PASCOAL RAMOS/SMS/2026');
 assert.equal(dataExtenso('2026-10-04'), '04 de Outubro de 2026');
});

test('nova CI: usa o próximo número, o modelo escolhido e repete quem assinou a última', () => {
 const lista = [{...ci(3, 2026), assinante: 'Luiz Yabumoto', assinante2: '', criadoEm: '2026-09-01'}];
 const nova = novaCI(lista, MODELOS.find(m => m.chave === 'ocorrencia'), '2026-10-01');
 assert.equal(nova.numero, 4);
 assert.equal(nova.ano, 2026);
 assert.equal(nova.assinante, 'Luiz Yabumoto');
 assert.equal(nova.assinante2, '', 'segunda assinatura apagada na última CI continua apagada');
 assert.equal(novaCI([], MODELOS[0], '2026-10-01').assinante2, PADRAO.assinante2);
 assert.equal(nova.prazo, 'INAPLICÁVEL');
 assert.equal(nova.status, 'rascunho');
 assert.match(nova.assunto, /ocorrência/i);
});

test('busca no arquivo: por número, assunto e texto, sem acento, e filtros de ano e situação', () => {
 const lista = [ci(1, 2026, {assunto: 'Reforço da segurança', status: 'emitida'}), ci(2, 2026, {assunto: 'Falta médica', corpo: 'Plantão noturno descoberto'}), ci(5, 2025, {assunto: 'Escala'})];
 assert.deepEqual(filtrar(lista, {busca: 'seguranca'}).map(c => c.numero), [1]);
 assert.deepEqual(filtrar(lista, {busca: '2/2026'}).map(c => c.numero), [2]);
 assert.deepEqual(filtrar(lista, {busca: 'noturno'}).map(c => c.numero), [2]);
 assert.deepEqual(filtrar(lista, {ano: '2025'}).map(c => c.numero), [5]);
 assert.deepEqual(filtrar(lista, {status: 'emitida'}).map(c => c.numero), [1]);
 assert.deepEqual(filtrar(lista).map(c => `${c.numero}/${c.ano}`), ['2/2026', '1/2026', '5/2025']);
});

test('arquivo guardado: lê a lista salva e ignora lixo', () => {
 const store = new MemoryStore({'rt-upa:documentos': JSON.stringify([ci(1, 2026), null, 'x'])});
 assert.equal(lerCIs(store).length, 1);
 assert.deepEqual(lerCIs(new MemoryStore()), []);
});

test('produção: separa médicos clínicos e pediatras pelo consultório em que mais atenderam', () => {
 const registros = [
  {medico: 'ANA', data: '2026-10-01', turno: 'D', adulto: 30, pediatria: 2, retornos: 0},
  {medico: 'BIA', data: '2026-10-01', turno: 'D', adulto: 1, pediatria: 25, retornos: 0},
  {medico: 'BIA', data: '2026-10-02', turno: 'N', adulto: 0, pediatria: 20, retornos: 0},
 ];
 assert.equal(areaMedico({adulto: 30, pediatria: 2}), 'adulto');
 assert.equal(areaMedico({adulto: 1, pediatria: 45}), 'pediatria');
 assert.deepEqual(filtrarArea(registros, 'pediatria').map(r => r.medico), ['BIA', 'BIA']);
 assert.deepEqual(filtrarArea(registros, 'adulto').map(r => r.medico), ['ANA']);
 assert.equal(filtrarArea(registros, '').length, 3);
});

test('escala do dia: postos agrupados em clínicos, pediatras e box', () => {
 assert.deepEqual([0, 3, 4, 5, 6, 7, 11, 13, 14].map(grupoDoPosto), ['Clínicos', 'Clínicos', 'Pediatras', 'Pediatras', 'Box', 'Clínicos', 'Pediatras', 'Box', '']);
});

test('texto da CI: linhas com • ou - viram tópicos, as outras são parágrafos', () => {
 const texto = ['Diante do exposto:', '• Primeiro;', '- Segundo;', '', 'A Direção Técnica permanece à disposição.'].join(String.fromCharCode(10));
 assert.deepEqual(blocosDoTexto(texto), [
  {tipo: 'p', texto: 'Diante do exposto:'}, {tipo: 'lista', itens: ['Primeiro;', 'Segundo;']}, {tipo: 'p', texto: 'A Direção Técnica permanece à disposição.'}]);
});
