param(
  [Parameter(Mandatory = $true)]
  [string]$BaseAppImage,
  [Parameter(Mandatory = $true)]
  [string]$CombinedImage,
  [string]$SourceRevision = "unknown",
  [string]$SourceContentSha256 = "unknown"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

$localLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repoRoot "backend/package-lock.json")).Hash.ToLowerInvariant()
$baseLockOutput = docker run --rm --entrypoint sha256sum $BaseAppImage /app/package-lock.json
if ($LASTEXITCODE -ne 0) {
  throw "Could not read /app/package-lock.json from $BaseAppImage."
}
$baseLockHash = ($baseLockOutput -split '\s+')[0].ToLowerInvariant()
if ($baseLockHash -ne $localLockHash) {
  throw "The base image dependency lock does not match backend/package-lock.json. Rebuild through Dockerfile.combined instead."
}

npm --prefix backend run build
if ($LASTEXITCODE -ne 0) { throw "Backend build failed." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }

docker build --platform linux/amd64 `
  --build-arg "APP_BASE_IMAGE=$BaseAppImage" `
  --build-arg "SOURCE_REVISION=$SourceRevision" `
  --build-arg "SOURCE_CONTENT_SHA256=$SourceContentSha256" `
  -f (Join-Path $repoRoot "deploy/hosted/Dockerfile.combined-prebuilt") `
  -t $CombinedImage `
  $repoRoot
if ($LASTEXITCODE -ne 0) { throw "Combined prebuilt image build failed." }

$architecture = docker image inspect $CombinedImage --format '{{.Architecture}}'
$imageUser = docker image inspect $CombinedImage --format '{{.Config.User}}'
$exposedPorts = docker image inspect $CombinedImage --format '{{json .Config.ExposedPorts}}'
$command = docker image inspect $CombinedImage --format '{{json .Config.Cmd}}'

if ($architecture -ne 'amd64') { throw "$CombinedImage must be linux/amd64." }
if ([string]::IsNullOrWhiteSpace($imageUser) -or $imageUser -in @('0', 'root')) {
  throw "$CombinedImage must run as a non-root user."
}
if ($exposedPorts -notmatch '8080/tcp') { throw "$CombinedImage must expose port 8080." }
if ($command -notmatch 'combinedRuntime\.js') { throw "$CombinedImage must run combinedRuntime.js." }

Write-Host "Combined image built successfully: $CombinedImage"
Write-Host "Verified dependency lock SHA256: $localLockHash"
