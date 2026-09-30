export class MemoryStore {
  constructor(items = {}, onChange = () => {}) { this.items = new Map(Object.entries(items)); this.onChange = onChange; }
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, String(value)); this.onChange(); }
  removeItem(key) { this.items.delete(key); this.onChange(); }
  snapshot() { return Object.fromEntries(this.items); }
}

// Junta as alterações deste aparelho (local, feitas desde a última sincronização "base") com o que outro aparelho
// salvou (remoto). Registro que só um lado mudou fica com esse lado. Se os dois mudaram o mesmo registro:
// objetos são juntados campo a campo e listas com "id" item a item; no resto, vale o deste aparelho.
export function mergeItems(base, local, remoto) {
  const result = {...remoto};
  const json = texto => { try { return JSON.parse(texto); } catch { return undefined; } };
  const plano = v => v && typeof v === 'object' && !Array.isArray(v);
  const comId = v => Array.isArray(v) && v.every(x => plano(x) && typeof x.id === 'string');
  for (const chave of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (local[chave] === base[chave]) continue;                       // só o outro aparelho pode ter mudado
    if (!(chave in local)) { delete result[chave]; continue; }
    if (!(chave in remoto) || remoto[chave] === base[chave]) { result[chave] = local[chave]; continue; }
    const [b, l, r] = [json(base[chave] ?? 'null'), json(local[chave]), json(remoto[chave])];
    if (plano(l) && plano(r) && (b === null || plano(b))) {
      const saida = {...r}, antes = b || {};
      for (const campo of new Set([...Object.keys(antes), ...Object.keys(l)])) {
        if (JSON.stringify(l[campo]) === JSON.stringify(antes[campo])) continue;
        if (campo in l) saida[campo] = l[campo]; else delete saida[campo];
      }
      result[chave] = JSON.stringify(saida);
    } else if (comId(l) && comId(r) && (b === null || comId(b))) {
      const antes = new Map((b || []).map(x => [x.id, JSON.stringify(x)])), meus = new Map(l.map(x => [x.id, x]));
      const saida = r.filter(x => meus.has(x.id) || !antes.has(x.id)).map(x => meus.has(x.id) && JSON.stringify(meus.get(x.id)) !== antes.get(x.id) ? meus.get(x.id) : x);
      for (const x of l) if (!antes.has(x.id) && !r.some(y => y.id === x.id)) saida.push(x);
      result[chave] = JSON.stringify(saida);
    } else result[chave] = local[chave];
  }
  return result;
}

export async function connectStore() {
  const sessionResponse = await fetch('/api/session');
  if (!sessionResponse.ok) throw new Error('Sessão indisponível. Entre novamente em outra aba e recarregue esta página.');
  const session = await sessionResponse.json();
  if (session.mode === 'local') return localStorage;
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('Não foi possível carregar a escala salva. Recarregue para tentar novamente.');
  const state = await response.json();
  // base: como os dados estavam no servidor na última sincronização (para juntar com outro aparelho).
  let revision = state.revision, dirty = false, saving = false, generation = 0, autoTimer, base = {...state.items};
  const banner = document.createElement('div');
  banner.className = 'toolbar account-bar';
  banner.style.marginBottom = '16px';
  const account = document.createElement('span'); account.textContent = session.email;
  const status = document.createElement('span'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const save = document.createElement('button'); save.textContent = 'Salvar online'; save.disabled = true;
  const reload = document.createElement('button'); reload.textContent = 'Atualizar dados'; reload.className = 'secondary';
  const logout = document.createElement('button'); logout.textContent = 'Sair'; logout.className = 'secondary';
  banner.append(account, status, save, reload, logout);
  document.querySelector('main').prepend(banner);
  const store = new MemoryStore(state.items, () => { dirty = true; generation++; save.disabled = saving; status.textContent = 'Salvando automaticamente…';clearTimeout(autoTimer);autoTimer=setTimeout(()=>{if(!saving)save.click();},900); });
  status.textContent = revision ? 'Dados carregados da sua conta' : 'Primeiro acesso · nenhuma alteração salva';
  document.querySelector('.badge').textContent = 'Acesso individual';
  document.querySelector('main > .notice').textContent = 'As alterações são salvas automaticamente. Outros dispositivos atualizam em poucos segundos. Revise os plantões e as vagas no Excel antes de enviar a escala.';
  save.addEventListener('click', async () => {
    if(saving||!dirty)return;clearTimeout(autoTimer);
    saving = true; save.disabled = true; logout.disabled = true; reload.disabled = true;
    const sentGeneration = generation;
    status.textContent = 'Salvando…';
    try {
      const enviar = async items => { const r = await fetch('/api/state', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({items, revision})}); return {r, data: await r.json().catch(() => ({}))}; };
      let items = store.snapshot(), {r: result, data} = await enviar(items);
      // Outro aparelho salvou antes: junta as duas versões e tenta de novo, em vez de travar o salvamento.
      for (let tentativa = 0; result.status === 409 && tentativa < 3; tentativa++) {
        status.textContent = 'Juntando com as alterações de outro aparelho…';
        const r = await fetch('/api/state', {cache:'no-store'});
        if (!r.ok) break;
        const latest = await r.json();
        const local = store.snapshot();
        items = mergeItems(base, local, latest.items);
        base = {...latest.items}; revision = latest.revision;
        // O que foi alterado nesta tela enquanto buscava continua valendo.
        store.items = new Map(Object.entries(items));
        ({r: result, data} = await enviar(items));
        if (result.ok) document.dispatchEvent(new Event('rt-data-restored'));
      }
      if (!result.ok) throw new Error(data.error || 'Não foi possível salvar.');
      revision = data.revision; base = {...items}; dirty = generation !== sentGeneration;
      banner.classList.remove('erro');
      status.textContent = dirty ? 'Há novas alterações para salvar' : 'Salvo online';
    } catch (error) {
      // Falha de salvamento não pode passar despercebida: o banner fica vermelho e o aviso, destacado.
      banner.classList.add('erro');
      status.textContent = '⚠ NÃO SALVO: ' + error.message + ' Suas alterações ainda estão nesta tela — NÃO atualize a página. Baixe uma cópia de segurança e tente Salvar online.';
    } finally { saving = false; save.disabled = !dirty; logout.disabled = false; reload.disabled = false; if(dirty&&generation!==sentGeneration)autoTimer=setTimeout(()=>save.click(),900); }
  });
  reload.addEventListener('click', () => { if (!dirty || confirm('Há alterações não salvas. Descartá-las e carregar os dados online?')) location.reload(); });
  logout.addEventListener('click', async () => {
    if (dirty && !confirm('Há alterações não salvas. Sair e descartá-las?')) return;
    try {
      const response = await fetch('/api/logout', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
      if (!response.ok) throw new Error('Não foi possível encerrar a sessão. Tente novamente.');
      dirty = false; location.assign('/login');
    } catch (error) { status.textContent = error.message; }
  });
  window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
  setInterval(async()=>{
    if(dirty||saving||document.hidden||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
    const before=generation;
    try{const r=await fetch('/api/state');if(!r.ok)return;const latest=await r.json();if(!dirty&&!saving&&generation===before&&latest.revision!==revision){store.items=new Map(Object.entries(latest.items));revision=latest.revision;base={...latest.items};status.textContent='Atualizado de outro dispositivo';document.dispatchEvent(new Event('rt-data-restored'));}}catch{}
  },5000);
  return store;
}
