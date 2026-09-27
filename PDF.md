# PDF e impressão

A aba **PDF / Imprimir** gera arquivos A4 em paisagem no servidor autenticado.
Escolha ano, mês, quinzena, escala médica ou Cinderelas e a distribuição:

- Quinzena inteira: uma folha, com os dias nas linhas e os postos nas colunas.
- Semanal: uma página por semana que intersecta a quinzena, com letras maiores.

O arquivo usa os dados atuais da tela, as regras com vigência, os ajustes por data e as coberturas confirmadas. Rascunhos de cobertura e anotações pessoais não entram no PDF. As cores indicam SMS, COAPH e extra SMS; os vínculos também estão escritos para impressão sem cor.

Abra o PDF baixado para imprimir. No iPhone, use Compartilhar > Imprimir. O tamanho do PDF já é A4 paisagem; na impressora, use A4 e ajustar à página.

Para executar localmente, instale `python -m pip install -r requirements.txt` antes de `python server.py`. Para os testes, use `python -m pip install -r requirements-dev.txt`, `python -m unittest discover -s tests -p "test_*.py"` e `node --test tests/*.test.js`.
