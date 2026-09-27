document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const message = document.querySelector('#message');
  button.disabled = true;
  message.textContent = 'Entrando…';
  try {
    const response = await fetch('/api/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');
    location.assign('/');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
