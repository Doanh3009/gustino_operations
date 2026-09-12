$ErrorActionPreference = 'Stop'
# Creates a fresh isolated temporary cluster. Never uses a linked/cloud database.
$pgBin = 'C:/Program Files/PostgreSQL/17/bin'
$testRoot = Join-Path $env:TEMP ('gustino-message-qa-' + [guid]::NewGuid().ToString('N'))
$clusterPath = Join-Path $testRoot 'cluster'
$logPath = Join-Path $testRoot 'postgres.log'
$fixturePath = Join-Path $testRoot 'fixture.sql'
$port = Get-Random -Minimum 55000 -Maximum 59000
$started = $false
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  & "$pgBin/initdb.exe" -D $clusterPath -U qa_messaging -A trust --no-locale -E UTF8 *> (Join-Path $testRoot 'init.log')
  if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL init failed.' }
  $startup = Start-Process -FilePath "$pgBin/pg_ctl.exe" -ArgumentList @('-D', "`"$clusterPath`"", '-l', "`"$logPath`"", '-o', "`"-h 127.0.0.1 -p $port`"", '-w', 'start') -WindowStyle Hidden -PassThru
  if (-not $startup.WaitForExit(30000)) { throw 'pg_ctl startup timed out.' }
  if ($startup.ExitCode -ne 0) { throw 'Isolated PostgreSQL startup failed.' }
  $started = $true
  @'
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table public.profiles(id uuid primary key, full_name text, role text, branch_id text, active boolean);
insert into public.profiles values
('00000000-0000-0000-0000-000000000001','Admin A','admin',null,true),
('00000000-0000-0000-0000-000000000002','Admin B','admin',null,true),
('00000000-0000-0000-0000-000000000011','Employee A','staff','branch-a',true),
('00000000-0000-0000-0000-000000000012','Employee B','cashier','branch-b',true),
('00000000-0000-0000-0000-000000000013','Inactive','staff','branch-a',false);
'@ | Set-Content $fixturePath -Encoding utf8
  $argsForPsql = @('-X','-h','127.0.0.1','-p',"$port",'-U','qa_messaging','-d','postgres','-v','ON_ERROR_STOP=1')
  & "$pgBin/psql.exe" @argsForPsql -f $fixturePath
  if ($LASTEXITCODE -ne 0) { throw 'QA fixture failed.' }
  & "$pgBin/psql.exe" @argsForPsql -f 'supabase/migrations/20260912140000_admin_employee_messages.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Messaging migration failed.' }
  & "$pgBin/psql.exe" @argsForPsql -f 'supabase/migrations/20260912150000_messaging_inbox_preview.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Messaging inbox migration failed.' }
  & "$pgBin/psql.exe" @argsForPsql -f 'scripts/test-messaging-security.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Messaging security integration failed.' }
  Write-Output 'MESSAGING_POSTGRES_SECURITY_OK'
} finally {
  if ($started) {
    $shutdown = Start-Process -FilePath "$pgBin/pg_ctl.exe" -ArgumentList @('-D', "`"$clusterPath`"", '-m', 'fast', '-w', 'stop') -WindowStyle Hidden -PassThru
    if (-not $shutdown.WaitForExit(30000)) { Write-Warning 'pg_ctl shutdown timed out.' }
    if ($shutdown.ExitCode -ne 0) { Write-Warning "Stop failed; temporary cluster path: $clusterPath" }
  }
}
