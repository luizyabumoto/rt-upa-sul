// Aplica o tema escolhido (claro/escuro) antes de a página aparecer, para não piscar escuro ao abrir no modo claro.
// Escolha guardada só neste aparelho; sem escolha, o site abre no modo escuro de sempre.
try { var tema = localStorage.getItem('rt-upa-tema'); if (tema === 'light' || tema === 'dark') document.documentElement.dataset.theme = tema; } catch (e) {}
