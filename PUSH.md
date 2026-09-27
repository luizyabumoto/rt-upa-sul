# Lembretes no iPhone

Abra o site no Safari, adicione à Tela de Início e abra pelo ícone. Requer iOS 16.4 ou superior. No Resumo, toque em Ativar neste aparelho, permita as notificações e use Enviar teste.

As pendências precisam estar salvas online. O envio considera Lembrar em ou, se vazio, Dia do plantão. Pendências resolvidas e anotações não geram alertas. Um resumo discreto é enviado por aparelho/dia, a partir de 8h em America/Cuiaba, quando há pendências vencidas ou para hoje. O agendamento verifica a cada 15 minutos até 19h45. Se uma pendência for salva após o aviso daquele dia, entra no resumo do dia seguinte. A entrega depende da rede, das permissões e dos ajustes de Foco do iPhone.

As notificações não contêm nomes, texto das anotações ou detalhes médicos. Ao tocar, o site pede login se a sessão expirou. Sair do site não cancela os lembretes do aparelho; use Desativar neste aparelho antes de compartilhar o dispositivo.

## Operação

- O único projeto alvo é iaeficjsmewxcokzlxtq; REGULA TC não participa.
- database/push.sql cria inscrições com RLS por proprietário e registros de envio exclusivos do servidor.
- VAPID pública/privada e segredo do cron ficam no Vault: rt_vapid_public, rt_vapid_private, rt_push_cron_secret. Nunca versionar os valores nem rotacionar VAPID sem recadastrar os aparelhos.
- Edge Function rt-push usa JWT validado por Auth e associação rt_members para chamadas da conta. O cron usa segredo próprio verificado na função. verify_jwt=false é necessário para este cabeçalho, não significa acesso anônimo.
- database/push-schedule.sql agenda somente esta função. Registros rt_push_deliveries deduplicam por aparelho e dia; erros transitórios têm até cinco tentativas. Endpoints expirados (404/410) são desativados. Um teste é permitido por minuto.
- O service worker não armazena páginas nem dados da escala em cache.
- O teste real de entrega exige ativação e permissão no iPhone do usuário. Testes automatizados cobrem datas, validação, autenticação e restrição de endpoints.

## Pausar

Para pausar os envios sem apagar dados, desative o job rt-upa-daily-reminders no Supabase Cron. Para um aparelho, use o botão Desativar no próprio app.
