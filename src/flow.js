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

function riskCard(c) {
 const card = el('article', 'flow-risk');
 card.style.setProperty('--risk', c.cor);
 const head = el('div', 'flow-risk-head');
 head.append(el('span', 'flow-dot'), el('h3', '', c.nome.toUpperCase()), el('small', '', c.descricao));
 const count = el('p', 'flow-count');
 count.append(el('strong', '', String(c.aguardando)), document.createTextNode(' aguardando'));
 card.append(head, count,
  el('p', '', `Maior espera: ${formatarEspera(c.maiorEspera)}`),
  el('p', '', `Média: ${formatarEspera(c.media)}`),
  el('small', 'flow-split', `Adulto ${c.adulto} · Pediatria ${c.pediatria}`));
 return card;
}

export function mountFlow() {
 const panel = document.querySelector('#flow-panel'), overview = document.querySelector('#overview-panel');
 if (!panel) return;
 panel.innerHTML = '<div class="section-heading"><div><p class="eyebrow">GESTOR SAÚDE · ATUALIZAÇÃO AUTOMÁTICA</p><h2>Fluxo de pacientes</h2></div><div class="actions"><span class="flow-updated" role="status" aria-live="polite">Carregando…</span><button type="button" class="secondary flow-refresh">Atualizar agora</button></div></div><p class="flow-alert" role="alert" hidden></p><div class="flow-kpis"></div><div class="flow-risks"></div><div class="flow-extra"></div><p class="notice">Conta como aguardando quem está com situação AGUARDANDO e ainda sem médico atribuído nos Consultórios Adulto e Pediátrico. O tempo corre desde o encaminhamento ao consultório (o mesmo do Gestor Saúde). Retornos e Box de Emergência não entram. Nenhum dado de paciente é exibido ou guardado.</p>';
 const summary = el('button', 'flow-summary');
 summary.type = 'button';
 summary.onclick = () => document.querySelector('[data-view="flow"]')?.click();
 overview?.prepend(summary);
 let estado = null, timer = null, carregando = false;

 const visivel = () => !document.hidden && (!panel.hidden || (overview && !overview.hidden));

 function render() {
  const updated = panel.querySelector('.flow-updated'), alerta = panel.querySelector('.flow-alert');
  if (!estado) { updated.textContent = 'Carregando…'; summary.textContent = 'Fluxo de pacientes · carregando…'; return; }
  updated.textContent = estado.atualizadoEm ? `Atualizado ${tempoDesde(estado.atualizadoEm)}` : 'Sem leitura ainda';
  alerta.hidden = estado.disponivel;
  if (!estado.disponivel) alerta.textContent = `Dados temporariamente indisponíveis: ${estado.erro || 'falha na leitura'}${estado.atualizadoEm ? ` Mostrando a última leitura válida (${tempoDesde(estado.atualizadoEm)}).` : ''}`;
  const d = estado.dados;
  summary.replaceChildren(el('span', 'eyebrow', 'FLUXO DE PACIENTES AGORA'));
  if (!d) { summary.append(el('strong', '', estado.disponivel ? 'Sem dados' : 'Indisponível')); panel.querySelector('.flow-kpis').replaceChildren(); panel.querySelector('.flow-risks').replaceChildren(); panel.querySelector('.flow-extra').replaceChildren(); return; }
  summary.classList.toggle('stale', !estado.disponivel);
  summary.append(el('strong', '', `${d.total.aguardando} aguardando`), el('span', '', `Maior espera ${formatarEspera(d.total.maiorEspera)} · Adulto ${d.adulto.aguardando} · Pediatria ${d.pediatria.aguardando}`), el('small', '', `Atualizado ${tempoDesde(estado.atualizadoEm)} · abrir fluxo →`));
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
