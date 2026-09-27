# Preparação do acesso online

Esta etapa acrescenta login por e-mail/senha, acesso somente para contas autorizadas,
armazenamento privado por usuário e exportação do Excel após autenticação.
Não publica o site. A implantação automática por Git está desativada em vercel.json.

## Operação

- Editar e pressionar **Salvar online**. O estado só é considerado salvo após confirmação do servidor.
- No outro dispositivo, pressionar **Atualizar dados**. Não há colaboração em tempo real.
- Edições concorrentes causam um aviso: baixar backup antes de atualizar evita perder alterações.
- A sessão dura até uma hora. Se expirar durante uma edição, entrar novamente em outra aba e salvar.
- Os backups locais existentes podem ser restaurados e depois salvos online.
- Cada conta tem seus próprios dados. Compartilhamento entre usuários requer uma etapa posterior.
- O protótipo local continua disponível por `python server.py`, restrito a 127.0.0.1.

## Configuração pendente antes de publicar

1. Criar/selecionar o projeto Supabase dedicado, após escolha da organização e confirmação dos custos.
2. Executar `database/schema.sql` uma única vez. Há RLS em todas as tabelas e a função de salvamento usa os privilégios do usuário.
3. Desativar cadastros públicos e acesso anônimo no Supabase Auth. Criar a conta inicial pelo painel de Auth e inserir seu UUID em `public.rt_members` por acesso administrativo. Nunca colocar senha no repositório.
4. Configurar as variáveis do exemplo: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`. A origem deve ser o endereço HTTPS exato do site. Não usar chave service_role.
5. Para verificação local, definir essas variáveis no ambiente e executar `python online.py`. O programa não carrega arquivos .env automaticamente.
6. Antes de ativar: verificar com duas contas reais as políticas do banco, o login, o salvamento entre dispositivos e a rejeição de uma versão antiga. Conferir os advisors do Supabase.
7. Após autorização de publicação, testar a implantação Vercel e o download completo do XLSX (~5,9 MB) por streaming. Essa etapa ainda não foi validada na hospedagem.

Somente o diretório vazio `public` é saída estática; o servidor possui uma lista explícita de arquivos permitidos e exige login para os dados iniciais. O modelo XLSX nunca é servido diretamente.

## Verificação

`node --test tests/*.test.js`

`python -m unittest discover -s tests -p "test_*.py"`

Os testes Python simulam o provedor de autenticação/banco. Eles verificam bloqueio sem login, origem das alterações, cookies, dados inválidos, sessão expirada, conflitos e integridade do Excel. Não substituem os testes contra o Supabase configurado.
