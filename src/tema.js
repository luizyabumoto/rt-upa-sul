// Aplica o tema antes de a página aparecer (sem piscar). Padrão: claro; a escolha fica guardada só neste aparelho.
try { var tema = localStorage.getItem('rt-upa-tema'); document.documentElement.dataset.theme = tema === 'dark' ? 'dark' : 'light'; } catch (e) { document.documentElement.dataset.theme = 'light'; }
