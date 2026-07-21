param(
    [switch]$IncludeLocalEnv
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$buildDirectory = Join-Path $distRoot 'player-build'
$releaseDirectory = Join-Path $distRoot 'dont-starve-ai-mod-player'
$zipPath = Join-Path $distRoot 'dont-starve-ai-mod-player.zip'

function Reset-DistDirectory([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $allowedRoot = [System.IO.Path]::GetFullPath($distRoot) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to reset a directory outside dist: $fullPath"
    }
    if (Test-Path -LiteralPath $fullPath) {
        Remove-Item -LiteralPath $fullPath -Recurse -Force
    }
    New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
}

Reset-DistDirectory $buildDirectory
Reset-DistDirectory $releaseDirectory

$buildScript = Join-Path $PSScriptRoot 'build-launcher.ps1'
& $buildScript -OutputDirectory $buildDirectory -IncludeLocalEnv:$IncludeLocalEnv
if ($LASTEXITCODE -ne 0) {
    throw 'Player launcher build failed.'
}

Copy-Item -LiteralPath (Join-Path $buildDirectory 'ChesterAI.exe') `
    -Destination (Join-Path $releaseDirectory '安装切斯特AI.exe') -Force
Copy-Item -LiteralPath (Join-Path $buildDirectory '.env.example') `
    -Destination (Join-Path $releaseDirectory '.env.example') -Force
if ($IncludeLocalEnv) {
    $localEnv = Join-Path $buildDirectory '.env'
    if (-not (Test-Path -LiteralPath $localEnv)) {
        throw 'IncludeLocalEnv was requested, but the project .env file was not found.'
    }
    Copy-Item -LiteralPath $localEnv -Destination (Join-Path $releaseDirectory '.env') -Force
}

Compress-Archive -Path (Join-Path $releaseDirectory '*') `
    -DestinationPath $zipPath -CompressionLevel Optimal -Force
Write-Host "Built player package: $zipPath"
