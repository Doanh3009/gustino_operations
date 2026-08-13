$ErrorActionPreference = 'Stop'
$baseUrl = 'https://gustino-operations.vercel.app'
$cacheBuster = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$indexResponse = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/?kpi_audit=$cacheBuster"
$indexHtml = $indexResponse.Content
$mainMatch = [regex]::Match($indexHtml, '/assets/index-[^"'']+\.js')
if (-not $mainMatch.Success) { throw 'Main production bundle not found.' }
$mainPath = $mainMatch.Value
$mainSource = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl$mainPath").Content

$adminMatch = [regex]::Match($mainSource, 'AdminPage-[A-Za-z0-9_-]+\.js')
$commissionMatch = [regex]::Match($mainSource, 'commission-[A-Za-z0-9_-]+\.js')
if (-not $adminMatch.Success -or -not $commissionMatch.Success) {
  throw 'Admin/KPI production bundles not found.'
}
$adminPath = "/assets/$($adminMatch.Value)"
$commissionPath = "/assets/$($commissionMatch.Value)"
$adminSource = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl$adminPath").Content
$commissionSource = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl$commissionPath").Content
$serverTime = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/server-time?kpi_audit=$cacheBuster").Content

$checks = [ordered]@{
  productionHttp200 = $indexResponse.StatusCode -eq 200
  vungTauPolicyVisible = $adminSource.Contains('KPI V') -and $adminSource.Contains('Part-time 550.000')
  pendingAdminRewardPresent = $commissionSource.Contains('PG of the Month')
  deputyFormulaPresent = $commissionSource.Contains('shift_deputy')
  vungTauBranchPresent = $commissionSource.Contains('lotte-vt')
  vungTauPartTimeExact = $commissionSource.Contains('branchId:"lotte-vt",position:"pg_part_time",weekdayTarget:55e4,weekendTarget:65e4,monthlyTarget:149e5')
  vungTauFullTimeExact = $commissionSource.Contains('branchId:"lotte-vt",position:"pg_full_time",weekdayTarget:105e4,weekendTarget:13e5,monthlyTarget:288e5')
  vungTauDeputyExact = $commissionSource.Contains('branchId:"lotte-vt",position:"shift_deputy",weekdayTarget:5e5,weekendTarget:5e5,monthlyTarget:13e6')
  vungTauLeaderExact = $commissionSource.Contains('branchId:"lotte-vt",position:"shift_leader",weekdayTarget:0,weekendTarget:0,monthlyTarget:0')
  vungTauTeamMonthExact = $commissionSource.Contains('"lotte-vt":1282e5')
  utcDateMathPresent = $commissionSource.Contains('Date.UTC') -and $commissionSource.Contains('getUTCDay') -and $commissionSource.Contains('setUTCDate')
}
if ($checks.Values -contains $false) {
  throw "Production markers are incomplete: $($checks | ConvertTo-Json -Compress)"
}

[ordered]@{
  verifiedAt = [DateTimeOffset]::UtcNow.ToString('o')
  baseUrl = $baseUrl
  mainBundle = $mainPath
  adminBundle = $adminPath
  commissionBundle = $commissionPath
  serverTime = ($serverTime | ConvertFrom-Json)
  checks = $checks
} | ConvertTo-Json -Depth 5
'KPI_PRODUCTION_LIVE_VERIFY_OK'
