param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$SshProfile,
    [string]$OutputDirectory = (Join-Path $env:TEMP ("bb-windows-qa-" + [Guid]::NewGuid()))
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$installer = (Resolve-Path $Installer).Path
$installDir = Join-Path $env:LOCALAPPDATA "Programs\BB Windows"
$exe = Join-Path $installDir "BB Windows.exe"
$configPath = Join-Path $env:APPDATA "BB Windows\connection.json"
$original = [System.IO.File]::ReadAllText($configPath)
$result = [ordered]@{}
function Install-Client {
    $p = Start-Process -FilePath $installer -ArgumentList "/S /D=$installDir" -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Installer exited $($p.ExitCode)" }
    if (-not (Test-Path $exe)) { throw "Installed executable is missing" }
}
function Healthy($port) {
    try { return (Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2).ok -eq $true }
    catch { return $false }
}
function Wait-Healthy($port, $seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) { if (Healthy $port) { return }; Start-Sleep -Milliseconds 300 }
    throw "No BB response on port $port"
}
function Owned-Ssh {
    @(Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" | Where-Object { $_.CommandLine -like '*127.0.0.1:38906:127.0.0.1:38886*' })
}
try {
    Install-Client
    $result.install = $true
    $result.executableVersion = (Get-Item $exe).VersionInfo.ProductVersion
    $qaConfig = @{kind="ssh";profile=$SshProfile;localPort=38906;remotePort=38886} | ConvertTo-Json
    [System.IO.File]::WriteAllText($configPath, $qaConfig)
    $output = Join-Path $OutputDirectory "installed-smoke.json"
    if (Test-Path $output) { Remove-Item $output }
    $p = Start-Process -FilePath $exe -ArgumentList "--smoke-output=$output --smoke-delay-ms=22000" -PassThru
    Wait-Healthy 38906 20
    $owned = @(Owned-Ssh)
    if ($owned.Count -ne 1) { throw "Expected one owned SSH process, found $($owned.Count)" }
    $result.ownedTunnel = $true
    $second = Start-Process -FilePath $exe -PassThru
    if (-not $second.WaitForExit(10000)) { throw "Second instance did not exit" }
    $result.singleInstance = $second.ExitCode -eq 0
    $oldPid = $owned[0].ProcessId
    Stop-Process -Id $oldPid
    Start-Sleep -Seconds 1
    Wait-Healthy 38906 30
    $replacement = @(Owned-Ssh)
    if ($replacement.Count -ne 1 -or $replacement[0].ProcessId -eq $oldPid) { throw "SSH process was not replaced" }
    $result.reconnectAfterSshExit = $true
    if (-not $p.WaitForExit(45000)) { throw "Installed smoke test did not exit" }
    if (-not (Test-Path $output)) { throw "Installed smoke report is missing" }
    $result.smoke = Get-Content $output -Raw | ConvertFrom-Json
    Start-Sleep -Milliseconds 500
    if (@(Owned-Ssh).Count -ne 0) { throw "Owned SSH remained after client exit" }
    $result.ownedTunnelCleanup = $true
    [System.IO.File]::WriteAllText($configPath, $original)
    $originalConfig = $original | ConvertFrom-Json
    $result.existingTunnelUnaffected = if ($originalConfig.kind -eq "ssh") { Healthy $originalConfig.localPort } else { $true }
    $uninstaller = Get-ChildItem $installDir -Filter '*Uninstall*.exe' | Select-Object -First 1
    if (-not $uninstaller) { throw "Uninstaller is missing" }
    Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait
    $deadline = (Get-Date).AddSeconds(15)
    while ((Test-Path $exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
    if (Test-Path $exe) { throw "Uninstall did not remove the application" }
    $result.uninstall = $true
    $result.configPreservedOnUninstall = (Test-Path $configPath) -and ([System.IO.File]::ReadAllText($configPath) -eq $original)
    Install-Client
    $result.reinstall = $true
    $result.configPreservedOnReinstall = [System.IO.File]::ReadAllText($configPath) -eq $original
    $result.startMenuShortcut = @(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Filter 'BB Windows.lnk' -Recurse).Count -gt 0
    $result.desktopShortcut = Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'BB Windows.lnk')
    $result | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $OutputDirectory 'verification.json') -Encoding UTF8
    $result | ConvertTo-Json -Depth 8
} finally {
    [System.IO.File]::WriteAllText($configPath, $original)
}
