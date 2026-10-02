// Documentos da RT: Comunicações Internas (CI) no modelo oficial da Prefeitura de Cuiabá / Secretaria de Saúde
// (logo no alto, quadro "COMUNICAÇÃO INTERNA", texto em Times, assinaturas eletrônicas e cuiaba.mt.gov.br no pé).
// Cada CI fica guardada em rt-upa:documentos e vira PDF pela impressão do navegador ("Salvar como PDF"),
// sempre igual — dá para baixar de novo a qualquer momento pelo arquivo.
import {parse} from './scheduling.js';

export const CHAVE = 'documentos';
export const STATUS = {rascunho: 'Rascunho', emitida: 'Emitida'};
export const SIGLA = 'UPA PASCOAL RAMOS';
export const DESTINOS = ['SECRETÁRIO ADJUNTO DE ATENÇÃO SECUNDÁRIA', 'SECRETÁRIO MUNICIPAL DE SAÚDE', 'DIRETOR(A) GERAL DA UPA PASCOAL RAMOS', 'COORDENAÇÃO DE ENFERMAGEM DA UPA PASCOAL RAMOS', 'GERÊNCIA ADMINISTRATIVA DA UPA PASCOAL RAMOS', 'CORPO CLÍNICO DA UPA PASCOAL RAMOS'];
// "De" e assinaturas do modelo oficial. Depois da primeira CI, valem os da última CI feita.
export const PADRAO = {
 de: 'COORDENAÇÃO TÉCNICA DA UPA PASCOAL RAMOS', prazo: 'INAPLICÁVEL', saudacao: 'Prezado Secretário,',
 assinante: 'LUIZ FERNANDO YABUMOTO', cargo: 'RESPONSÁVEL TÉCNICO MÉDICO DA UPA PASCOAL RAMOS',
 assinante2: 'LUIZ ROCHA CHAVES', cargo2: 'COORDENADOR TÉCNICO DA UPA SUL - PASCOAL RAMOS',
};
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FECHO = 'A Direção Técnica permanece à disposição e segue adotando todas as medidas cabíveis dentro de sua competência.';

// Modelos rápidos: o texto entre [colchetes] é para trocar. Linha começando com • vira tópico na folha.
export const MODELOS = [
 {chave: 'branco', nome: 'Em branco', icone: '＋', dica: 'Começar do zero', para: '', paraCargo: '', saudacao: 'Prezado(a) Senhor(a),', assunto: '', corpo: ''},
 {chave: 'ocorrencia', nome: 'Registro de ocorrência', icone: '⚠', dica: 'Desacato, agressão, conduta', para: '[NOME]', paraCargo: 'DIRETOR(A) GERAL DA UPA PASCOAL RAMOS', saudacao: 'Prezado(a) Diretor(a),',
  assunto: 'Registro de ocorrência – agressão verbal a profissional',
  corpo: `Venho, por meio desta comunicação, registrar a ocorrência do dia [DATA], durante o plantão [DIURNO/NOTURNO], em que o(a) profissional [NOME DO PROFISSIONAL] foi tratado(a) de forma desrespeitosa e agressiva por [PACIENTE/ACOMPANHANTE] no setor [SETOR], conforme registro em prontuário.\n[DESCREVA O OCORRIDO]\nRessalta-se que a unidade não dispõe de segurança suficiente para proteger a integridade física e moral dos profissionais.\nDiante do exposto, solicita-se:\n• Adoção das providências cabíveis quanto ao ocorrido;\n• Reforço da segurança da unidade;\n${FECHO}`},
 {chave: 'seguranca', nome: 'Pedido de segurança', icone: '🛡', dica: 'Vigilância, apoio policial', para: '[NOME]', paraCargo: 'SECRETÁRIO ADJUNTO DE ATENÇÃO SECUNDÁRIA', saudacao: 'Prezado Secretário,',
  assunto: 'Solicitação de reforço da segurança da unidade',
  corpo: `Venho, por meio desta comunicação, solicitar o reforço da segurança da UPA Pascoal Ramos, especialmente nos consultórios e na recepção, em razão de [MOTIVO].\nNos últimos dias foram registradas as seguintes situações: [OCORRÊNCIAS].\nDiante do exposto, solicita-se à Secretaria Municipal de Saúde:\n• Presença contínua de vigilância na unidade;\n• [OUTRA PROVIDÊNCIA];\n${FECHO}`},
 {chave: 'falta', nome: 'Falta de médico', icone: '⏱', dica: 'Plantão descoberto', para: '[NOME]', paraCargo: 'DIRETOR(A) GERAL DA UPA PASCOAL RAMOS', saudacao: 'Prezado(a) Diretor(a),',
  assunto: 'Comunicação de ausência médica no plantão',
  corpo: `Comunico que o(a) médico(a) [NOME], CRM [NÚMERO], escalado(a) no plantão [DIURNO/NOTURNO] do dia [DATA], no posto [CLÍNICO/PEDIATRIA/BOX], não compareceu [SEM AVISO PRÉVIO / COM AVISO ÀS HH:MM].\nPara não deixar a assistência descoberta, foram adotadas as seguintes medidas: [MEDIDAS].\n${FECHO}`},
 {chave: 'escala', nome: 'Escala / troca', icone: '⇄', dica: 'Alteração de plantão', para: '[NOME]', paraCargo: 'DIRETOR(A) GERAL DA UPA PASCOAL RAMOS', saudacao: 'Prezado(a) Diretor(a),',
  assunto: 'Alteração na escala médica',
  corpo: `Informo a alteração na escala médica referente ao período de [PERÍODO]:\n• [MÉDICO QUE SAI] → [MÉDICO QUE ENTRA], plantão [DIURNO/NOTURNO] do dia [DATA];\nA alteração foi acordada entre os profissionais e conferida por esta Responsabilidade Técnica.\n${FECHO}`},
 {chave: 'material', nome: 'Material / equipamento', icone: '⚙', dica: 'Pedido ou defeito', para: '[NOME]', paraCargo: 'GERÊNCIA ADMINISTRATIVA DA UPA PASCOAL RAMOS', saudacao: 'Prezado(a) Senhor(a),',
  assunto: 'Solicitação de material / manutenção de equipamento',
  corpo: `Venho, por meio desta comunicação, solicitar [A AQUISIÇÃO / A MANUTENÇÃO] de [ITEM], necessário(a) para o atendimento nos [SETOR].\nSituação atual: [DESCRIÇÃO].\nA falta deste item compromete [IMPACTO NO ATENDIMENTO].\n${FECHO}`},
 {chave: 'prontuario', nome: 'Prontuário eletrônico', icone: '▤', dica: 'Pedido à SMS (normas do CFM)', para: 'ODAIR MENDONSA DA SILVA', paraCargo: 'SECRETÁRIO ADJUNTO DE ATENÇÃO SECUNDÁRIA', saudacao: 'Prezado Secretário,',
  assunto: 'Solicitação de adequação – implantação de prontuário eletrônico integral',
  corpo: `Venho, por meio desta comunicação, solicitar providências quanto à adequação do sistema de prontuário da unidade, com vistas à implantação de prontuário eletrônico integral, em substituição ao prontuário físico.\nRessalta-se que, conforme disposto na Resolução CFM nº 1.821/2007, especialmente em seu Artigo 4º, bem como na Resolução CFM nº 2.299/2021, Artigo 5º, parágrafo único, o prontuário eletrônico pode substituir o prontuário físico desde que atendidos os requisitos de segurança, integridade, autenticidade e certificação digital.\nAdicionalmente, conforme previsto na Resolução CFM nº 2.147/2016, bem como na Resolução CFM nº 2.056/2013 (Manual de Vistoria e Fiscalização da Medicina, atualizado pela Resolução CFM nº 2.153/2016), e nos Artigos 17 e 18 do Código de Ética Médica (Resolução CFM nº 2.217/2018), cabe ao serviço de saúde garantir condições adequadas para registro seguro e completo das informações assistenciais.\nAtualmente, a unidade utiliza sistema de prontuário em modelo híbrido (eletrônico e físico), em razão de limitações estruturais e tecnológicas do sistema disponível, o qual não possui certificação digital que permita a substituição integral do prontuário físico.\nDessa forma, a manutenção do prontuário em papel ocorre como medida de segurança jurídica e assistencial, visando garantir a rastreabilidade, integridade e validade dos registros médicos.\nDiante do exposto, solicita-se à Secretaria Municipal de Saúde:\n• Avaliação e disponibilização de sistema de prontuário eletrônico com certificação digital adequada;\n• Implantação de infraestrutura tecnológica compatível com prontuário eletrônico integral;\n• Capacitação das equipes assistenciais para utilização do sistema;\n• Definição de plano de contingência para eventuais falhas do sistema eletrônico;\n${FECHO}`},
];

const hojeCuiaba = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
export const dataBR = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
// "04 de Outubro de 2026", como no modelo oficial.
export const dataExtenso = iso => { if (!iso) return ''; const [a, m, d] = iso.split('-'); return `${d} de ${MESES[Number(m) - 1]} de ${a}`; };
export const numeroCI = ci => `${ci.numero}/${ci.ano}`;
export const numeroOficial = ci => `C.I N° ${ci.numero}/${SIGLA}/SMS/${ci.ano}`;
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function lerCIs(storage) {
 const lista = parse(storage, CHAVE, []);
 return Array.isArray(lista) ? lista.filter(c => c && typeof c === 'object' && typeof c.id === 'string') : [];
}
const gravar = (storage, lista) => storage.setItem(`rt-upa:${CHAVE}`, JSON.stringify(lista));

// Próximo número do ano: maior número já usado + 1. O primeiro dá para trocar à mão (ex.: seguir do 448).
export function proximoNumero(lista, ano) {
 return lista.filter(c => c.ano === ano).reduce((m, c) => Math.max(m, c.numero), 0) + 1;
}

// Busca por número ("448", "448/2026"), assunto, destinatário, texto ou quem assinou — sem acento.
export function filtrar(lista, {busca = '', ano = '', status = ''} = {}) {
 const termos = semAcento(busca).split(/\s+/).filter(Boolean);
 return lista.filter(c => (!ano || c.ano === Number(ano)) && (!status || c.status === status) && termos.every(t => {
  const alvo = semAcento(`${numeroCI(c)} ${c.numero} ${c.assunto} ${c.para} ${c.paraCargo} ${c.corpo} ${c.anexos} ${c.assinante} ${c.assinante2} ${dataBR(c.data)}`);
  return alvo.includes(t);
 })).sort((a, b) => b.ano - a.ano || b.numero - a.numero);
}

// Nova CI: número seguinte do ano; "De" e assinaturas iguais aos da última CI (ou os do modelo oficial).
export function novaCI(lista, modelo = MODELOS[0], hoje = hojeCuiaba()) {
 const ano = Number(hoje.slice(0, 4)), ultima = [...lista].sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))[0];
 const base = {...PADRAO};
 if (ultima) for (const k of ['de', 'assinante', 'cargo', 'assinante2', 'cargo2']) if (typeof ultima[k] === 'string') base[k] = ultima[k];
 const agora = new Date().toISOString();
 return {
  id: crypto.randomUUID(), numero: proximoNumero(lista, ano), ano, data: hoje, prazo: PADRAO.prazo,
  de: base.de, para: modelo.para, paraCargo: modelo.paraCargo || '', assunto: modelo.assunto, saudacao: modelo.saudacao || PADRAO.saudacao, corpo: modelo.corpo, anexos: '',
  assinante: base.assinante, cargo: base.cargo, assinante2: base.assinante2, cargo2: base.cargo2,
  eletronico: ultima ? ultima.eletronico !== false : true, status: 'rascunho', criadoEm: agora, atualizadoEm: agora, emitidaEm: '',
 };
}

// Texto em blocos: parágrafo comum ou tópico (linha que começa com •, ●, - ou *).
export function blocosDoTexto(corpo) {
 const blocos = [];
 for (const linha of String(corpo || '').split('\n').map(s => s.trim()).filter(Boolean)) {
  const topico = linha.match(/^[•●*-]\s*(.+)$/);
  if (!topico) { blocos.push({tipo: 'p', texto: linha}); continue; }
  const ultimo = blocos.at(-1);
  if (ultimo?.tipo === 'lista') ultimo.itens.push(topico[1]); else blocos.push({tipo: 'lista', itens: [topico[1]]});
 }
 return blocos;
}

// ---------- Folha da CI (a mesma na prévia e no PDF) ----------
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
// Célula do quadro: partes [texto, negrito?].
function celula(partes, colunas = 2) {
 const td = el('td');
 td.colSpan = colunas;
 for (const [texto, forte] of partes) td.append(forte ? el('strong', '', texto) : document.createTextNode(texto));
 return td;
}

// Logo desenhado (brasão + CUIABÁ PREFEITURA | SECRETARIA DE SAÚDE), sem depender de imagem de fora.
function logo() {
 const box = el('div', 'ci-logo');
 box.innerHTML = '<svg class="ci-brasao" viewBox="0 0 64 76" aria-hidden="true"><path d="M14 4l5 6 5-7 5 7 3-8 3 8 5-7 5 7 5-6-3 12H17z" fill="#f2bd00"/><path d="M8 20h48v26c0 15-11 24-24 28C19 70 8 61 8 46z" fill="#0a7a3c"/><path d="M32 29l12 34-12-9-12 9z" fill="#f2bd00"/></svg>'
  + '<div class="ci-logo-nome"><strong>CUIABÁ</strong><span>PREFEITURA</span></div><i class="ci-logo-barra"></i><div class="ci-logo-sec">SECRETARIA<br>DE SAÚDE</div>';
 return box;
}

export function folhaCI(ci) {
 const folha = el('article', 'ci-folha');
 // Tabela da página: o cabeçalho (logo) e o espaço do rodapé se repetem em cada folha impressa.
 const pagina = el('table', 'ci-pagina');
 const thead = el('thead'), tfoot = el('tfoot'), tbody = el('tbody');
 const tr = (...filhos) => { const t = el('tr'), td = el('td'); td.append(...filhos); t.append(td); return t; };
 thead.append(tr(logo()));
 tfoot.append(tr(el('div', 'ci-pe-espaco')));

 const quadro = el('table', 'ci-quadro');
 const linha = (...tds) => { const t = el('tr'); t.append(...tds); quadro.append(t); };
 const titulo = el('th', '', 'COMUNICAÇÃO INTERNA'); titulo.colSpan = 2;
 linha(titulo);
 linha(celula([[`C.I N° ${ci.numero}/${SIGLA}/`], [`SMS/${ci.ano}`, true]]));
 const prazo = celula([[`PRAZO: ${(ci.prazo ?? PADRAO.prazo).toUpperCase() || '—'}`, true]], 1);
 prazo.className = 'ci-cinza';
 linha(celula([['DATA:  '], [dataExtenso(ci.data), true]], 1), prazo);
 linha(celula([['DE: '], [(ci.de || '').toUpperCase(), true]]));
 const para = celula([['PARA: '], [(ci.para || '').toUpperCase(), true]]);
 if (ci.paraCargo?.trim()) para.append(el('span', 'ci-para-cargo', ci.paraCargo.trim().toUpperCase()));
 linha(para);
 linha(celula([['ASSUNTO: '], [(ci.assunto || '').toUpperCase(), true]]));

 const texto = el('div', 'ci-texto');
 if (ci.saudacao?.trim()) texto.append(el('p', 'ci-sem-recuo', ci.saudacao.trim()));
 for (const b of blocosDoTexto(ci.corpo)) {
  if (b.tipo === 'p') { texto.append(el('p', '', b.texto)); continue; }
  const ul = el('ul');
  for (const item of b.itens) ul.append(el('li', '', item));
  texto.append(ul);
 }
 if (ci.anexos?.trim()) { const a = el('p', 'ci-sem-recuo'); a.append(el('strong', '', 'Anexo: '), document.createTextNode(ci.anexos.trim())); texto.append(a); }
 texto.append(el('p', 'ci-sem-recuo', 'Atenciosamente,'));

 const assinaturas = el('div', 'ci-assinaturas');
 for (const [nome, cargo] of [[ci.assinante, ci.cargo], [ci.assinante2, ci.cargo2]]) {
  if (!nome?.trim()) continue;
  const a = el('div', 'ci-assinatura');
  if (ci.eletronico === false) a.append(el('span', 'ci-linha'));
  a.append(el('strong', '', nome.trim().toUpperCase()), el('span', '', (cargo || '').toUpperCase()));
  if (ci.eletronico !== false) a.append(el('em', '', '(assinado eletronicamente)'));
  assinaturas.append(a);
 }
 tbody.append(tr(quadro, texto, assinaturas));
 pagina.append(thead, tbody, tfoot);
 folha.append(pagina, el('footer', 'ci-site', 'cuiaba.mt.gov.br'));
 return folha;
}

// PDF: só a folha vai para a impressão; o nome sugerido do arquivo vem do título da página.
export function imprimirCI(ci) {
 let alvo = document.querySelector('#ci-impressao');
 if (!alvo) { alvo = el('div'); alvo.id = 'ci-impressao'; document.body.append(alvo); }
 alvo.replaceChildren(folhaCI(ci));
 const tituloAntes = document.title;
 document.title = `CI ${ci.numero}-${ci.ano} - ${(ci.assunto || 'sem assunto').replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}`;
 document.body.classList.add('imprimindo-ci');
 const fim = () => { document.body.classList.remove('imprimindo-ci'); document.title = tituloAntes; window.removeEventListener('afterprint', fim); };
 window.addEventListener('afterprint', fim);
 window.print();
 setTimeout(fim, 1500);
}

// ---------- Aba ----------
const CAMPOS = ['data', 'prazo', 'para', 'paraCargo', 'de', 'assunto', 'saudacao', 'corpo', 'anexos', 'assinante', 'cargo', 'assinante2', 'cargo2'];

export function mountDocumentos(storage) {
 const painel = document.querySelector('#documentos-panel');
 if (!painel) return;
 painel.innerHTML = `
 <div class="doc-hero">
  <div><p class="eyebrow">DOCUMENTOS DA RT · UPA PASCOAL RAMOS</p><h2>Comunicações Internas</h2><p class="muted">Escreva a CI, confira a folha ao lado e gere o PDF no modelo oficial da Prefeitura de Cuiabá. Tudo fica guardado e numerado aqui.</p></div>
  <div class="doc-kpis"></div>
 </div>
 <div class="doc-modelos" role="group" aria-label="Começar uma CI nova"></div>
 <div class="doc-area">
  <aside class="doc-arquivo" aria-label="CIs guardadas">
   <div class="doc-arquivo-cab"><h3>Arquivo de CIs</h3><span class="doc-contagem muted"></span></div>
   <label class="doc-busca-label"><span class="sr-only">Buscar CI</span><input type="search" class="doc-busca" placeholder="Buscar nº, assunto, destino, texto…" autocomplete="off"></label>
   <div class="doc-filtros"><select class="doc-ano" aria-label="Ano"></select><div class="doc-chips" role="group" aria-label="Situação"><button type="button" data-status="" class="ativo">Todas</button><button type="button" data-status="rascunho">Rascunhos</button><button type="button" data-status="emitida">Emitidas</button></div></div>
   <div class="doc-lista" aria-live="polite"></div>
  </aside>
  <section class="doc-editor" aria-label="Editor da CI">
   <div class="doc-vazio"><div class="doc-vazio-icone">✉</div><h3>Nenhuma CI aberta</h3><p class="muted">Escolha um modelo acima para começar uma CI nova, ou abra uma do arquivo ao lado.</p></div>
   <form class="doc-form" hidden autocomplete="off">
    <div class="doc-form-topo">
     <div class="doc-numero"><span>C.I N°</span><input name="numero" type="number" min="1" max="9999" required aria-label="Número da CI"><span>/</span><input name="ano" type="number" min="2000" max="2100" required aria-label="Ano da CI"></div>
     <span class="doc-status"></span><span class="doc-salvo muted" role="status" aria-live="polite"></span>
    </div>
    <p class="doc-aviso-num" hidden></p>
    <div class="doc-grade">
     <label>Data<input name="data" type="date" required></label>
     <label>Prazo<input name="prazo" maxlength="100" placeholder="Ex.: INAPLICÁVEL ou 10 dias"></label>
     <label class="doc-largo">De<input name="de" maxlength="300" required></label>
     <label>Para · nome<input name="para" maxlength="300" required placeholder="Ex.: ODAIR MENDONSA DA SILVA"></label>
     <label>Para · cargo<input name="paraCargo" list="doc-destinos" maxlength="300" placeholder="Ex.: SECRETÁRIO ADJUNTO…"></label>
     <label class="doc-largo">Assunto<input name="assunto" maxlength="300" required placeholder="Resumo em uma linha"></label>
     <label class="doc-largo">Saudação<input name="saudacao" maxlength="200" placeholder="Ex.: Prezado Secretário,"></label>
    </div>
    <datalist id="doc-destinos">${DESTINOS.map(d => `<option value="${d}"></option>`).join('')}</datalist>
    <label class="doc-corpo-label">Texto<textarea name="corpo" rows="14" maxlength="20000" placeholder="Escreva a comunicação. Cada parágrafo em uma linha. Para tópicos, comece a linha com • ou -"></textarea></label>
    <div class="doc-ajuda"><span class="doc-colchetes"></span><span class="doc-palavras muted"></span></div>
    <label>Anexo (opcional)<input name="anexos" maxlength="500" placeholder="Ex.: cópia do registro em prontuário"></label>
    <fieldset class="doc-assina"><legend>Assinaturas</legend>
     <label>1ª assinatura · nome<input name="assinante" maxlength="200"></label>
     <label>Cargo<input name="cargo" maxlength="200"></label>
     <label>2ª assinatura · nome (opcional)<input name="assinante2" maxlength="200" placeholder="Em branco = só uma assinatura"></label>
     <label>Cargo<input name="cargo2" maxlength="200"></label>
    </fieldset>
    <label class="doc-check"><input type="checkbox" name="eletronico"> Escrever “(assinado eletronicamente)” embaixo dos nomes</label>
    <div class="doc-acoes">
     <button type="button" class="doc-pdf">⤓ Gerar PDF</button>
     <button type="button" class="secondary doc-duplicar">Duplicar</button>
     <button type="button" class="secondary doc-fechar">Fechar</button>
     <button type="button" class="secondary danger doc-excluir">Excluir</button>
    </div>
    <p class="muted doc-dica">Salva sozinho enquanto você escreve. No PDF, escolha <strong>Salvar como PDF</strong> na janela de impressão. Atalho: Ctrl+P gera o PDF desta CI.</p>
   </form>
  </section>
  <section class="doc-previa" aria-label="Prévia da folha">
   <div class="doc-previa-cab"><span class="eyebrow">PRÉVIA DA FOLHA · A4</span></div>
   <div class="doc-previa-palco"><div class="doc-previa-escala"></div></div>
  </section>
 </div>`;
 const $ = s => painel.querySelector(s);
 const form = $('.doc-form');
 let aberta = null, timer = null, filtroStatus = '';

 const lista = () => lerCIs(storage);
 function salvar(ci) {
  const atual = lista(), i = atual.findIndex(c => c.id === ci.id);
  ci.atualizadoEm = new Date().toISOString();
  if (i >= 0) atual[i] = ci; else atual.unshift(ci);
  gravar(storage, atual);
  $('.doc-salvo').textContent = `✓ Salvo às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
  renderLista(); renderKpis();
 }

 function renderKpis() {
  const todas = lista(), hoje = hojeCuiaba(), ano = Number(hoje.slice(0, 4));
  const doAno = todas.filter(c => c.ano === ano), doMes = todas.filter(c => (c.data || '').slice(0, 7) === hoje.slice(0, 7));
  const rasc = todas.filter(c => c.status === 'rascunho').length;
  $('.doc-kpis').replaceChildren(...[
   [`CIs em ${ano}`, doAno.length, `${doMes.length} neste mês`],
   ['Próximo número', `${proximoNumero(todas, ano)}/${ano}`, 'dá para trocar na CI'],
   ['Rascunhos', rasc, rasc ? 'ainda sem PDF' : 'nenhum pendente'],
  ].map(([r, v, d]) => { const k = el('div', 'doc-kpi'); k.append(el('span', '', r), el('strong', '', String(v)), el('small', '', d)); return k; }));
 }

 function renderAnos() {
  const sel = $('.doc-ano'), antes = sel.value, anos = [...new Set([Number(hojeCuiaba().slice(0, 4)), ...lista().map(c => c.ano)])].sort((a, b) => b - a);
  sel.replaceChildren(new Option('Todos os anos', ''), ...anos.map(a => new Option(String(a), String(a))));
  sel.value = anos.map(String).includes(antes) ? antes : '';
 }

 function renderLista() {
  const todas = lista(), achadas = filtrar(todas, {busca: $('.doc-busca').value, ano: $('.doc-ano').value, status: filtroStatus});
  $('.doc-contagem').textContent = `${achadas.length} de ${todas.length}`;
  const alvo = $('.doc-lista');
  alvo.replaceChildren();
  if (!todas.length) { alvo.append(el('p', 'doc-lista-vazia', 'Ainda não há CIs guardadas. A primeira que você fizer aparece aqui.')); return; }
  if (!achadas.length) { alvo.append(el('p', 'doc-lista-vazia', 'Nenhuma CI encontrada com essa busca.')); return; }
  let grupo = '';
  for (const ci of achadas) {
   const [a, m] = (ci.data || `${ci.ano}-01`).split('-');
   const rotulo = `${MESES[Number(m) - 1]} de ${a}`;
   if (rotulo !== grupo) { grupo = rotulo; alvo.append(el('h4', 'doc-mes', rotulo)); }
   const b = el('button', `doc-item${aberta?.id === ci.id ? ' aberta' : ''}`);
   b.type = 'button';
   const topo = el('span', 'doc-item-topo');
   topo.append(el('span', 'doc-item-num', `Nº ${numeroCI(ci)}`), el('span', `doc-pill ${ci.status}`, STATUS[ci.status] || ci.status), el('span', 'doc-item-data', dataBR(ci.data)));
   b.append(topo, el('strong', 'doc-item-assunto', ci.assunto || 'Sem assunto'), el('span', 'doc-item-para', `Para: ${ci.para || '—'}${ci.paraCargo ? ' · ' + ci.paraCargo : ''}`));
   b.onclick = () => abrir(ci.id);
   alvo.append(b);
  }
 }

 function renderModelos() {
  $('.doc-modelos').replaceChildren(...MODELOS.map(m => {
   const b = el('button', `doc-modelo${m.chave === 'branco' ? ' principal' : ''}`);
   b.type = 'button';
   b.append(el('span', 'doc-modelo-icone', m.icone), el('strong', '', m.chave === 'branco' ? 'Nova CI' : m.nome), el('small', '', m.dica));
   b.onclick = () => criar(m);
   return b;
  }));
 }

 // Prévia: a folha A4 em tamanho real, reduzida para caber na coluna.
 const palco = $('.doc-previa-palco'), escala = $('.doc-previa-escala');
 function ajustarEscala() {
  const folha = escala.firstElementChild;
  if (!folha) { palco.style.height = ''; return; }
  const s = Math.min(1, palco.clientWidth / folha.offsetWidth);
  escala.style.transform = `scale(${s})`;
  palco.style.height = `${folha.offsetHeight * s}px`;
 }
 new ResizeObserver(ajustarEscala).observe(palco);
 function renderPrevia() {
  escala.replaceChildren();
  $('.doc-previa').classList.toggle('sem-ci', !aberta);
  escala.append(folhaCI(aberta || {...novaCI([], MODELOS.find(m => m.chave === 'prontuario')), numero: 448}));
  ajustarEscala();
 }

 function avisos() {
  const outra = lista().find(c => c.id !== aberta.id && c.ano === aberta.ano && c.numero === aberta.numero);
  const aviso = $('.doc-aviso-num');
  aviso.hidden = !outra;
  if (outra) aviso.textContent = `⚠ Já existe a CI ${numeroCI(outra)} (“${outra.assunto || 'sem assunto'}”). Use o número ${proximoNumero(lista(), aberta.ano)}.`;
  const colchetes = ['corpo', 'assunto', 'para'].reduce((n, k) => n + (String(aberta[k] || '').match(/\[[^\]]+\]/g) || []).length, 0);
  $('.doc-colchetes').textContent = colchetes ? `Faltam ${colchetes} ${colchetes === 1 ? 'trecho' : 'trechos'} entre [colchetes] para completar` : '';
  const palavras = aberta.corpo.trim() ? aberta.corpo.trim().split(/\s+/).length : 0;
  $('.doc-palavras').textContent = `${palavras} ${palavras === 1 ? 'palavra' : 'palavras'}`;
  const st = $('.doc-status');
  st.className = `doc-status doc-pill ${aberta.status}`;
  st.textContent = aberta.status === 'emitida' ? `Emitida${aberta.emitidaEm ? ' em ' + dataBR(aberta.emitidaEm) : ''}` : 'Rascunho';
 }

 function preencher() {
  for (const nome of ['numero', 'ano', ...CAMPOS]) form.elements[nome].value = aberta[nome] ?? (PADRAO[nome] || '');
  form.elements.eletronico.checked = aberta.eletronico !== false;
  $('.doc-salvo').textContent = '';
 }

 // CI aberta e largada sem assunto nem texto não fica ocupando número no arquivo.
 function descartarSeVazia() {
  if (!aberta || aberta.assunto.trim() || aberta.corpo.trim()) return false;
  clearTimeout(timer); gravar(storage, lista().filter(c => c.id !== aberta.id)); aberta = null;
  return true;
 }

 function mostrarEditor(sim) { form.hidden = !sim; $('.doc-vazio').hidden = sim; painel.classList.toggle('editando', sim); }

 function abrir(id) {
  if (aberta?.id !== id) descartarSeVazia();
  const ci = lista().find(c => c.id === id);
  if (!ci) return;
  aberta = {...ci}; preencher(); mostrarEditor(true); avisos(); renderPrevia(); renderLista();
  if (matchMedia('(max-width: 1100px)').matches) form.scrollIntoView({behavior: 'smooth', block: 'start'});
 }

 function criar(modelo) {
  descartarSeVazia();
  aberta = novaCI(lista(), modelo);
  salvar(aberta); preencher(); mostrarEditor(true); avisos(); renderPrevia(); renderAnos(); renderLista();
  // Leva o cursor ao primeiro [colchete] (nome de quem recebe ou texto); na CI em branco, ao "Para".
  if (aberta.para.startsWith('[')) { form.elements.para.focus(); form.elements.para.select(); return; }
  const corpo = form.elements.corpo, i = aberta.corpo.indexOf('[');
  if (i >= 0) { corpo.focus(); corpo.setSelectionRange(i, aberta.corpo.indexOf(']', i) + 1); corpo.scrollTop = 0; }
  else form.elements.para.focus();
 }

 form.addEventListener('input', () => {
  if (!aberta) return;
  for (const nome of CAMPOS) aberta[nome] = form.elements[nome].value;
  for (const nome of ['numero', 'ano']) { const v = Number(form.elements[nome].value); if (Number.isInteger(v) && v > 0) aberta[nome] = v; }
  aberta.eletronico = form.elements.eletronico.checked;
  avisos(); renderPrevia();
  $('.doc-salvo').textContent = 'Salvando…';
  clearTimeout(timer);
  const ci = aberta;
  timer = setTimeout(() => salvar({...ci}), 700);
 });
 form.addEventListener('submit', e => e.preventDefault());

 function gerarPdf() {
  if (!aberta) return;
  if (!form.reportValidity()) return;
  clearTimeout(timer);
  if (aberta.status !== 'emitida') { aberta.status = 'emitida'; aberta.emitidaEm = new Date().toISOString(); }
  salvar({...aberta}); avisos();
  imprimirCI(aberta);
 }
 $('.doc-pdf').onclick = gerarPdf;
 $('.doc-duplicar').onclick = () => {
  if (!aberta) return;
  clearTimeout(timer); salvar({...aberta});
  const nova = novaCI(lista()), copia = {...aberta, id: nova.id, numero: nova.numero, ano: nova.ano, data: nova.data, status: 'rascunho', emitidaEm: '', criadoEm: nova.criadoEm};
  salvar(copia); abrir(copia.id); renderAnos();
  $('.doc-salvo').textContent = `Cópia criada como CI ${numeroCI(copia)}`;
 };
 $('.doc-fechar').onclick = () => { clearTimeout(timer); if (!descartarSeVazia() && aberta) salvar({...aberta}); aberta = null; mostrarEditor(false); renderPrevia(); renderAnos(); renderLista(); renderKpis(); };
 $('.doc-excluir').onclick = () => {
  if (!aberta) return;
  if (!confirm(`Excluir a CI ${numeroCI(aberta)}${aberta.assunto ? ` (“${aberta.assunto}”)` : ''}?\n\nEla sai do arquivo. Não dá para desfazer.`)) return;
  clearTimeout(timer);
  gravar(storage, lista().filter(c => c.id !== aberta.id));
  aberta = null; mostrarEditor(false); renderPrevia(); renderAnos(); renderLista(); renderKpis();
 };
 $('.doc-busca').addEventListener('input', renderLista);
 $('.doc-ano').onchange = renderLista;
 $('.doc-chips').addEventListener('click', e => {
  const b = e.target.closest('[data-status]');
  if (!b) return;
  filtroStatus = b.dataset.status;
  for (const x of $('.doc-chips').children) x.classList.toggle('ativo', x === b);
  renderLista();
 });
 // Ctrl+P com uma CI aberta nesta aba gera o PDF da CI (e não da página inteira).
 window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && !painel.hidden && aberta) { e.preventDefault(); gerarPdf(); }
 });
 document.addEventListener('rt-data-restored', () => { if (aberta && !lista().some(c => c.id === aberta.id)) { aberta = null; mostrarEditor(false); } renderAnos(); renderLista(); renderKpis(); renderPrevia(); });
 document.querySelector('[data-view="documentos"]')?.addEventListener('click', () => requestAnimationFrame(ajustarEscala));

 renderModelos(); renderAnos(); renderKpis(); renderLista(); renderPrevia();
}
