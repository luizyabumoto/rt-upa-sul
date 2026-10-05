// Tela de entrada: mostrar/ocultar senha, botão com "entrando…" e aviso animado quando o login falha.
const form = document.querySelector('#login-form');
const message = document.querySelector('#message');
const cartao = document.querySelector('#cartao');
const olho = document.querySelector('#olho');

olho?.addEventListener('click', () => {
  const senha = form.elements.password, mostrar = senha.type === 'password';
  senha.type = mostrar ? 'text' : 'password';
  olho.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
  olho.title = olho.getAttribute('aria-label');
  senha.focus();
});

function erro(texto) {
  message.className = '';
  message.textContent = texto;
  cartao?.classList.remove('erro');
  void cartao?.offsetWidth;   // reinicia a animação
  cartao?.classList.add('erro');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('.entrar') || form.querySelector('button');
  const dados = Object.fromEntries(new FormData(form));
  if (!String(dados.email || '').trim() || !dados.password) return erro('Preencha o e-mail e a senha.');
  button.disabled = true;
  button.classList.add('carregando');
  const rotulo = button.querySelector('.rotulo');
  if (rotulo) rotulo.textContent = 'Entrando…';
  message.className = ''; message.textContent = '';
  try {
    const response = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(dados)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');
    message.className = 'ok';
    message.textContent = 'Tudo certo, abrindo o painel…';
    location.assign('/');
  } catch (error) {
    erro(error.message);
    button.disabled = false;
    button.classList.remove('carregando');
    if (rotulo) rotulo.textContent = 'Entrar';
  }
});
