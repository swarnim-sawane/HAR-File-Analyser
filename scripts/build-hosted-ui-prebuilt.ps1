param(
  [string]$Image = "phx.ocir.io/axfm33dl0mwg/har-analyzer/har-app:ui-signed-proxy-combined-20260807-05",
  [string]$RuntimeImage = "phx.ocir.io/axfm33dl0mwg/har-analyzer/har-app:ui-crossapp-signed-probe-20260805-04",
  [string]$BackendApplicationOcid = "ocid1.generativeaihostedapplicationiam.oc1.phx.amaaaaaaxlowriqaudnn2rer2bthxhaof5c2rzj3fa4nkotky7znbqmidyrq",
  [string]$Region = "us-phoenix-1"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($BackendApplicationOcid -notmatch '^ocid1\.generativeaihostedapplicationiam\.[a-z0-9.-]+$') {
  throw "BackendApplicationOcid is not an IAM Hosted Application OCID."
}

$backendInvokeUrl = "https://inference.generativeai.$Region.oci.oraclecloud.com/20251112/hostedApplicationsIam/$BackendApplicationOcid/actions/invoke"
$revision = (git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "Could not resolve the Git revision." }

$sourceFiles = @(
  "deploy/hosted/ui-server.mjs",
  "deploy/hosted/ui-proxy-core.mjs",
  "deploy/hosted/ui-auth-core.mjs",
  "deploy/hosted/Dockerfile.ui-prebuilt",
  "scripts/build-hosted-ui-prebuilt.ps1",
  "src/services/websocketClient.ts",
  "src/services/websocketConfig.ts",
  "package.json",
  "package-lock.json"
)
$sourceMaterial = foreach ($relativePath in $sourceFiles) {
  $fullPath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $fullPath)) { throw "Missing UI source input: $relativePath" }
  "$relativePath`n$((Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant())"
}
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $sourceHashBytes = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes(($sourceMaterial -join "`n")))
  $sourceSha = ([BitConverter]::ToString($sourceHashBytes) -replace '-', '').ToLowerInvariant()
} finally {
  $sha256.Dispose()
}

$previous = @{
  VITE_API_URL = $env:VITE_API_URL
  VITE_BACKEND_URL = $env:VITE_BACKEND_URL
  VITE_WS_URL = $env:VITE_WS_URL
  VITE_WS_TRANSPORTS = $env:VITE_WS_TRANSPORTS
}

try {
  $env:VITE_API_URL = "."
  $env:VITE_BACKEND_URL = "."
  $env:VITE_WS_URL = "."
  $env:VITE_WS_TRANSPORTS = "polling"
  & (Join-Path $repoRoot "node_modules/.bin/tsc.cmd")
  if ($LASTEXITCODE -ne 0) { throw "Frontend TypeScript build failed." }
  & (Join-Path $repoRoot "node_modules/.bin/vite.cmd") build --base=./
  if ($LASTEXITCODE -ne 0) { throw "Frontend Vite build failed." }
} finally {
  foreach ($name in $previous.Keys) {
    if ($null -eq $previous[$name]) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item "Env:$name" $previous[$name]
    }
  }
}

docker build --platform linux/amd64 `
  --build-arg "UI_RUNTIME_IMAGE=$RuntimeImage" `
  --build-arg "BACKEND_INVOKE_URL=$backendInvokeUrl" `
  --build-arg "OCI_REGION_FALLBACK=$Region" `
  --build-arg "VCS_REF=$revision" `
  --build-arg "SOURCE_SHA256=$sourceSha" `
  -f (Join-Path $repoRoot "deploy/hosted/Dockerfile.ui-prebuilt") `
  -t $Image `
  $repoRoot
if ($LASTEXITCODE -ne 0) { throw "UI container build failed." }

$architecture = docker image inspect $Image --format '{{.Architecture}}'
$imageUser = docker image inspect $Image --format '{{.Config.User}}'
$exposedPorts = docker image inspect $Image --format '{{json .Config.ExposedPorts}}'
$command = docker image inspect $Image --format '{{json .Config.Cmd}}'
$labels = docker image inspect $Image --format '{{json .Config.Labels}}' | ConvertFrom-Json
$runtimeRole = $labels.'com.oracle.har-analyzer.runtime'

if ($architecture -ne 'amd64') { throw "UI image must target amd64; found $architecture." }
if ($imageUser -ne '10001:10001') { throw "UI image must run as 10001:10001; found $imageUser." }
if ($exposedPorts -notmatch '8080/tcp') { throw "UI image must expose only the Hosted Application port 8080." }
if ($command -ne '["node","ui-server.mjs"]') { throw "Unexpected UI image command: $command" }
if ($runtimeRole -ne 'session-ui-signed-proxy') { throw "Unexpected UI runtime role label: $runtimeRole" }

Write-Host "Built signed-proxy UI image: $Image"
Write-Host "Backend invoke URL: $backendInvokeUrl"
Write-Host "Source SHA256: $sourceSha"
