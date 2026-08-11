Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$profile = Join-Path $PSScriptRoot ".chrome-profile-copy"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$args = @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$profile"
)
Start-Process -FilePath $chrome -ArgumentList $args

Start-Sleep -Seconds 6

$port = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 9222 }
if ($port) {
  Write-Output "OK: Chrome running, debug port 9222 listening (PID $($port.OwningProcess))"
} else {
  Write-Output "WARN: Chrome started but 9222 not listening. Check logs."
}
