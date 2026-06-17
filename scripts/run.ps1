#requires -Version 5
<#
  SentinelMem runner (Windows PowerShell). Sets the Ollama Cloud env and runs
  the agent / inspector / tamper demo.

    .\scripts\run.ps1                                  # investigate https://example.com/
    .\scripts\run.ps1 -Url "https://your-target/"      # custom target
    .\scripts\run.ps1 -Setup                           # pnpm install + playwright chromium
    .\scripts\run.ps1 -Dev                             # launch the web inspector (pnpm dev)
    .\scripts\run.ps1 -Tamper -TamperHost example.com  # tamper demo

  OLLAMA_KEY is read from $env:OLLAMA_KEY, else from .sentinel\ollama-key.txt
  (gitignored). Edit that file to change/rotate the key.

  If PowerShell blocks the script ("running scripts is disabled"), run:
    powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1
#>
param(
  [string]$Url = "https://example.com/",
  [string]$TamperHost = "example.com",
  [switch]$Setup,
  [switch]$Dev,
  [switch]$Tamper
)

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# --- LLM backend: Ollama Cloud ---
$env:OLLAMA_HOST  = "https://ollama.com"
$env:OLLAMA_MODEL = "gpt-oss:120b-cloud"
$env:OLLAMA_THINK = "low"

if (-not $env:OLLAMA_KEY) {
  $keyFile = Join-Path $repo ".sentinel\ollama-key.txt"
  if (Test-Path $keyFile) {
    $env:OLLAMA_KEY = (Get-Content $keyFile -Raw).Trim()
  }
}
if (-not $env:OLLAMA_KEY) {
  Write-Host "OLLAMA_KEY not set and .sentinel\ollama-key.txt is missing." -ForegroundColor Red
  Write-Host "Put your Ollama Cloud key in .sentinel\ollama-key.txt (one line)." -ForegroundColor Yellow
  exit 1
}

Write-Host "SentinelMem -> ollama:$($env:OLLAMA_MODEL) @ $($env:OLLAMA_HOST)" -ForegroundColor Cyan

if ($Setup) {
  pnpm install
  pnpm exec playwright install chromium
  return
}
if ($Dev) {
  pnpm dev
  return
}
if ($Tamper) {
  pnpm sentinel:tamper $TamperHost
  return
}

pnpm sentinel $Url
