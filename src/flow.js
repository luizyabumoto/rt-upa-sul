// Fluxo de pacientes: indicadores agregados da fila do Gestor Saúde (sem dados de pacientes).
// Consulta /api/fluxo a cada minuto enquanto a aba está visível e o painel ou o fluxo estão abertos.
const INTERVALO_MS = 60000;

export const formatarEspera = minutos => {
 if (minutos === null || minutos === undefined) return '—';
 if (minutos < 60) return `${minutos} min`;
 return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`;
};

export const tempoDesde = (iso, agora = Date.now()) => {
 if (!iso) return 'nunca';
 const segundos = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000));
 if (segundos < 60) return `há ${segundos} s`;
 const minutos = Math.round(segundos / 60);
 return minutos < 60 ? `há ${minutos} min` : `às ${new Date(iso).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
};

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

function tile(rotulo, valor, detalhe) {
 const box = el('div', 'flow-kpi');
 box.append(el('span', 'flow-kpi-label', rotulo), el('strong', 'flow-kpi-value', valor), el('small', '', detalhe || ''));
 return box;
}

// Tempo-alvo de espera do Protocolo de Manchester, por classificação (em minutos).
export const ALVO_MANCHESTER = {vermelho: 0, laranja: 10, amarelo: 60, verde: 120, azul: 240};

// Tons sóbrios das cores de Manchester para o fundo escuro; a cor original do Gestor Saúde fica de reserva.
const TOM = {vermelho: '#e5484d', laranja: '#f0883e', amarelo: '#e2b33c', roxo: '#a071e6', verde: '#3fb772', azul: '#4c8dea', preto: '#5b6474', cinza: '#8391a7'};

function riskCard(c) {
 const card = el('article', 'flow-risk');
 card.style.setProperty('--risk', TOM[c.chave] || c.cor);
 const alvo = ALVO_MANCHESTER[c.chave];
 const estourou = alvo !== undefined && c.maiorEspera !== null && c.maiorEspera > alvo;
 if (estourou) card.classList.add('flow-estourou');
 const head = el('div', 'flow-risk-head');
 head.append(el('span', 'flow-dot'), el('h3', '', c.nome.toUpperCase()), el('small', '', c.descricao));
 const count = el('p', 'flow-count');
 count.append(el('strong', '', String(c.aguardando)), document.createTextNode(' aguardando'));
 const maior = el('p', estourou ? 'flow-maior-alerta' : '');
 maior.textContent = `Maior espera: ${formatarEspera(c.maiorEspera)}` + (alvo !== undefined ? ` · alvo ${alvo === 0 ? 'imediato' : formatarEspera(alvo)}` : '');
 card.append(head, count, maior,
  el('p', '', `Média: ${formatarEspera(c.media)}`),
  el('small', 'flow-split', `Adulto ${c.adulto} · Pediatria ${c.pediatria}`));
 if (estourou) card.append(el('p', 'flow-estourou-nota', `⚠ Acima do tempo-alvo de Manchester`));
 return card;
}

// As cinco cores de Manchester aparecem sempre no Painel (mesmo com zero), na ordem de gravidade.
export const ORDEM_MANCHESTER = [['vermelho', 'Emergência'], ['laranja', 'Muito urgente'], ['amarelo', 'Urgente'], ['verde', 'Pouco urgente'], ['azul', 'Não urgente']];

// Situação de cada cor: 'vazio' (ninguém), 'ok', 'atencao' (passou de 75% do alvo) ou 'alerta' (passou do alvo).
export function situacaoRisco(c) {
 const alvo = ALVO_MANCHESTER[c.chave];
 if (!c.aguardando) return 'vazio';
 if (alvo === undefined || c.maiorEspera === null || c.maiorEspera === undefined) return 'ok';
 if (c.maiorEspera > alvo) return 'alerta';
 return alvo && c.maiorEspera >= alvo * 0.75 ? 'atencao' : 'ok';
}

export function coresDoPainel(classificacoes) {
 const porChave = new Map((classificacoes || []).map(c => [c.chave, c]));
 const fixas = ORDEM_MANCHESTER.map(([chave, descricao]) => ({chave, nome: chave[0].toUpperCase() + chave.slice(1), descricao, aguardando: 0, maiorEspera: null, media: null, adulto: 0, pediatria: 0, ...porChave.get(chave)}));
 const outras = (classificacoes || []).filter(c => !ORDEM_MANCHESTER.some(([k]) => k === c.chave) && c.aguardando);
 return [...fixas, ...outras];
}

// Painel: semáforo de Manchester. Número grande por cor, maior espera, barra até o tempo-alvo e pisca quando estoura.
function resumoPainel(summary, d, estado) {
 const cores = coresDoPainel(d.classificacoes);
 const estourados = cores.filter(c => situacaoRisco(c) === 'alerta');
 summary.classList.toggle('pm-em-alerta', estourados.length > 0);

 const topo = el('div', 'pm-topo');
 const total = el('div', 'pm-total');
 total.append(el('strong', 'pm-total-num', String(d.total.aguardando)), el('span', 'pm-total-txt', d.total.aguardando === 1 ? 'paciente aguardando médico' : 'pacientes aguardando médico'));
 const chips = el('div', 'pm-chips');
 const chip = (rotulo, valor, classe = '') => { const c = el('span', `pm-chip ${classe}`); c.append(el('span', '', rotulo), el('strong', '', valor)); return c; };
 chips.append(chip('Adulto', String(d.adulto.aguardando)), chip('Pediatria', String(d.pediatria.aguardando)), chip('Na triagem', String(d.triagem.aguardando)),
  chip('Maior espera', formatarEspera(d.total.maiorEspera), estourados.length ? 'pm-chip-alerta' : ''), chip('Média', formatarEspera(d.total.media)));
 topo.append(total, chips);

 const grade = el('div', 'pm-grade');
 for (const c of cores) {
  const alvo = ALVO_MANCHESTER[c.chave], sit = situacaoRisco(c);
  const card = el('article', `pm-cor pm-${sit}`);
  card.style.setProperty('--cor', TOM[c.chave] || c.cor || '#8391a7');
  card.setAttribute('aria-label', `${c.nome}: ${c.aguardando} aguardando${c.aguardando ? `, maior espera ${formatarEspera(c.maiorEspera)}` : ''}${sit === 'alerta' ? ', acima do tempo-alvo' : ''}`);
  const cab = el('div', 'pm-cor-cab');
  cab.append(el('span', 'pm-cor-nome', c.nome.toUpperCase()), el('span', 'pm-cor-desc', c.descricao || ''));
  const num = el('strong', 'pm-cor-num', String(c.aguardando));
  const info = el('div', 'pm-cor-info');
  if (c.aguardando) {
   info.append(el('span', '', `Maior espera ${formatarEspera(c.maiorEspera)}`), el('span', '', `Adulto ${c.adulto} · Ped ${c.pediatria}`));
  } else info.append(el('span', '', 'Ninguém aguardando'));
  card.append(cab, num, info);
  if (alvo !== undefined) {
   const barra = el('div', 'pm-barra'), cheio = el('span');
   const pct = !c.aguardando || c.maiorEspera === null ? 0 : alvo === 0 ? 100 : Math.min(100, Math.round(c.maiorEspera / alvo * 100));
   cheio.style.width = `${pct}%`;
   barra.append(cheio);
   card.append(barra, el('small', 'pm-alvo', sit === 'alerta' ? `⚠ Passou do alvo (${alvo === 0 ? 'imediato' : formatarEspera(alvo)})` : `Alvo ${alvo === 0 ? 'imediato' : formatarEspera(alvo)}`));
  }
  grade.append(card);
 }

 summary.append(topo);
 if (estourados.length) {
  summary.append(el('p', 'pm-faixa', `⚠ ALERTA · ${estourados.map(c => `${c.nome} ${formatarEspera(c.maiorEspera)}`).join(' · ')} — acima do tempo-alvo de Manchester`));
 }
 summary.append(grade, el('small', 'fs-rodape', `Atualizado ${tempoDesde(estado.atualizadoEm)} · abrir fluxo completo →`));
}

export function mountFlow() {
 const panel = document.querySelector('#flow-panel'), overview = document.querySelector('#overview-panel');
 if (!panel) return;
 panel.innerHTML = '<div class="section-heading"><div><p class="eyebrow">GESTOR SAÚDE · ATUALIZAÇÃO AUTOMÁTICA</p><h2>Fluxo de pacientes</h2></div><div class="actions"><span class="flow-updated" role="status" aria-live="polite">Carregando…</span><button type="button" class="secondary flow-refresh">Atualizar agora</button></div></div><p class="flow-alert" role="alert" hidden></p><div class="flow-kpis"></div><div class="flow-risks"></div><div class="flow-extra"></div><p class="notice">Conta como aguardando quem está com situação AGUARDANDO e ainda sem médico atribuído nos Consultórios Adulto e Pediátrico. O tempo corre desde o encaminhamento ao consultório (o mesmo do Gestor Saúde). Retornos e Box de Emergência não entram. Nenhum dado de paciente é exibido ou guardado.</p>';
 // Cartão clicável (div com papel de botão: um <button> não pode conter os blocos do resumo).
 const summary = el('div', 'flow-summary');
 summary.setAttribute('role', 'button'); summary.tabIndex = 0;
 summary.onclick = () => document.querySelector('[data-view="flow"]')?.click();
 summary.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); summary.click(); } };
 const lugar = overview?.querySelector('[data-slot="fluxo"]');
 if (lugar) lugar.append(summary); else overview?.prepend(summary);
 let estado = null, timer = null, carregando = false;

 const visivel = () => !document.hidden && (!panel.hidden || (overview && !overview.hidden));

 function render() {
  const updated = panel.querySelector('.flow-updated'), alerta = panel.querySelector('.flow-alert');
  if (!estado) { updated.textContent = 'Carregando…'; summary.textContent = 'Fluxo de pacientes · carregando…'; return; }
  updated.textContent = estado.atualizadoEm ? `Atualizado ${tempoDesde(estado.atualizadoEm)}` : 'Sem leitura ainda';
  alerta.hidden = estado.disponivel;
  if (!estado.disponivel) alerta.textContent = `Dados temporariamente indisponíveis: ${estado.erro || 'falha na leitura'}${estado.atualizadoEm ? ` Mostrando a última leitura válida (${tempoDesde(estado.atualizadoEm)}).` : ''}`;
  const d = estado.dados;
  summary.replaceChildren(el('span', 'eyebrow', 'PACIENTES NA UNIDADE · AGORA'));
  if (!d) { summary.append(el('strong', 'fs-num', estado.disponivel ? 'Sem dados' : 'Indisponível')); panel.querySelector('.flow-kpis').replaceChildren(); panel.querySelector('.flow-risks').replaceChildren(); panel.querySelector('.flow-extra').replaceChildren(); return; }
  summary.classList.toggle('stale', !estado.disponivel);
  resumoPainel(summary, d, estado);
  panel.querySelector('.flow-kpis').replaceChildren(
   tile('AGUARDANDO AGORA', String(d.total.aguardando), `Média ${formatarEspera(d.total.media)}`),
   tile('MAIOR ESPERA', formatarEspera(d.total.maiorEspera), 'adulto + pediatria'),
   tile('ADULTO', String(d.adulto.aguardando), `Maior ${formatarEspera(d.adulto.maiorEspera)} · ${d.adulto.emAtendimento} com médico`),
   tile('PEDIATRIA', String(d.pediatria.aguardando), `Maior ${formatarEspera(d.pediatria.maiorEspera)} · ${d.pediatria.emAtendimento} com médico`));
  const risks = panel.querySelector('.flow-risks');
  risks.replaceChildren(...d.classificacoes.map(riskCard));
  if (!d.classificacoes.length) risks.append(el('p', 'notice', 'Nenhum paciente aguardando atendimento médico agora.'));
  const extra = panel.querySelector('.flow-extra');
  extra.replaceChildren(
   el('span', '', `Aguardando triagem: ${d.triagem.aguardando}${d.triagem.aguardando ? ` · maior ${formatarEspera(d.triagem.maiorEspera)}` : ''}`),
   el('span', '', `Retornos pendentes: ${d.retornosPendentes} (não contam na espera)`));
  if (d.possiveisEsquecidos.quantidade) extra.append(el('span', 'flow-warn', `Possível registro esquecido (mais de 12 h aguardando): ${d.possiveisEsquecidos.quantidade} · maior ${formatarEspera(d.possiveisEsquecidos.maiorEspera)}`));
 }

 async function carregar(forcar = false) {
  if (carregando) return;
  carregando = true;
  const botao = panel.querySelector('.flow-refresh');
  botao.disabled = true;
  try {
   const resposta = await fetch('/api/fluxo' + (forcar ? '?atualizar=1' : ''), {cache: 'no-store'});
   if (resposta.status === 401) throw new Error('Sua sessão expirou. Entre novamente.');
   if (!resposta.ok) throw new Error('O servidor do RT UPA Sul não respondeu.');
   estado = await resposta.json();
  } catch (erro) {
   // Mantém os últimos números na tela e só marca como indisponível.
   estado = {...(estado || {dados: null, atualizadoEm: null}), disponivel: false, erro: erro.message};
  } finally {
   carregando = false;
   botao.disabled = false;
   render();
  }
 }

 function agendar() {
  clearInterval(timer);
  timer = setInterval(() => { if (visivel()) carregar(); }, INTERVALO_MS);
 }

 panel.querySelector('.flow-refresh').onclick = () => carregar(true);
 document.addEventListener('visibilitychange', () => {
  if (visivel() && (!estado?.atualizadoEm || Date.now() - Date.parse(estado.atualizadoEm) > INTERVALO_MS)) carregar();
 });
 for (const button of document.querySelectorAll('[data-view="flow"],[data-view="overview"]')) button.addEventListener('click', () => {
  if (!estado || Date.now() - Date.parse(estado.atualizadoEm || 0) > INTERVALO_MS) carregar();
 });
 setInterval(() => { if (visivel() && estado) render(); }, 5000);
 render();
 if (visivel()) carregar();
 agendar();
}
