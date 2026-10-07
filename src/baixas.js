// Aba Baixas: retornos (adulto/pediátrico) esquecidos abertos no Gestor Saúde há mais de X horas.
// Por enquanto só lista; o encerramento entra quando a chamada do Gestor for confirmada.
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };

export function tempoAberto(minutos) {
 const d = Math.floor(minutos / 1440), h = Math.floor((minutos % 1440) / 60);
 return d ? `${d} ${d === 1 ? 'dia' : 'dias'}${h ? ` e ${h} h` : ''}` : `${h} h`;
}

export function mountBaixas() {
 const painel = document.querySelector('#baixas-panel');
 if (!painel) return;
 painel.innerHTML = `
 <div class="int-hero">
  <div><p class="eyebrow">GESTOR SAÚDE · RETORNOS ABERTOS</p><h2>Baixas de retorno</h2>
   <p class="int-sub muted">Pacientes em Retorno Adulto ou Pediátrico com atendimento aberto além do tempo escolhido.</p></div>
  <div class="int-hero-acoes">
   <label>Abertos há mais de<select class="bx-horas"><option value="24">24 horas</option><option value="48">48 horas</option><option value="72" selected>72 horas</option></select></label>
   <button type="button" class="secondary bx-atualizar">↻ Atualizar</button></div>
 </div>
 <p class="flow-alert bx-alerta" role="alert" hidden></p>
 <section class="int-cartao bx-lista"></section>
 <p class="muted bx-aviso">O encerramento será feito com a conta do Gestor configurada no site e ficará registrado nela.
  Ele encerra o atendimento aberto; não é alta clínica. O botão de dar baixa será liberado depois que a chamada do Gestor for conferida.</p>`;
 const $ = s => painel.querySelector(s);
 let carregando = false;

 function desenhar(dados) {
  const box = $('.bx-lista');
  box.replaceChildren();
  const lista = dados.candidatos || [];
  box.append(el('h3', '', lista.length ? `${lista.length} ${lista.length === 1 ? 'retorno aberto' : 'retornos abertos'} há mais de ${dados.horas} h` : `Nenhum retorno aberto há mais de ${dados.horas} h`));
  if (!lista.length) return;
  const tabela = el('table', 'grid');
  tabela.innerHTML = '<thead><tr><th>Paciente</th><th>Tipo</th><th>Situação</th><th>Aberto há</th><th>Com profissional</th></tr></thead>';
  const corpo = el('tbody');
  for (const c of lista) {
   const tr = el('tr');
   tr.append(el('td', '', c.primeiroNome || '—'), el('td', '', c.tipo), el('td', '', c.situacao), el('td', '', tempoAberto(c.minutos)), el('td', '', c.profissional || '—'));
   corpo.append(tr);
  }
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap');
  wrap.append(tabela);
  box.append(wrap);
 }

 async function carregar() {
  if (carregando) return;
  carregando = true;
  const alerta = $('.bx-alerta');
  alerta.hidden = true;
  $('.bx-lista').replaceChildren(el('p', 'muted', 'Lendo o Gestor Saúde…'));
  try {
   const r = await fetch(`/api/baixas?horas=${$('.bx-horas').value}`, {cache: 'no-store'});
   const dados = await r.json().catch(() => ({}));
   if (!r.ok) throw new Error(dados.error || 'O Gestor Saúde não respondeu.');
   desenhar(dados);
  } catch (erro) {
   $('.bx-lista').replaceChildren();
   alerta.textContent = erro.message;
   alerta.hidden = false;
  } finally { carregando = false; }
 }

 $('.bx-atualizar').addEventListener('click', carregar);
 $('.bx-horas').addEventListener('change', carregar);
 // Carrega na primeira vez que a aba fica visível.
 new MutationObserver(() => { if (!painel.hidden && !painel.dataset.lido) { painel.dataset.lido = '1'; carregar(); } })
  .observe(painel, {attributes: true, attributeFilter: ['hidden']});
}
