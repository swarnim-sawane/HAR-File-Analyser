param(
  [Parameter(Mandatory = $true)]
  [string]$NodeBaseImage,
  [string]$OracleLinuxImage = "container-registry.oracle.com/os/oraclelinux:9-slim",
  [ValidateSet("20", "22")]
  [string]$NodeJsStream = "22"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$registryHost = ($OracleLinuxImage -split '/', 2)[0].ToLowerInvariant()
$approvedRegistry =
  $registryHost -eq 'container-registry.oracle.com' -or
  $registryHost -match '^container-registry-[a-z0-9-]+\.oracle\.com$' -or
  $registryHost -match '\.ocir\.io$' -or
  $registryHost -match '\.artifactory\.oci\.oraclecorp\.com$'

if (-not $approvedRegistry) {
  throw "Unapproved Oracle Linux registry '$registryHost'. Public Docker Hub images are not permitted."
}

docker build --platform linux/amd64 `
  --build-arg "ORACLE_LINUX_IMAGE=$OracleLinuxImage" `
  --build-arg "NODEJS_STREAM=$NodeJsStream" `
  -f (Join-Path $repoRoot "deploy/hosted/Dockerfile.node-base") `
  -t $NodeBaseImage `
  $repoRoot

if ($LASTEXITCODE -ne 0) {
  throw "Hosted Node base-image build failed for $NodeBaseImage."
}

$architecture = docker image inspect $NodeBaseImage --format '{{.Architecture}}'
if ($LASTEXITCODE -ne 0 -or $architecture -ne 'amd64') {
  throw "$NodeBaseImage was not built as linux/amd64."
}

docker run --rm $NodeBaseImage node --version
if ($LASTEXITCODE -ne 0) {
  throw "$NodeBaseImage does not provide a working Node.js runtime."
}

docker run --rm $NodeBaseImage npm --version
if ($LASTEXITCODE -ne 0) {
  throw "$NodeBaseImage does not provide a working npm runtime."
}

Write-Host "Hosted Node base image built successfully: $NodeBaseImage"
