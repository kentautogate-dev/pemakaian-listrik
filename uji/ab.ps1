param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string]$Arg1,
    [string]$Arg2,
    [string]$Arg3,
    [string]$Arg4,
    [int]$TimeoutDetik = 60
)

$exe = "C:\Users\filatelis\AppData\Roaming\npm\node_modules\agent-browser\bin\agent-browser-win32-x64.exe"
$env:AGENT_BROWSER_SESSION = if ($env:AB_SESSION) { $env:AB_SESSION } else { "uji-app-1" }

$keluaran = Join-Path $env:TEMP ("ab-out-" + [guid]::NewGuid().ToString("N") + ".txt")
$galat = Join-Path $env:TEMP ("ab-err-" + [guid]::NewGuid().ToString("N") + ".txt")

$argumen = @($Command)
foreach ($a in @($Arg1, $Arg2, $Arg3, $Arg4)) { if ($a) { $argumen += $a } }

$proses = Start-Process -FilePath $exe -ArgumentList $argumen -RedirectStandardOutput $keluaran -RedirectStandardError $galat -NoNewWindow -PassThru
if (-not $proses.WaitForExit($TimeoutDetik * 1000)) {
    try { $proses.Kill() } catch {}
    Write-Output "=== TIMEOUT ($TimeoutDetik detik) ==="
}
Start-Sleep -Milliseconds 200
if (Test-Path $keluaran) { Get-Content -LiteralPath $keluaran -Raw -Encoding utf8 }
if ((Test-Path $galat) -and (Get-Item $galat).Length -gt 0) {
    Write-Output "=== stderr ==="
    Get-Content -LiteralPath $galat -Raw -Encoding utf8
}
Remove-Item $keluaran, $galat -ErrorAction SilentlyContinue
