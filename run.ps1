$ErrorActionPreference = "Stop"

$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (Test-Path $bundledNode) {
  & $bundledNode "$PSScriptRoot\server.js"
  exit $LASTEXITCODE
}

node "$PSScriptRoot\server.js"

