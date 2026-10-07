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
  Ele encerra o atendimento aberto (Encerrar Atendimento, com o CID já registrado); não é alta clínica.
  Use <strong>Conferir</strong> antes: ele só lê o Gestor e mostra o que seria feito.</p>`;
 const $ = s => painel.querySelector(s);
 let carregando = false;

 function desenhar(dados) {
  const box = $('.bx-lista');
  box.replaceChildren();
  const lista = dados.candidatos || [];
  box.append(el('h3', '', lista.length ? `${lista.length} ${lista.length === 1 ? 'retorno aberto' : 'retornos abertos'} há mais de ${dados.horas} h` : `Nenhum retorno aberto há mais de ${dados.horas} h`));
  if (!lista.length) return;
  const tabela = el('table', 'grid');
  tabela.innerHTML = '<thead><tr><th><input type="checkbox" class="bx-todos" checked aria-label="Marcar todos"></th><th>Paciente</th><th>Tipo</th><th>Situação</th><th>Aberto há</th><th>Com profissional</th><th>Resultado</th></tr></thead>';
  const corpo = el('tbody');
  for (const c of lista) {
   const tr = el('tr');
   tr.dataset.id = c.id;
   const marca = el('input', 'bx-marca');
   marca.type = 'checkbox'; marca.checked = true; marca.dataset.id = c.id;
   const td0 = el('td'); td0.append(marca);
   tr.append(td0, el('td', '', c.primeiroNome || '—'), el('td', '', c.tipo), el('td', '', c.situacao), el('td', '', tempoAberto(c.minutos)), el('td', '', c.profissional || '—'), el('td', 'bx-res muted', ''));
   corpo.append(tr);
  }
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap');
  wrap.append(tabela);
  box.append(wrap);
  const conferir = el('button', 'secondary', 'Conferir (não altera nada)'); conferir.type = 'button';
  const dar = el('button', 'danger', 'Dar baixa nos marcados'); dar.type = 'button';
  const acoes = el('div', 'bx-acoes'); acoes.append(conferir, dar);
  box.append(el('p', 'muted', dados.conta ? `As baixas ficam registradas no Gestor como: ${dados.conta}` : ''), acoes);
  tabela.querySelector('.bx-todos').addEventListener('change', e => { for (const m of tabela.querySelectorAll('.bx-marca:not(:disabled)')) m.checked = e.target.checked; });
  conferir.addEventListener('click', () => executar(true, [conferir, dar]));
  dar.addEventListener('click', () => {
   const n = painel.querySelectorAll('.bx-marca:checked').length;
   if (!n) return;
   if (!confirm(`Encerrar ${n} ${n === 1 ? 'atendimento de retorno' : 'atendimentos de retorno'} no Gestor Saúde?\n\nFica registrado na sua conta e não volta com um clique.`)) return;
   executar(false, [conferir, dar]);
  });
 }

 // Um paciente por vez: mostra o andamento e nunca estoura o tempo do servidor.
 async function executar(simular, botoes) {
  const marcados = [...painel.querySelectorAll('.bx-marca:checked')];
  botoes.forEach(b => { b.disabled = true; });
  let feitos = 0, falhas = 0;
  for (const m of marcados) {
   const res = painel.querySelector(`tr[data-id="${m.dataset.id}"] .bx-res`);
   res.className = 'bx-res muted';
   res.textContent = simular ? 'Conferindo…' : 'Encerrando…';
   try {
    const r = await fetch('/api/baixas/encerrar', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: Number(m.dataset.id), simular})});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Falhou.');
    res.textContent = d.mensagem || (d.ok ? 'OK' : 'Falhou');
    res.className = `bx-res ${d.ok ? 'bx-ok' : 'bx-erro'}`;
    if (d.ok) {
     feitos++;
     if (!simular) { m.checked = false; m.disabled = true; }
    } else falhas++;
   } catch (erro) {
    res.textContent = erro.message; res.className = 'bx-res bx-erro'; falhas++;
   }
  }
  botoes.forEach(b => { b.disabled = false; });
  const alerta = $('.bx-alerta');
  alerta.textContent = simular
   ? `Conferência: ${feitos} prontos para encerrar${falhas ? `, ${falhas} com problema (veja a coluna Resultado)` : ''}. Nada foi alterado.`
   : `${feitos} ${feitos === 1 ? 'atendimento encerrado' : 'atendimentos encerrados'}${falhas ? `, ${falhas} não encerrados (veja a coluna Resultado)` : ''}.`;
  alerta.hidden = false;
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
