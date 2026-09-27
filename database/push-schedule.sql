-- Run only on the dedicated RT UPA Sul project, after provisioning Vault secrets.
select cron.schedule('rt-upa-daily-reminders','*/15 12-23 * * *',$job$
 select net.http_post(
  url:='https://iaeficjsmewxcokzlxtq.supabase.co/functions/v1/rt-push',
  headers:=jsonb_build_object('Content-Type','application/json','x-rt-cron',
   (select decrypted_secret from vault.decrypted_secrets where name='rt_push_cron_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=30000
 );
$job$);
