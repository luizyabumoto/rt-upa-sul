export class MemoryStore {
  constructor(items = {}, onChange = () => {}) { this.items = new Map(Object.entries(items)); this.onChange = onChange; }
  get length() { return this.items.size; }
  key(index) { return [...this.items.keys()][index] ?? null; }
  getItem(key) { return this.items.get(key) ?? null; }
  setItem(key, value) { this.items.set(key, String(value)); this.onChange(); }
  removeItem(key) { this.items.delete(key); this.onChange(); }
  snapshot() { return Object.fromEntries(this.items); }
}

export async function connectStore() {
  const sessionResponse = await fetch('/api/session');
  if (!sessionResponse.ok) throw new Error('Sessão indisponível. Entre novamente em outra aba e recarregue esta página.');
  const session = await sessionResponse.json();
  if (session.mode === 'local') return localStorage;
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('Não foi possível carregar a escala salva. Recarregue para tentar novamente.');
  const state = await response.json();
  let revision = state.revision, dirty = false, saving = false, generation = 0, autoTimer;
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
      const result = await fetch('/api/state', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({items:store.snapshot(), revision})});
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || 'Não foi possível salvar.');
      revision = data.revision; dirty = generation !== sentGeneration;
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
    try{const r=await fetch('/api/state');if(!r.ok)return;const latest=await r.json();if(!dirty&&!saving&&generation===before&&latest.revision!==revision){store.items=new Map(Object.entries(latest.items));revision=latest.revision;status.textContent='Atualizado de outro dispositivo';document.dispatchEvent(new Event('rt-data-restored'));}}catch{}
  },5000);
  return store;
}
