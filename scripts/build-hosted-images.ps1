param(
  [string]$AppImage = "har-analyzer-app:hosted-local",
  [string]$WorkerImage = "har-analyzer-worker:hosted-local",
  [string]$NodeImage = "node:22-alpine"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

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
}

Write-Host "Hosted Deployment images built successfully:"
Write-Host "  $AppImage"
Write-Host "  $WorkerImage"
