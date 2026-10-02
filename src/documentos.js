// Documentos da RT: Comunicações Internas (CI) no modelo da Prefeitura de Cuiabá / UPA Sul.
// Cada CI fica guardada (numerada por ano) em rt-upa:documentos e vira PDF pela impressão do navegador
// ("Salvar como PDF"), sempre igual — dá para baixar de novo a qualquer momento pelo arquivo.
import {parse} from './scheduling.js';

export const CHAVE = 'documentos';
export const STATUS = {rascunho: 'Rascunho', emitida: 'Emitida'};
export const DESTINOS = ['Direção Geral da UPA Sul', 'Diretoria Técnica', 'Coordenação de Enfermagem', 'Gerência Administrativa', 'Coordenação Médica', 'Secretaria Municipal de Saúde – SMS', 'Segurança Patrimonial', 'Corpo Clínico da UPA Sul'];
export const ENDERECO = ['AVENIDA BRASIL, S/N, PASCOAL RAMOS - 78098015', 'CUIABÁ - MT'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FECHO = 'Sem mais para o momento, colocamo-nos à disposição para os esclarecimentos que se fizerem necessários.';

// Modelos rápidos: o texto entre [colchetes] é para trocar. O cursor já vai para o primeiro colchete.
export const MODELOS = [
 {chave: 'branco', nome: 'Em branco', icone: '＋', dica: 'Começar do zero', para: '', assunto: '', corpo: ''},
 {chave: 'ocorrencia', nome: 'Registro de ocorrência', icone: '⚠', dica: 'Desacato, agressão, conduta', para: 'Direção Geral da UPA Sul',
  assunto: 'Registro de ocorrência – agressão verbal a profissional',
  corpo: `Comunico a Vossa Senhoria que, no dia [DATA], durante o plantão [DIURNO/NOTURNO], o(a) paciente [NOME DO PACIENTE], atendido(a) no setor [SETOR], dirigiu-se de forma desrespeitosa e agressiva ao(à) profissional [NOME DO PROFISSIONAL], conforme registro em prontuário.\n\n[DESCREVA O OCORRIDO]\n\nSolicito as providências cabíveis, bem como o reforço da segurança da unidade, a fim de proteger a integridade física e moral dos profissionais.\n\n${FECHO}`},
 {chave: 'seguranca', nome: 'Pedido de segurança', icone: '🛡', dica: 'Vigilância, apoio policial', para: 'Gerência Administrativa',
  assunto: 'Solicitação de reforço da segurança da unidade',
  corpo: `Solicito o reforço da segurança da UPA Sul, especialmente nos consultórios e na recepção, em razão de [MOTIVO].\n\nNos últimos dias foram registradas as seguintes situações: [OCORRÊNCIAS].\n\nA presença contínua de vigilância é necessária para garantir a integridade dos profissionais e dos usuários.\n\n${FECHO}`},
 {chave: 'falta', nome: 'Falta de médico', icone: '⏱', dica: 'Plantão descoberto', para: 'Coordenação Médica',
  assunto: 'Comunicação de ausência médica no plantão',
  corpo: `Comunico que o(a) médico(a) [NOME], CRM [NÚMERO], escalado(a) no plantão [DIURNO/NOTURNO] do dia [DATA], no posto [CLÍNICO/PEDIATRIA/BOX], não compareceu [SEM AVISO PRÉVIO / COM AVISO ÀS HH:MM].\n\nPara não deixar a assistência descoberta, foram adotadas as seguintes medidas: [MEDIDAS].\n\n${FECHO}`},
 {chave: 'escala', nome: 'Escala / troca', icone: '⇄', dica: 'Alteração de plantão', para: 'Direção Geral da UPA Sul',
  assunto: 'Alteração na escala médica',
  corpo: `Informo a alteração na escala médica referente ao período de [PERÍODO]:\n\n[MÉDICO QUE SAI] → [MÉDICO QUE ENTRA], plantão [DIURNO/NOTURNO] do dia [DATA].\n\nA alteração foi acordada entre os profissionais e conferida por esta Responsabilidade Técnica.\n\n${FECHO}`},
 {chave: 'material', nome: 'Material / equipamento', icone: '⚙', dica: 'Pedido ou defeito', para: 'Gerência Administrativa',
  assunto: 'Solicitação de material / manutenção de equipamento',
  corpo: `Solicito [A AQUISIÇÃO / A MANUTENÇÃO] de [ITEM], necessário(a) para o atendimento nos [SETOR].\n\nSituação atual: [DESCRIÇÃO].\n\nA falta deste item compromete [IMPACTO NO ATENDIMENTO].\n\n${FECHO}`},
 {chave: 'orientacao', nome: 'Orientação ao corpo clínico', icone: '✎', dica: 'Comunicado aos médicos', para: 'Corpo Clínico da UPA Sul',
  assunto: 'Orientação ao corpo clínico',
  corpo: `Prezados(as) colegas,\n\nComunico que, a partir de [DATA], [ORIENTAÇÃO].\n\nContamos com a colaboração de todos.\n\n${FECHO}`},
];

const hojeCuiaba = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
export const dataBR = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
export const numeroCI = ci => `${String(ci.numero).padStart(3, '0')}/${ci.ano}`;
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function lerCIs(storage) {
 const lista = parse(storage, CHAVE, []);
 return Array.isArray(lista) ? lista.filter(c => c && typeof c === 'object' && typeof c.id === 'string') : [];
}
const gravar = (storage, lista) => storage.setItem(`rt-upa:${CHAVE}`, JSON.stringify(lista));

// Próximo número do ano: maior número já usado + 1 (a numeração recomeça a cada ano).
export function proximoNumero(lista, ano) {
 return lista.filter(c => c.ano === ano).reduce((m, c) => Math.max(m, c.numero), 0) + 1;
}

// Busca por número ("12", "012/2026"), assunto, destinatário, texto ou quem assinou — sem acento.
export function filtrar(lista, {busca = '', ano = '', status = ''} = {}) {
 const termos = semAcento(busca).split(/\s+/).filter(Boolean);
 return lista.filter(c => (!ano || c.ano === Number(ano)) && (!status || c.status === status) && termos.every(t => {
  const alvo = semAcento(`${numeroCI(c)} ${c.numero} ${c.assunto} ${c.para} ${c.corpo} ${c.anexos} ${c.assinante} ${dataBR(c.data)}`);
  return alvo.includes(t);
 })).sort((a, b) => b.ano - a.ano || b.numero - a.numero);
}

// Nova CI: número seguinte do ano e quem assina igual à última CI feita (o RT não precisa redigitar).
export function novaCI(lista, modelo = MODELOS[0], hoje = hojeCuiaba()) {
 const ano = Number(hoje.slice(0, 4)), ultima = [...lista].sort((a, b) => (b.criadoEm || '').localeCompare(a.criadoEm || ''))[0];
 const agora = new Date().toISOString();
 return {
  id: crypto.randomUUID(), numero: proximoNumero(lista, ano), ano, data: hoje,
  de: ultima?.de || 'Responsável Técnico Médico – UPA Sul', para: modelo.para, assunto: modelo.assunto, corpo: modelo.corpo, anexos: '',
  assinante: ultima?.assinante || '', cargo: ultima?.cargo || 'Responsável Técnico Médico', crm: ultima?.crm || '',
  maiusculas: ultima ? ultima.maiusculas !== false : true, status: 'rascunho', criadoEm: agora, atualizadoEm: agora, emitidaEm: '',
 };
}

// ---------- Folha da CI (a mesma na prévia e no PDF) ----------
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
function campo(rotulo, valor) { const p = el('p', 'ci-campo'); p.append(el('span', '', `${rotulo}: `), el('strong', '', valor || '—')); return p; }

export function folhaCI(ci) {
 const folha = el('article', `ci-folha${ci.maiusculas !== false ? ' maiusculas' : ''}`);
 const moldura = el('div', 'ci-moldura');
 const topo = el('div', 'ci-topo');
 const titulo = el('div', 'ci-titulo');
 titulo.append(el('h1', '', 'PREFEITURA MUNICIPAL DE CUIABÁ'), el('h2', '', 'UNIDADE DE PRONTO ATENDIMENTO UPA SUL'));
 const gerado = el('div', 'ci-gerado');
 const agora = new Date();
 gerado.append(el('span', '', `Gerado: ${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`), el('span', '', `CI Nº ${numeroCI(ci)}`), el('span', '', `Usuário: ${(ci.assinante || '—').toUpperCase()}`));
 topo.append(titulo, gerado);
 const sub = el('div', 'ci-sub');
 sub.append(el('span', '', 'SECRETARIA MUNICIPAL DE SAUDE'), el('span', 'ci-data', `DATA: ${dataBR(ci.data)}`));
 const faixa = el('div', 'ci-faixa');
 faixa.append(el('strong', '', 'COMUNICAÇÃO INTERNA'), el('span', 'ci-num', `Nº ${numeroCI(ci)}`));
 const cab = el('div', 'ci-caixa ci-dados');
 cab.append(campo('DE', ci.de), campo('PARA', ci.para), campo('DATA', dataBR(ci.data)));
 const faixa2 = el('div', 'ci-faixa ci-faixa-fina', 'COMUNICAÇÃO');
 const assunto = el('div', 'ci-caixa ci-assunto');
 assunto.append(el('span', '', 'ASSUNTO: '), document.createTextNode(ci.assunto || '—'));
 const texto = el('div', 'ci-caixa ci-texto');
 texto.append(el('h3', '', 'TEXTO:'));
 for (const par of String(ci.corpo || '').split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean)) texto.append(el('p', '', par));
 if (ci.anexos?.trim()) { const a = el('p', 'ci-anexos'); a.append(el('strong', '', 'ANEXOS: '), document.createTextNode(ci.anexos.trim())); texto.append(a); }
 moldura.append(topo, sub, faixa, cab, faixa2, assunto, texto);
 const assinatura = el('div', 'ci-assinatura');
 assinatura.append(el('span', 'ci-linha'), el('strong', '', (ci.assinante || '').toUpperCase() || ' '), el('span', '', ci.cargo || ''), el('span', '', ci.crm ? `CRM - ${ci.crm.replace(/^CRM\s*-?\s*/i, '')}${/MT/i.test(ci.crm) ? '' : ' - MT'}` : ''));
 const rodape = el('footer', 'ci-rodape');
 rodape.append(el('span', '', ENDERECO[0]), el('span', '', ENDERECO[1]));
 folha.append(moldura, assinatura, el('div', 'ci-espaco'), rodape);
 return folha;
}

// PDF: só a folha vai para a impressão; o nome sugerido do arquivo vem do título da página.
export function imprimirCI(ci) {
 let alvo = document.querySelector('#ci-impressao');
 if (!alvo) { alvo = el('div'); alvo.id = 'ci-impressao'; document.body.append(alvo); }
 alvo.replaceChildren(folhaCI(ci));
 const tituloAntes = document.title;
 document.title = `CI ${String(ci.numero).padStart(3, '0')}-${ci.ano} - ${(ci.assunto || 'sem assunto').replace(/[\\/:*?"<>|]/g, '').slice(0, 80)}`;
 document.body.classList.add('imprimindo-ci');
 const fim = () => { document.body.classList.remove('imprimindo-ci'); document.title = tituloAntes; window.removeEventListener('afterprint', fim); };
 window.addEventListener('afterprint', fim);
 window.print();
 setTimeout(fim, 1500);
}

// ---------- Aba ----------
export function mountDocumentos(storage) {
 const painel = document.querySelector('#documentos-panel');
 if (!painel) return;
 painel.innerHTML = `
 <div class="doc-hero">
  <div><p class="eyebrow">DOCUMENTOS DA RT · UPA SUL</p><h2>Comunicações Internas</h2><p class="muted">Escreva a CI, confira a folha ao lado e gere o PDF no modelo da Prefeitura. Tudo fica guardado e numerado aqui.</p></div>
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
     <div class="doc-numero"><span>CI Nº</span><input name="numero" type="number" min="1" max="9999" required aria-label="Número da CI"><span>/</span><input name="ano" type="number" min="2000" max="2100" required aria-label="Ano da CI"></div>
     <span class="doc-status"></span><span class="doc-salvo muted" role="status" aria-live="polite"></span>
    </div>
    <p class="doc-aviso-num" hidden></p>
    <div class="doc-grade">
     <label>Data<input name="data" type="date" required></label>
     <label>Para<input name="para" list="doc-destinos" maxlength="300" required placeholder="Ex.: Direção Geral da UPA Sul"></label>
     <label class="doc-largo">De<input name="de" maxlength="300" required></label>
     <label class="doc-largo">Assunto<input name="assunto" maxlength="300" required placeholder="Resumo em uma linha"></label>
    </div>
    <datalist id="doc-destinos">${DESTINOS.map(d => `<option value="${d}"></option>`).join('')}</datalist>
    <label class="doc-corpo-label">Texto<textarea name="corpo" rows="14" maxlength="20000" placeholder="Escreva a comunicação. Cada parágrafo em uma linha."></textarea></label>
    <div class="doc-ajuda"><span class="doc-colchetes"></span><span class="doc-palavras muted"></span></div>
    <label>Anexos (opcional)<input name="anexos" maxlength="500" placeholder="Ex.: cópia da evolução do paciente de 01/10/2026"></label>
    <fieldset class="doc-assina"><legend>Assinatura</legend>
     <label>Nome<input name="assinante" maxlength="200" placeholder="Nome de quem assina"></label>
     <label>Cargo<input name="cargo" maxlength="200"></label>
     <label>CRM<input name="crm" maxlength="40" placeholder="Ex.: 12345"></label>
    </fieldset>
    <label class="doc-check"><input type="checkbox" name="maiusculas"> Texto em letras maiúsculas (como no prontuário)</label>
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
   ['Próximo número', `${String(proximoNumero(todas, ano)).padStart(3, '0')}/${ano}`, 'numeração automática'],
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
   topo.append(el('span', 'doc-item-num', numeroCI(ci)), el('span', `doc-pill ${ci.status}`, STATUS[ci.status] || ci.status), el('span', 'doc-item-data', dataBR(ci.data)));
   b.append(topo, el('strong', 'doc-item-assunto', ci.assunto || 'Sem assunto'), el('span', 'doc-item-para', `Para: ${ci.para || '—'}`));
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
  if (!aberta) {
   const ex = novaCI([], MODELOS[1]);
   escala.append(folhaCI({...ex, numero: 1, assinante: 'Responsável Técnico', crm: '00000'}));
  } else escala.append(folhaCI(aberta));
  ajustarEscala();
 }

 function avisos() {
  const outra = lista().find(c => c.id !== aberta.id && c.ano === aberta.ano && c.numero === aberta.numero);
  const aviso = $('.doc-aviso-num');
  aviso.hidden = !outra;
  if (outra) aviso.textContent = `⚠ Já existe a CI ${numeroCI(outra)} (“${outra.assunto || 'sem assunto'}”). Use o número ${proximoNumero(lista(), aberta.ano)}.`;
  const colchetes = (aberta.corpo.match(/\[[^\]]+\]/g) || []).length + (aberta.assunto.match(/\[[^\]]+\]/g) || []).length;
  $('.doc-colchetes').textContent = colchetes ? `Faltam ${colchetes} ${colchetes === 1 ? 'trecho' : 'trechos'} entre [colchetes] para completar` : '';
  const palavras = aberta.corpo.trim() ? aberta.corpo.trim().split(/\s+/).length : 0;
  $('.doc-palavras').textContent = `${palavras} ${palavras === 1 ? 'palavra' : 'palavras'}`;
  const st = $('.doc-status');
  st.className = `doc-status doc-pill ${aberta.status}`;
  st.textContent = aberta.status === 'emitida' ? `Emitida${aberta.emitidaEm ? ' em ' + dataBR(aberta.emitidaEm) : ''}` : 'Rascunho';
 }

 function preencher() {
  for (const nome of ['numero', 'ano', 'data', 'para', 'de', 'assunto', 'corpo', 'anexos', 'assinante', 'cargo', 'crm']) form.elements[nome].value = aberta[nome] ?? '';
  form.elements.maiusculas.checked = aberta.maiusculas !== false;
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
  // Leva o cursor ao primeiro [colchete] do texto (ou ao assunto, na CI em branco).
  const corpo = form.elements.corpo, i = aberta.corpo.indexOf('[');
  if (i >= 0) { corpo.focus(); corpo.setSelectionRange(i, aberta.corpo.indexOf(']', i) + 1); corpo.scrollTop = 0; }
  else (aberta.para ? form.elements.assunto : form.elements.para).focus();
 }

 form.addEventListener('input', () => {
  if (!aberta) return;
  for (const nome of ['data', 'para', 'de', 'assunto', 'corpo', 'anexos', 'assinante', 'cargo', 'crm']) aberta[nome] = form.elements[nome].value;
  for (const nome of ['numero', 'ano']) { const v = Number(form.elements[nome].value); if (Number.isInteger(v) && v > 0) aberta[nome] = v; }
  aberta.maiusculas = form.elements.maiusculas.checked;
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
  const copia = {...novaCI(lista()), para: aberta.para, de: aberta.de, assunto: aberta.assunto, corpo: aberta.corpo, anexos: aberta.anexos, assinante: aberta.assinante, cargo: aberta.cargo, crm: aberta.crm, maiusculas: aberta.maiusculas};
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
