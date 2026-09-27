# RT UPA Sul — primeira etapa: escala médica

## Objetivo
Montar a escala quinzenal no navegador, registrar médicos, vínculos, afastamentos, trocas e coberturas, e exportar usando o arquivo Excel oficial como modelo. O acesso inicial será individual, com autenticação.

## Fontes analisadas
- Escala médica de 1–15/10/2026 (referência principal do layout).
- Escalas de setembro e arquivo identificado como agosto/2026 (variações de competência e posição de dias).
- Escala Cinderelas de outubro/2026 (grade fixa independente).
- Prints do painel do NIR, para integração posterior.

## Dados essenciais
- Médico: nome, CRM, vínculo padrão, situação, dias e setores habituais.
- Plantão: data, horário, setor, posição na grade, médico, vínculo do plantão, natureza fixa/extra/cobertura, status e observação.
- Afastamento: médico, início/fim, tipo, observação.
- Troca: plantão original, substituto, motivo, confirmação e histórico.
- Escala: competência, quinzena, versão, estado rascunho/fechada e modelo de Excel.

## Regras da primeira versão
1. O calendário é a fonte única da grade: escolher ano, mês e quinzena calcula 1–15 ou 16–último dia do mês, o dia da semana de cada data e a competência. Plantões fixos são vinculados ao dia da semana, turno e setor; exceções são vinculadas à data exata. Ao gerar nova quinzena, os fixos ocupam as novas datas automaticamente e as exceções não são copiadas sem revisão.
2. Médico e vínculo do plantão são separados: o mesmo médico pode aparecer como SMS, COAPH ou extra SMS em datas diferentes.
3. Afastamentos impedem preenchimento automático e geram alerta; trocas preservam quem estava previsto e quem cobriu.
4. Visitadores da enfermaria permanecem no bloco próprio de duas linhas diurnas de 6 h.
5. Cinderelas têm escala própria, com horários 12h–18h e 18h–00h.
6. A exportação parte do arquivo oficial e preenche apenas células de competência, cabeçalhos de dia/data e plantões; estilos, mesclagens, impressão e elementos fixos devem ser comparados com o original.
7. Antes de fechar, verificar vagas, sobreposições de horários, médico afastado, CRM ausente e competência inconsistente.

## Etapas seguintes
- API Gestor Saúde: confirmar documentação, autorização e disponibilidade dos campos antes de criar filas e produção em tempo real.
- Planilha NIR: identificar fonte, esquema, acesso e frequência de atualização antes de exibir pacientes e permanência.
- Indicadores: integrar dados autorizados e distinguir painel operacional atual de históricos.

## Dependências para concluir o módulo de escala
- Usar as escalas enviadas para levantar médicos e padrões iniciais de plantões fixos; confirmar apenas padrões ambíguos antes da automação.
- Confirmação do modelo oficial a usar como base para cada quinzena.
- Exemplos das escalas Cinderelas quando houver mudanças em relação ao padrão enviado.

## Progresso na exportação
- O mapeamento de cada data aos três blocos e às 14 posições diárias foi verificado com as escalas de setembro/outubro de 2026.
- A exportação local usa uma cópia do XLSX oficial e altera somente o XML da aba da escala; imagens, estilos e configurações de impressão permanecem iguais no arquivo compactado.
- A grade dos dois visitadores é semanal, de segunda a domingo, nas linhas 53–54, colunas C–I.
- Testado download via servidor local, abertura do XLSX e comparação do ZIP: apenas `xl/worksheets/sheet1.xml` mudou.
- Ainda falta autenticação, banco compartilhado, publicação e integração com Gestor Saúde/NIR. A escala exportada requer revisão humana antes do envio.
