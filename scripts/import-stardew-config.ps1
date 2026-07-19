param(
    [string]$StardewConfig = $env:STARDEW_AI_CHAT_CONFIG
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot '.env'

function Find-StardewAiChatConfig {
    $steamRoots = @()
    $steamKey = Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue
    if ($steamKey.SteamPath) {
        $steamRoots += $steamKey.SteamPath
    }
    $steamRoots += @(
        'C:\Program Files (x86)\Steam',
        'C:\Program Files\Steam',
        'D:\SteamLibrary',
        'E:\Steam',
        'F:\SteamLibrary'
    )

    $libraries = @($steamRoots)
    foreach ($root in $steamRoots | Select-Object -Unique) {
        $vdf = Join-Path $root 'steamapps\libraryfolders.vdf'
        if (Test-Path -LiteralPath $vdf) {
            $text = Get-Content -Raw -LiteralPath $vdf
            foreach ($match in [regex]::Matches($text, '"path"\s+"([^"]+)"')) {
                $libraries += $match.Groups[1].Value.Replace('\\', '\')
            }
        }
    }

    foreach ($library in $libraries | Select-Object -Unique) {
        $candidate = Join-Path $library 'steamapps\common\Stardew Valley\Mods\StardewAIChat\config.json'
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

if (-not $StardewConfig) {
    $StardewConfig = Find-StardewAiChatConfig
}

if (-not (Test-Path -LiteralPath $StardewConfig)) {
    throw "StardewAIChat config was not found: $StardewConfig"
}

$raw = Get-Content -Raw -LiteralPath $StardewConfig

function Read-ConfigString {
    param([string]$Name, [string]$Default = '')
    $pattern = '"' + [regex]::Escape($Name) + '"\s*:\s*"([^"]*)"'
    $match = [regex]::Match($raw, $pattern)
    if ($match.Success) {
        return $match.Groups[1].Value
    }
    return $Default
}

$chatUrl = Read-ConfigString 'ApiUrl' 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
$chatKey = Read-ConfigString 'ApiKey'
$visionModel = Read-ConfigString 'VisionModel' 'glm-4.5v'
$voiceKey = Read-ConfigString 'VolcengineApiKey'
$ttsVoice = Read-ConfigString 'TtsVoice' 'zh_female_shuangkuaisisi_emo_v2_mars_bigtts'
$ttsResource = Read-ConfigString 'TtsResourceId' 'seed-tts-1.0'

if (-not $chatKey -or -not $voiceKey) {
    throw 'The StardewAIChat config does not contain both chat and voice keys.'
}

$lines = @(
    '# Imported locally from StardewAIChat. Never commit this file.',
    "AI_API_KEY=$chatKey",
    "CHAT_URL=$chatUrl",
    "CHAT_MODEL=$visionModel",
    'VOICE_PROVIDER=volcengine',
    "VOLCENGINE_API_KEY=$voiceKey",
    'VOLCENGINE_ASR_RESOURCE_ID=volc.bigasr.auc',
    "VOLCENGINE_TTS_RESOURCE_ID=$ttsResource",
    "TTS_VOICE=$ttsVoice",
    'VOICE_KEY=v',
    "GAME_WINDOW_TITLE=Don't Starve Together",
    'SCREENSHOT_MAX_WIDTH=1280',
    'REQUEST_TIMEOUT_SECONDS=60',
    'REPLY_LANGUAGE=Chinese'
)

Set-Content -LiteralPath $destination -Value $lines -Encoding utf8
Write-Host 'Imported StardewAIChat provider settings into the local .env file.'
Write-Host 'Secret values were not printed.'
