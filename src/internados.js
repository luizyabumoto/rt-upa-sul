// Aba Internados: censo do NIR (planilha publicada) + evolução médica do Gestor Saúde.
// Só leito, idade, dias de internação, hipótese/CID e situação: nome, CPF, CNS e SISREG nunca chegam aqui.
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const svgNS = 'http://www.w3.org/2000/svg';
const hora = iso => new Date(iso).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit', timeZone: 'America/Cuiaba'});
// Hipótese sem o código repetido no fim ("… - I509"), em letras minúsculas.
export const hipoteseSemCodigo = h => String(h || '').replace(/\s*-\s*[A-Z]\d{2,3}\.?\d?\s*$/i, '').toLowerCase();
const nomeCurto = m => String(m || '').split(/\s+/).slice(0, 2).join(' ');

// Tempo de internação em faixas: o que mais importa para a RT acompanhar.
export function faixaDias(dias) {
 if (dias === null || dias === undefined) return 'sem';
 if (dias > 10) return 'critico';
 if (dias > 5) return 'alto';
 if (dias >= 3) return 'medio';
 return 'ok';
}
export const textoDias = d => d === null || d === undefined ? 'sem data' : d === 0 ? 'internou hoje' : `${d} ${d === 1 ? 'dia' : 'dias'}`;
export function textoEvolucao(p) {
 if (p.evolucao === 'sem-idade') return 'Sem idade na planilha: não dá para conferir a evolução';
 if (!p.ultimaEvolucao) return p.evolucao === 'em-dia' ? 'Admitido hoje' : 'Nenhuma evolução médica nas últimas 36 h';
 const h = p.horasSemEvolucao;
 const quando = h < 1 ? `há ${Math.max(1, Math.round(h * 60))} min` : `há ${Math.round(h)} h`;
 return `Última evolução ${quando} (${hora(p.ultimaEvolucao)})${p.medicoEvolucao ? ' · ' + nomeCurto(p.medicoEvolucao) : ''}`;
}
// Ordem natural dos leitos: M1, M2… M-ISO; BX1…BX6.
const ordemLeito = l => { const m = String(l).match(/(\d+)/); return [String(l).replace(/[\d-]/g, ''), m ? Number(m[1]) : 99, l]; };
const comparaLeito = (a, b) => { const x = ordemLeito(a.leito), y = ordemLeito(b.leito); return x[0].localeCompare(y[0]) || x[1] - y[1] || x[2].localeCompare(y[2]); };

// Desenho da maca (Box) e da cama (enfermaria). A cor vem do CSS (ocupado / vago / bloqueado).
function desenho(tipo) {
 const s = document.createElementNS(svgNS, 'svg');
 s.setAttribute('viewBox', '0 0 120 72'); s.setAttribute('aria-hidden', 'true'); s.classList.add('int-desenho');
 s.innerHTML = tipo === 'berco'
  ? '<path class="int-mobile" d="M60 2v6M44 8h32" stroke-width="1.6" fill="none"/><path class="int-estrela" d="M44 9l1.6 3.2 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4-2.5-2.4 3.4-.5zM76 9l1.6 3.2 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4-2.5-2.4 3.4-.5z"/><rect class="int-colchao" x="18" y="42" width="84" height="10" rx="4"/><rect class="int-travesseiro" x="21" y="35" width="18" height="8" rx="4"/><rect class="int-lencol" x="44" y="38" width="55" height="10" rx="5"/><rect class="int-estrutura" x="12" y="24" width="96" height="4" rx="2"/><rect class="int-estrutura" x="12" y="52" width="96" height="4" rx="2"/><path class="int-estrutura" d="M24 28v24M34 28v24M44 28v24M54 28v24M64 28v24M74 28v24M84 28v24M94 28v24" stroke-width="2" fill="none" opacity=".7"/><rect class="int-estrutura" x="10" y="20" width="6" height="46" rx="3"/><rect class="int-estrutura" x="104" y="20" width="6" height="46" rx="3"/>'
  : tipo === 'box'
  ? '<rect class="int-estrutura" x="8" y="40" width="104" height="5" rx="2"/><rect class="int-colchao" x="10" y="26" width="100" height="14" rx="6"/><rect class="int-travesseiro" x="14" y="19" width="24" height="10" rx="5"/><path class="int-estrutura" d="M20 45v14M100 45v14M60 45v10" stroke-width="4" stroke-linecap="round" fill="none"/><circle class="int-roda" cx="20" cy="63" r="5"/><circle class="int-roda" cx="100" cy="63" r="5"/><path class="int-grade" d="M44 24h56" stroke-width="3" stroke-linecap="round" fill="none"/>'
  : '<rect class="int-estrutura" x="6" y="12" width="7" height="50" rx="3"/><rect class="int-estrutura" x="107" y="30" width="7" height="32" rx="3"/><rect class="int-colchao" x="12" y="32" width="96" height="16" rx="5"/><rect class="int-travesseiro" x="16" y="24" width="26" height="11" rx="5"/><rect class="int-lencol" x="46" y="30" width="62" height="18" rx="4"/><rect class="int-estrutura" x="12" y="48" width="96" height="5" rx="2"/>';
 return s;
}

export function mountInternados() {
 const painel = document.querySelector('#internados-panel');
 if (!painel) return;
 painel.innerHTML = `
 <div class="int-hero">
  <div><p class="eyebrow">CENSO DO NIR · EVOLUÇÃO NO GESTOR SAÚDE</p><h2>Pacientes internados</h2>
   <p class="int-sub muted">Leito, idade, CID e tempo de internação, sem nenhum dado de identificação do paciente.</p></div>
  <div class="int-hero-acoes"><span class="int-lido muted" role="status" aria-live="polite"></span><button type="button" class="secondary int-atualizar">↻ Atualizar</button></div>
 </div>
 <p class="flow-alert int-alerta" role="alert" hidden></p>
 <div class="int-kpis"></div>
 <div class="int-visitas"></div>
 <div class="int-mapas"></div>
 <div class="int-duas"><section class="int-cartao int-cids"></section><section class="int-cartao int-espera"></section></div>
 <section class="int-cartao int-tabela-box"></section>
 <div class="int-tip" role="tooltip" hidden></div>`;
 const $ = s => painel.querySelector(s);
 // A dica e a ficha ficam no corpo da página (posição fixa na tela), para nunca abrirem fora da área visível.
 const tip = $('.int-tip');
 document.body.append(tip);
 const ficha = el('dialog', 'int-ficha');
 document.body.append(ficha);
 let dados = null, carregando = false;

 // ---------- Tooltip (mouse, teclado e toque)
 function mostrarTip(alvo, p, leito) {
  tip.replaceChildren();
  const cab = el('div', 'int-tip-cab');
  cab.append(el('strong', '', `Leito ${leito.leito}`), el('span', `int-pill ${p ? 'ocupado' : leito.bloqueado ? 'bloqueado' : 'vago'}`, p ? 'Ocupado' : leito.bloqueado ? 'Bloqueado' : 'Vago'));
  tip.append(cab);
  if (p) {
   tip.append(el('p', 'int-tip-idade', `${p.idade !== null ? p.idade + ' anos' : 'Idade não informada'}${p.sexo ? ' · ' + (p.sexo === 'M' ? 'masculino' : 'feminino') : ''}`));
   const dias = el('p', `int-tip-dias ${faixaDias(p.dias)}`); dias.append(el('strong', '', textoDias(p.dias)), document.createTextNode(p.internacao ? ` de internação · desde ${p.internacao.split('-').reverse().join('/')}` : ' de internação'));
   tip.append(dias);
   const cid = el('p', 'int-tip-cid');
   cid.append(el('strong', '', p.cid ? `CID ${p.cid}${p.cidProvavel ? ' (provável)' : ''}` : 'Sem CID'), document.createTextNode(p.hipotese ? ` · ${hipoteseSemCodigo(p.hipotese)}` : ''));
   tip.append(cid);
   if (p.especialidade) tip.append(el('p', '', `${p.uti ? '🛏 Aguarda ' + p.uti : 'Especialidade: ' + p.especialidade.toLowerCase()}${p.regulado ? ' · regulado' : ''}`));
   if (p.situacao) tip.append(el('p', 'int-tip-obs', p.situacao));
   if (p.evolucao) tip.append(el('p', `int-tip-evo ${p.evolucao}`, textoEvolucao(p)));
  } else tip.append(el('p', 'muted', leito.bloqueado ? 'Leito bloqueado na planilha.' : 'Leito livre para receber paciente.'));
  tip.hidden = false;
  const r = alvo.getBoundingClientRect(), t = tip.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
  // Ao lado do leito quando há espaço; senão acima ou abaixo — sempre dentro da tela.
  let x, y;
  if (r.right + t.width + 14 <= vw) { x = r.right + 10; y = r.top + r.height / 2 - t.height / 2; }
  else if (r.left - t.width - 14 >= 0) { x = r.left - t.width - 10; y = r.top + r.height / 2 - t.height / 2; }
  else { x = r.left + r.width / 2 - t.width / 2; y = r.top - t.height - 10 >= 8 ? r.top - t.height - 10 : r.bottom + 10; }
  tip.style.left = `${Math.min(vw - t.width - 8, Math.max(8, x))}px`;
  tip.style.top = `${Math.min(vh - t.height - 8, Math.max(8, y))}px`;
 }
 const esconderTip = () => { tip.hidden = true; };

 // Ficha do leito (clique): tudo o que se sabe do paciente e as evoluções médicas recentes.
 function abrirFicha(p, leito) {
  ficha.replaceChildren();
  const cab = el('div', 'int-ficha-cab');
  const tit = el('div');
  tit.append(el('p', 'eyebrow', `${leito.categoria === 'box' ? 'BOX DE EMERGÊNCIA' : leito.setor.toUpperCase()}`), el('h2', '', `Leito ${leito.leito}`));
  const fechar = el('button', 'secondary int-ficha-fechar', '✕'); fechar.type = 'button'; fechar.setAttribute('aria-label', 'Fechar'); fechar.onclick = () => ficha.close();
  cab.append(tit, el('span', `int-pill ${p ? 'ocupado' : leito.bloqueado ? 'bloqueado' : 'vago'}`, p ? 'Ocupado' : leito.bloqueado ? 'Bloqueado' : 'Livre'), fechar);
  ficha.append(cab);
  if (!p) { ficha.append(el('p', 'muted', leito.bloqueado ? 'Leito bloqueado na planilha do NIR.' : 'Leito livre para receber paciente.')); ficha.showModal(); return; }
  const destaque = el('div', 'int-ficha-destaque');
  const dias = el('div', `int-ficha-dias ${faixaDias(p.dias)}`); dias.append(el('strong', '', p.dias ?? '—'), el('span', '', p.dias === 1 ? 'dia internado' : 'dias internado'));
  const idade = el('div', 'int-ficha-idade'); idade.append(el('strong', '', p.idade ?? '—'), el('span', '', `anos${p.sexo ? ' · ' + (p.sexo === 'M' ? 'masc.' : 'fem.') : ''}`));
  destaque.append(dias, idade);
  ficha.append(destaque);
  const dl = el('dl', 'int-ficha-dados');
  const item = (rotulo, valor) => { if (!valor) return; dl.append(el('dt', '', rotulo), el('dd', '', valor)); };
  item('Internação', p.internacao ? `desde ${p.internacao.split('-').reverse().join('/')}` : 'data não informada');
  item('CID', p.cid ? `${p.cid}${p.cidProvavel ? ' (provável, pelo texto)' : ''}${p.capitulo ? ' · ' + p.capitulo : ''}` : 'sem CID na hipótese');
  item('Hipótese', hipoteseSemCodigo(p.hipotese));
  item('Aguarda', p.uti || (p.especialidade && !p.observacao ? p.especialidade.toLowerCase() : ''));
  item('Regulação', p.especialidade && !p.observacao ? (p.regulado ? 'com número no SISREG' : 'sem número no SISREG') : '');
  item('Observação do NIR', p.situacao);
  ficha.append(dl);
  const evo = el('section', `int-ficha-evo ${p.evolucao || ''}`);
  evo.append(el('h3', '', 'Evolução médica'));
  if (!p.evolucao) evo.append(el('p', 'muted', 'Conferência da evolução indisponível agora (Gestor Saúde).'));
  else {
   evo.append(el('p', `int-tip-evo ${p.evolucao}`, (p.evolucao === 'em-dia' ? '✓ Em dia · ' : p.evolucao === 'pendente' ? '⚠ Pendente · ' : '') + textoEvolucao(p)));
   const lista = p.evolucoesRecentes || [];
   if (lista.length) {
    const ol = el('ol', 'int-ficha-linha');
    for (const e of lista) { const li = el('li'); const d = new Date(e.momento); li.append(el('strong', '', `${d.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})} ${hora(e.momento)}`), el('span', '', nomeCurto(e.medico) || '—'), el('small', 'muted', e.setor === 'box' ? 'Box' : 'enfermaria')); ol.append(li); }
    evo.append(el('p', 'int-ficha-sub', 'Evoluções nas últimas 36 h'), ol);
   }
   evo.append(el('small', 'muted', 'O texto da evolução fica no prontuário do Gestor Saúde; aqui aparecem quando e por quem foi feita. A ligação com o leito é pela idade do paciente.'));
  }
  if (p.resumo) {
   const r = p.resumo, sec = el('section', 'int-ficha-resumo');
   sec.append(el('h3', '', 'Resumo da última evolução médica'));
   if (p.resumoEm || p.resumoMedico) sec.append(el('p', 'muted', [p.resumoEm ? `${new Date(p.resumoEm).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit'})} ${hora(p.resumoEm)}` : '', nomeCurto(p.resumoMedico)].filter(Boolean).join(' · ')));
   const bloco = (titulo, itens, cls = '') => { if (!itens?.length) return; sec.append(el('p', 'int-ficha-sub', titulo)); const ul = el('ul', cls); for (const x of itens) ul.append(el('li', '', x)); sec.append(ul); };
   bloco('Hipóteses', r.hipoteses);
   bloco('Pendente / aguardando', r.pendencias, 'pendente');
   bloco('Conduta', r.conduta.filter(c => !r.pendencias.includes(c)));
   if (r.antibioticos?.length) sec.append(el('p', '', `💊 ${r.antibioticos.join(' · ')}`));
   const v = Object.entries(r.vitais || {}).map(([k, x]) => `${k} ${x}`).join(' · ');
   if (v) sec.append(el('p', 'muted', `Sinais vitais: ${v}`));
   if (r.comorbidades) sec.append(el('p', 'muted', `Comorbidades: ${r.comorbidades}`));
   if (r.estado) sec.append(el('p', 'int-ficha-estado', r.estado));
   ficha.append(sec);
  }
  ficha.append(evo);
  ficha.showModal();
 }
 ficha.addEventListener('click', e => { if (e.target === ficha) ficha.close(); });
 document.addEventListener('scroll', esconderTip, {passive: true});

 function leitoBotao(leito, p, tipo, i) {
  const b = el('button', `int-leito ${p ? 'ocupado' : leito.bloqueado ? 'bloqueado' : 'vago'} ${p ? 'dias-' + faixaDias(p.dias) : ''} ${p?.evolucao === 'pendente' ? 'sem-evolucao' : ''}`);
  b.type = 'button';
  b.style.setProperty('--i', i);
  b.setAttribute('aria-label', p ? `Leito ${leito.leito}, ocupado, ${p.idade ?? '?'} anos, ${textoDias(p.dias)}${p.cid ? ', CID ' + p.cid : ''}` : `Leito ${leito.leito}, ${leito.bloqueado ? 'bloqueado' : 'vago'}`);
  const topo = el('span', 'int-leito-topo');
  topo.append(el('strong', '', leito.leito), el('span', 'int-leito-dot'));
  b.append(topo, desenho(tipo));
  const rod = el('span', 'int-leito-rod');
  if (p) {
   rod.append(el('span', '', p.idade !== null ? `${p.idade}a` : '—'), el('span', `int-dias ${faixaDias(p.dias)}`, p.dias === null ? '?' : `${p.dias}d`));
   if (p.evolucao === 'pendente') rod.append(el('span', 'int-evo-alerta', '!'));
  } else rod.append(el('span', 'muted', leito.bloqueado ? 'bloqueado' : 'livre'));
  b.append(rod);
  if (p?.resumo?.frase) { b.classList.add('com-resumo'); b.append(el('span', 'int-leito-resumo', p.resumo.hipoteses?.[0] || p.resumo.frase)); }
  for (const ev of ['mouseenter', 'focus']) b.addEventListener(ev, () => mostrarTip(b, p, leito));
  for (const ev of ['mouseleave', 'blur']) b.addEventListener(ev, esconderTip);
  b.addEventListener('click', () => { esconderTip(); abrirFicha(p, leito); });
  return b;
 }

 function anel(feitos, total, rotulo) {
  const pct = total ? feitos / total : 1, R = 30, C = 2 * Math.PI * R;
  const s = document.createElementNS(svgNS, 'svg');
  s.setAttribute('viewBox', '0 0 76 76'); s.classList.add('int-anel');
  s.innerHTML = `<circle cx="38" cy="38" r="${R}" class="int-anel-fundo"/><circle cx="38" cy="38" r="${R}" class="int-anel-valor ${pct >= 1 ? 'ok' : pct >= .5 ? 'medio' : 'ruim'}" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="--alvo:${C * (1 - pct)}"/><text x="38" y="43" text-anchor="middle">${total ? Math.round(pct * 100) : 100}%</text>`;
  s.setAttribute('role', 'img'); s.setAttribute('aria-label', `${rotulo}: ${feitos} de ${total}`);
  return s;
 }

 function render() {
  if (!dados) return;
  const r = dados.resumo, pacientes = dados.pacientes || [], leitos = dados.leitos || [];
  $('.int-lido').textContent = dados.lidoEm ? `Planilha lida às ${hora(dados.lidoEm)}` : '';
  const alerta = $('.int-alerta');
  alerta.hidden = dados.disponivel;
  if (!dados.disponivel) alerta.textContent = `Não foi possível ler a planilha agora: ${dados.erro || 'falha na leitura'}${r ? ' Mostrando a última leitura.' : ''}`;
  if (!r) { $('.int-kpis').replaceChildren(el('p', 'empty-state', 'Lendo o censo da unidade…')); return; }

  // ---------- Números principais
  const kpi = (rotulo, valor, detalhe, tom = '', barra = null) => {
   const k = el('div', `int-kpi ${tom}`);
   k.append(el('span', 'int-kpi-rotulo', rotulo), el('strong', 'int-kpi-valor', String(valor)), el('small', '', detalhe));
   if (barra) { const b = el('div', 'int-barra'); const f = el('span'); f.style.setProperty('--w', `${Math.min(100, barra * 100)}%`); b.append(f); k.append(b); }
   return k;
  };
  const enf = r.enfermaria, box = r.box;
  $('.int-kpis').replaceChildren(
   kpi('INTERNADOS AGORA', r.internados, `${enf.ocupados} enfermaria · ${box.ocupados} Box${r.pediatria.ocupados ? ` · ${r.pediatria.ocupados} pediatria` : ''}`),
   kpi('ENFERMARIA ADULTO', `${enf.ocupados}/${enf.capacidade}`, enf.excedente ? `${enf.excedente} acima da capacidade` : `${enf.livres} ${enf.livres === 1 ? 'leito livre' : 'leitos livres'}`, enf.livres ? '' : 'alerta', enf.ocupados / enf.capacidade),
   kpi('BOX DE EMERGÊNCIA', `${box.ocupados}/${box.capacidade}`, box.excedente ? `${box.excedente} acima da capacidade` : `${box.livres} ${box.livres === 1 ? 'maca livre' : 'macas livres'}`, box.livres ? box.livres === 1 ? 'aviso' : '' : 'alerta', box.ocupados / box.capacidade),
   kpi('AGUARDANDO LEITO', r.aguardandoLeito, `${r.aguardandoUti} para UTI${r.semSisreg ? ` · ${r.semSisreg} sem SISREG` : ''}`, r.aguardandoUti ? 'aviso' : ''),
   kpi('TEMPO DE INTERNAÇÃO', r.mediaDias !== null ? `${String(r.mediaDias).replace('.', ',')} d` : '—', `média · maior ${r.maiorDias ?? '—'} dias`, r.maiorDias > 10 ? 'alerta' : r.maiorDias > 5 ? 'aviso' : ''),
   kpi('MAIS DE 5 DIAS', r.acima5dias, r.acima10dias ? `${r.acima10dias} com mais de 10 dias` : 'nenhum acima de 10 dias', r.acima10dias ? 'alerta' : r.acima5dias ? 'aviso' : 'ok'));

  // ---------- Visita / evolução do dia
  const vis = $('.int-visitas');
  vis.replaceChildren();
  const evo = dados.evolucao || {};
  if (evo.disponivel && evo.visitas) {
   const cartao = (titulo, g, regra) => {
    const c = el('div', `int-visita ${g.pendentes ? 'pendente' : 'ok'}`);
    const txt = el('div');
    txt.append(el('span', 'int-kpi-rotulo', titulo), el('strong', 'int-visita-num', g.pendentes ? `Faltam ${g.pendentes}` : g.total ? 'Tudo em dia' : 'Sem pacientes'),
     el('small', '', `${g.emDia} de ${g.total} ${regra}${g.semIdade ? ` · ${g.semIdade} sem idade na planilha` : ''}`));
    c.append(anel(g.emDia, g.total, titulo), txt);
    return c;
   };
   const pend = pacientes.filter(p => p.evolucao === 'pendente').sort(comparaLeito);
   const lista = el('div', 'int-visita-lista');
   lista.append(el('span', 'int-kpi-rotulo', 'SEM EVOLUÇÃO'));
   if (!pend.length) lista.append(el('p', 'muted', 'Todos os leitos com evolução em dia.'));
   for (const p of pend) { const chip = el('span', `int-chip ${p.categoria === 'box' ? 'box' : ''}`); chip.append(el('strong', '', p.leito), document.createTextNode(` ${p.idade ?? '?'}a · ${p.ultimaEvolucao ? `há ${Math.round(p.horasSemEvolucao)} h` : 'sem evolução'}`)); lista.append(chip); }
   vis.append(cartao('VISITA DA ENFERMARIA', evo.visitas.enfermaria, `visitados desde as 07h`), cartao('EVOLUÇÃO DO BOX', evo.visitas.box, 'evoluídos nas últimas 12 h'), lista);
  } else {
   const aviso = el('div', 'int-visita indisponivel');
   aviso.append(el('span', 'int-visita-icone', 'ⓘ'), el('p', '', `Conferência da evolução médica indisponível agora${evo.erro ? `: ${evo.erro.replace(/\.$/, '')}` : ''}. O censo da planilha continua abaixo.`));
   vis.append(aviso);
  }

  // ---------- Mapa de leitos (Box em destaque, depois as enfermarias)
  const mapas = $('.int-mapas');
  mapas.replaceChildren();
  const ocupante = l => pacientes.find(p => p.leito === l.leito && p.categoria === l.categoria);
  const grupos = [['box', 'Box de emergência', 'box'], ['enfermaria', 'Enfermaria adulto', 'cama'], ['pediatria', 'Enfermaria pediátrica', 'berco']];
  let i = 0;
  for (const [cat, titulo, tipo] of grupos) {
   const doGrupo = leitos.filter(l => l.categoria === cat);
   if (!doGrupo.length) continue;
   const sec = el('section', `int-cartao int-mapa ${cat}`);
   const cab = el('div', 'int-mapa-cab');
   const ocup = doGrupo.filter(l => ocupante(l)).length;
   cab.append(el('h3', '', titulo), el('span', 'int-mapa-conta', `${ocup} ocupados · ${doGrupo.length - ocup} livres`));
   sec.append(cab);
   const setores = [...new Set(doGrupo.map(l => l.setor))];
   for (const setor of setores) {
    if (setores.length > 1) sec.append(el('h4', 'int-setor', setor.replace(/^Enfermaria /i, '')));
    const grade = el('div', `int-grade ${tipo === 'berco' ? 'cama' : tipo}`);
    for (const l of doGrupo.filter(x => x.setor === setor).sort(comparaLeito)) grade.append(leitoBotao(l, ocupante(l), tipo, i++));
    sec.append(grade);
   }
   mapas.append(sec);
  }
  const legenda = el('div', 'int-legenda');
  for (const [c, t] of [['ocupado', 'Ocupado'], ['vago', 'Livre'], ['bloqueado', 'Bloqueado']]) { const s = el('span'); s.append(el('i', c), document.createTextNode(t)); legenda.append(s); }
  legenda.append(el('span', 'muted', 'Passe o mouse (ou toque) no leito para ver CID, tempo de internação e evolução.'));
  mapas.append(legenda);

  // ---------- CIDs
  const cids = $('.int-cids');
  cids.replaceChildren(el('h3', '', 'Principais diagnósticos'));
  const max = Math.max(1, ...r.capitulos.map(c => c.n));
  const barras = el('div', 'int-barras');
  for (const c of r.capitulos.slice(0, 7)) { const linha = el('div', 'int-barra-linha'); const b = el('div', 'int-barra'); const f = el('span'); f.style.setProperty('--w', `${c.n / max * 100}%`); b.append(f); linha.append(el('span', '', c.capitulo), b, el('strong', '', String(c.n))); barras.append(linha); }
  if (!r.capitulos.length) barras.append(el('p', 'muted', 'A planilha não traz hipóteses com CID agora.'));
  cids.append(barras);
  const chips = el('div', 'int-cid-chips');
  for (const c of r.cids) { const ch = el('span', 'int-chip'); ch.title = c.exemplo; ch.append(el('strong', '', c.cid), document.createTextNode(` ${c.n}×`)); chips.append(ch); }
  cids.append(chips);
  const semCid = pacientes.filter(p => !p.cid).length;
  if (semCid) cids.append(el('small', 'muted', `${semCid} ${semCid === 1 ? 'paciente sem CID' : 'pacientes sem CID'} na hipótese. "Provável" = CID deduzido do texto.`));

  // ---------- Aguardando leito
  const esp = $('.int-espera');
  esp.replaceChildren(el('h3', '', `Aguardando leito hospitalar · ${r.aguardandoLeito}`));
  const maxE = Math.max(1, ...r.especialidades.map(e => e.n));
  const lista = el('div', 'int-barras');
  for (const e of r.especialidades) { const linha = el('div', `int-barra-linha ${/uti/i.test(e.especialidade) ? 'uti' : ''}`); const b = el('div', 'int-barra'); const f = el('span'); f.style.setProperty('--w', `${e.n / maxE * 100}%`); b.append(f); linha.append(el('span', '', e.especialidade), b, el('strong', '', String(e.n))); lista.append(linha); }
  if (!r.especialidades.length) lista.append(el('p', 'muted', 'Ninguém aguardando vaga em hospital.'));
  esp.append(lista);
  const longos = pacientes.filter(p => p.dias > 5).sort((a, b) => b.dias - a.dias);
  if (longos.length) esp.append(el('small', 'muted', `Mais tempo internado: ${longos.slice(0, 4).map(p => `${p.leito} (${p.dias} d)`).join(', ')}.`));

  // ---------- Tabela
  const tb = $('.int-tabela-box');
  tb.replaceChildren(el('h3', '', 'Todos os internados'));
  const tabela = el('table', 'prod-table int-tabela'), thead = el('thead'), cabT = el('tr');
  for (const [t, c] of [['Leito'], ['Idade', 'num'], ['Internação', 'num'], ['CID · hipótese'], ['Especialidade'], ['Evolução'], ['Observação']]) cabT.append(el('th', c || '', t));
  thead.append(cabT); tabela.append(thead);
  const corpo = el('tbody');
  for (const p of [...pacientes].sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1))) {
   const tr = el('tr');
   const leito = el('td'); leito.append(el('strong', '', p.leito), el('small', 'muted', ` ${p.categoria === 'box' ? 'Box' : p.setor.replace(/^Enfermaria /i, '')}`));
   const dias = el('td', 'num'); dias.append(el('span', `int-dias ${faixaDias(p.dias)}`, textoDias(p.dias)));
   const cid = el('td'); if (p.cid) cid.append(el('strong', '', p.cid + (p.cidProvavel ? '*' : '') + ' ')); cid.append(document.createTextNode(hipoteseSemCodigo(p.hipotese) || '—'));
   const ev = el('td'); ev.append(el('span', `int-pill ${p.evolucao || 'neutro'}`, p.evolucao === 'em-dia' ? 'Em dia' : p.evolucao === 'pendente' ? 'Pendente' : p.evolucao === 'sem-idade' ? 'Sem idade' : '—'));
   if (p.ultimaEvolucao) ev.append(el('small', 'muted', ` ${hora(p.ultimaEvolucao)}`));
   tr.append(leito, el('td', 'num', p.idade ?? '—'), dias, cid, el('td', '', (p.uti || p.especialidade || '—').toLowerCase()), ev, el('td', 'int-obs', p.situacao || ''));
   corpo.append(tr);
  }
  tabela.append(corpo);
  const wrap = el('div', 'table-wrap'); wrap.append(tabela);
  // Diagnóstico da leitura do texto das evoluções (para ajuste fino; nenhum dado de paciente).
  painel.querySelector('.int-diag')?.remove();
  const dg = dados.evolucao?.diagnostico;
  if (dg) {
   const det = el('details', 'int-diag');
   det.append(el('summary', '', `Leitura das evoluções no Gestor: ${dg.internadosNaFila} internados na fila · ${dg.evolucoesLidas} evoluções lidas · ${dg.deMedico} de médico · ${dg.ligadosAoLeito} ligadas a leitos`));
   const pre = el('pre', '', JSON.stringify(dg, null, 1));
   det.append(pre);
   tb.after(det);
  }
  tb.append(wrap, el('small', 'muted', '* CID provável, deduzido do texto da hipótese. Evolução: Box = nas últimas 12 h; enfermaria = desde as 07h (visita do dia). A ligação leito × evolução é pela idade do paciente.'));
 }

 async function carregar() {
  if (carregando) return;
  carregando = true;
  $('.int-atualizar').disabled = true;
  $('.int-lido').textContent = 'Lendo a planilha…';
  try {
   const r = await fetch('/api/internados', {cache: 'no-store'});
   const d = await r.json().catch(() => ({}));
   if (!r.ok) throw new Error(d.error || 'O servidor não respondeu.');
   dados = d;
  } catch (e) {
   dados = {...(dados || {resumo: null, pacientes: [], leitos: []}), disponivel: false, erro: e.message};
  } finally {
   carregando = false; $('.int-atualizar').disabled = false; render(); renderMini();
  }
 }
 // Resumo no Painel: macas do Box em miniatura + quantos faltam visitar; clicar abre a aba.
 const slot = document.querySelector('#overview-panel [data-slot="resumo"]');
 const mini = el('button', 'int-mini');
 mini.type = 'button';
 mini.onclick = () => document.querySelector('[data-view="internados"]')?.click();
 if (slot) slot.after(mini); else mini.hidden = true;
 function renderMini() {
  if (!dados?.resumo) { mini.hidden = true; return; }
  mini.hidden = false;
  const r = dados.resumo, v = dados.evolucao?.visitas;
  const macas = el('div', 'int-mini-macas');
  for (const l of (dados.leitos || []).filter(x => x.categoria === 'box').sort(comparaLeito)) macas.append(el('span', `int-mini-maca ${l.ocupado ? 'ocupado' : ''}`));
  const txt = el('div');
  txt.append(el('h3', '', `${r.internados} internados · Box ${r.box.ocupados}/${r.box.capacidade} · enfermaria ${r.enfermaria.ocupados}/${r.enfermaria.capacidade}`),
   el('p', '', `${r.aguardandoLeito} aguardando leito (${r.aguardandoUti} UTI) · média ${r.mediaDias ?? '—'} dias${r.acima5dias ? ` · ${r.acima5dias} acima de 5 dias` : ''}`));
  const vis = el('span', `int-pill ${v && (v.enfermaria.pendentes + v.box.pendentes) ? 'pendente' : v ? 'em-dia' : ''}`, v ? (v.enfermaria.pendentes + v.box.pendentes ? `Faltam ${v.enfermaria.pendentes} visitas · ${v.box.pendentes} no Box` : 'Visitas em dia') : 'Ver internados →');
  mini.replaceChildren(macas, txt, vis);
 }
 $('.int-atualizar').onclick = carregar;
 document.querySelector('[data-view="internados"]')?.addEventListener('click', () => { if (!dados || Date.now() - Date.parse(dados.lidoEm || 0) > 60000) carregar(); });
 setInterval(() => { if (!document.hidden && !painel.hidden) carregar(); }, 120000);
 carregar();
}
