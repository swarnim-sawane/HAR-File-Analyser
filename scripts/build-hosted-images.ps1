param(
  [string]$AppImage = "har-analyzer-app:hosted-local",
  [string]$WorkerImage = "har-analyzer-worker:hosted-local",
  [string]$NodeImage = $env:HAR_NODE_IMAGE
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($NodeImage)) {
  throw "NodeImage is required. Supply an approved Oracle Artifactory, OCIR, or Oracle Container Registry Node base image; public Docker Hub images are not permitted."
}

$registryHost = ($NodeImage -split '/', 2)[0].ToLowerInvariant()
$approvedRegistry =
  $registryHost -eq 'container-registry.oracle.com' -or
  $registryHost -match '\.ocir\.io$' -or
  $registryHost -match '\.artifactory\.oci\.oraclecorp\.com$'

if (-not $approvedRegistry) {
  throw "Unapproved base-image registry '$registryHost'. Use Oracle Artifactory, OCIR, or Oracle Container Registry; public Docker Hub images are not permitted."
}

function Invoke-HostedImageBuild {
  param(
    [string]$Dockerfile,
    [string]$Image
  )

  docker build --platform linux/amd64 `
    --build-arg "NODE_IMAGE=$NodeImage" `
    -f $Dockerfile `
    -t $Image `
    $repoRoot

  if ($LASTEXITCODE -ne 0) {
    throw "Container build failed for $Image."
  }
}

Write-Host "Building linux/amd64 Hosted Deployment images through Rancher Desktop..."
Write-Host "Node base image: $NodeImage"

Invoke-HostedImageBuild `
  -Dockerfile (Join-Path $repoRoot "deploy/hosted/Dockerfile.app") `
  -Image $AppImage

Invoke-HostedImageBuild `
  -Dockerfile (Join-Path $repoRoot "deploy/hosted/Dockerfile.worker") `
  -Image $WorkerImage

foreach ($image in @($AppImage, $WorkerImage)) {
  $architecture = docker image inspect $image --format '{{.Architecture}}'
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect built image $image."
  }
  if ($architecture -ne 'amd64') {
    throw "$image was built for $architecture instead of amd64."
  }

  $imageUser = docker image inspect $image --format '{{.Config.User}}'
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($imageUser) -or $imageUser -in @('0', 'root')) {
    throw "$image must run as a non-root user."
  }

  $exposedPorts = docker image inspect $image --format '{{json .Config.ExposedPorts}}'
  if ($LASTEXITCODE -ne 0 -or $exposedPorts -notmatch '8080/tcp') {
    throw "$image must expose port 8080."
  }

  $configuredEnvironment = docker image inspect $image --format '{{range .Config.Env}}{{println .}}{{end}}'
  $reservedEnvironment = $configuredEnvironment | Where-Object {
    $_ -match '^(PORT|K_SERVICE|K_CONFIGURATION|K_REVISION|OCI_RESOURCE_PRINCIPAL_VERSION|OCI_RESOURCE_PRINCIPAL_PRIVATE_PEM|OCI_RESOURCE_PRINCIPAL_RPST|KUBERNETES_[^=]*)='
  }
  if ($reservedEnvironment) {
    throw "$image declares Hosted Deployment reserved environment variables: $($reservedEnvironment -join ', ')"
  }
}

Write-Host "Hosted Deployment images built successfully:"
Write-Host "  $AppImage"
Write-Host "  $WorkerImage"
