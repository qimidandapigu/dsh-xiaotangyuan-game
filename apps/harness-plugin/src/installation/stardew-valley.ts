import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import extract from 'extract-zip'

const execFileAsync = promisify(execFile)
const RELEASES_API = 'https://api.github.com/repos/qimidandapigu/dsh-xiaotangyuan-game/releases?per_page=50'
const DISTRIBUTION_MANIFEST_URL = 'https://raw.githubusercontent.com/qimidandapigu/dsh-xiaotangyuan-game/main/distribution/stardew-valley.json'
const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/'
const STARDEW_RELEASE_PREFIX = 'stardew-v'
const MINIMUM_ADAPTER_VERSION = '0.3.0'
const STARDEW_ASSET_PREFIX = 'dsh-xiaotangyuan-game-stardew-'
const MOD_FOLDER_NAME = 'StardewAgentMod'
const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024

interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface GithubRelease {
  tag_name: string
  assets: ReleaseAsset[]
  draft?: boolean
}

export interface StardewDistributionManifest {
  schemaVersion: 1
  tag: string
  version: string
  archive: ReleaseAsset & { sha256: string }
}

interface InstallableStardewRelease {
  tagName: string
  archive: ReleaseAsset
  expectedSha256?: string
  checksumAsset?: ReleaseAsset
}

interface ModManifest {
  Name?: string
  Version?: string
  UniqueID?: string
}

export interface StardewDetection {
  found: boolean
  platform: NodeJS.Platform
  gamePath?: string
  modsPath?: string
  smapiInstalled: boolean
  installedVersion?: string
}

export interface StardewInstallResult {
  installed: true
  version: string
  gamePath: string
  modPath: string
  backupPath?: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readManifest(path: string): Promise<ModManifest | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ModManifest
  } catch {
    return undefined
  }
}

export function parseSteamLibraryPaths(vdf: string): string[] {
  const paths = new Set<string>()
  for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
    const value = match[1]?.replaceAll('\\\\', '\\').trim()
    if (value !== undefined && value !== '') paths.add(normalize(value))
  }
  return [...paths]
}

async function windowsSteamRoot(signal?: AbortSignal): Promise<string | undefined> {
  try {
    const result = await execFileAsync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true, signal },
    )
    const match = result.stdout.match(/SteamPath\s+REG_SZ\s+(.+)$/im)
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

async function steamRoots(signal?: AbortSignal): Promise<string[]> {
  const roots = new Set<string>()
  const add = (value: string | undefined): void => {
    if (value !== undefined && value.trim() !== '') roots.add(normalize(value))
  }

  if (process.platform === 'win32') {
    add(await windowsSteamRoot(signal))
    add(process.env['ProgramFiles(x86)'] === undefined ? undefined : join(process.env['ProgramFiles(x86)'], 'Steam'))
    add(process.env.ProgramFiles === undefined ? undefined : join(process.env.ProgramFiles, 'Steam'))
  } else if (process.platform === 'darwin') {
    add(join(homedir(), 'Library', 'Application Support', 'Steam'))
  } else {
    add(join(homedir(), '.local', 'share', 'Steam'))
    add(join(homedir(), '.steam', 'steam'))
  }

  for (const root of [...roots]) {
    try {
      const vdf = await readFile(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const library of parseSteamLibraryPaths(vdf)) add(library)
    } catch {
      // A candidate Steam root may not exist or may predate libraryfolders.vdf.
    }
  }
  return [...roots]
}

export async function inspectStardewPath(gamePath: string): Promise<StardewDetection | undefined> {
  const resolved = resolve(gamePath)
  const gameMarkers = process.platform === 'win32'
    ? ['Stardew Valley.dll', 'StardewValley.exe']
    : process.platform === 'darwin'
      ? ['Contents/MacOS/StardewValley', 'Stardew Valley.dll']
      : ['Stardew Valley.dll', 'StardewValley']
  if (!(await Promise.all(gameMarkers.map(marker => exists(join(resolved, marker))))).some(Boolean)) return undefined

  const modsPath = join(resolved, 'Mods')
  const smapiMarkers = process.platform === 'win32'
    ? ['StardewModdingAPI.exe']
    : process.platform === 'darwin'
      ? ['StardewModdingAPI', 'Contents/MacOS/StardewModdingAPI']
      : ['StardewModdingAPI']
  const smapiInstalled = (await Promise.all(smapiMarkers.map(marker => exists(join(resolved, marker))))).some(Boolean)
  const installed = await readManifest(join(modsPath, MOD_FOLDER_NAME, 'manifest.json'))

  return {
    found: true,
    platform: process.platform,
    gamePath: resolved,
    modsPath,
    smapiInstalled,
    ...(installed?.Version === undefined ? {} : { installedVersion: installed.Version }),
  }
}

export async function detectStardew(gamePath?: string, signal?: AbortSignal): Promise<StardewDetection> {
  if (gamePath !== undefined && gamePath.trim() !== '') {
    const explicit = await inspectStardewPath(gamePath.trim())
    if (explicit !== undefined) return explicit
    return { found: false, platform: process.platform, smapiInstalled: false }
  }

  for (const root of await steamRoots(signal)) {
    const candidate = join(root, 'steamapps', 'common', 'Stardew Valley')
    const detection = await inspectStardewPath(candidate)
    if (detection !== undefined) return detection
  }
  return { found: false, platform: process.platform, smapiInstalled: false }
}

async function fetchChecked(
  url: string,
  signal: AbortSignal,
  accept = 'application/vnd.github+json',
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          Accept: accept,
          'User-Agent': 'dsh-xiaotangyuan-game',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
      if (response.ok) return response
      if (response.status < 500 || attempt === 3) {
        throw new Error(`download failed (${response.status}) for ${url}`)
      }
      lastError = new Error(`download failed (${response.status}) for ${url}`)
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
      if (attempt === 3) throw error
    }
    await delay(attempt * 500, undefined, { signal })
  }
  throw lastError instanceof Error ? lastError : new Error(`download failed for ${url}`)
}

export function selectStardewRelease(value: unknown): GithubRelease {
  if (!Array.isArray(value)) throw new Error('GitHub returned an invalid release list')
  const release = value.find((candidate): candidate is GithubRelease => {
    if (typeof candidate !== 'object' || candidate === null) return false
    const record = candidate as Partial<GithubRelease>
    return record.draft !== true
      && typeof record.tag_name === 'string'
      && record.tag_name.startsWith(STARDEW_RELEASE_PREFIX)
      && Array.isArray(record.assets)
  })
  if (release === undefined) throw new Error('no Stardew Valley release was found in the XiaoTangYuan repository')
  return release
}

function numericVersion(value: string): readonly number[] | undefined {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isCompatibleStardewRelease(tag: string): boolean {
  if (!tag.startsWith(STARDEW_RELEASE_PREFIX)) return false
  const actual = numericVersion(tag.slice(STARDEW_RELEASE_PREFIX.length))
  const minimum = numericVersion(MINIMUM_ADAPTER_VERSION)
  if (actual === undefined || minimum === undefined) return false
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index]! > minimum[index]!) return true
    if (actual[index]! < minimum[index]!) return false
  }
  return true
}

export function parseStardewDistributionManifest(value: unknown): StardewDistributionManifest {
  if (typeof value !== 'object' || value === null) throw new Error('星露谷发布清单不是对象')
  const record = value as Partial<StardewDistributionManifest>
  if (record.schemaVersion !== 1) throw new Error('星露谷发布清单版本不受支持')
  if (typeof record.tag !== 'string' || !isCompatibleStardewRelease(record.tag)) {
    throw new Error('星露谷发布清单包含无效或不兼容的版本标签')
  }
  const version = record.tag.slice(STARDEW_RELEASE_PREFIX.length)
  if (record.version !== version) throw new Error('星露谷发布清单的版本与标签不一致')
  if (typeof record.archive !== 'object' || record.archive === null) {
    throw new Error('星露谷发布清单缺少安装包')
  }
  const archive = record.archive as Partial<StardewDistributionManifest['archive']>
  if (typeof archive.name !== 'string'
    || !archive.name.startsWith(STARDEW_ASSET_PREFIX)
    || !archive.name.endsWith('.zip')) {
    throw new Error('星露谷发布清单包含无效的安装包名称')
  }
  const expectedUrl = `${RELEASE_DOWNLOAD_PREFIX}${record.tag}/${archive.name}`
  if (archive.url !== expectedUrl) throw new Error('星露谷发布清单包含非官方安装地址')
  if (typeof archive.size !== 'number'
    || !Number.isSafeInteger(archive.size)
    || archive.size <= 0
    || archive.size > MAX_ARCHIVE_SIZE) {
    throw new Error('星露谷发布清单包含无效的安装包大小')
  }
  if (typeof archive.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(archive.sha256)) {
    throw new Error('星露谷发布清单包含无效的 SHA-256')
  }
  return {
    schemaVersion: 1,
    tag: record.tag,
    version,
    archive: {
      name: archive.name,
      url: archive.url,
      size: archive.size,
      sha256: archive.sha256.toLowerCase(),
    },
  }
}

async function releaseFromManifest(signal: AbortSignal): Promise<InstallableStardewRelease> {
  const value: unknown = await (await fetchChecked(DISTRIBUTION_MANIFEST_URL, signal, 'application/json')).json()
  const manifest = parseStardewDistributionManifest(value)
  return {
    tagName: manifest.tag,
    archive: manifest.archive,
    expectedSha256: manifest.archive.sha256,
  }
}

async function releaseFromGithubApi(signal: AbortSignal): Promise<InstallableStardewRelease> {
  const value: unknown = await (await fetchChecked(RELEASES_API, signal)).json()
  const release = selectStardewRelease(value)
  if (!isCompatibleStardewRelease(release.tag_name)) {
    throw new Error(`最新星露谷适配器 ${release.tag_name} 低于当前插件要求的 ${STARDEW_RELEASE_PREFIX}${MINIMUM_ADAPTER_VERSION}，已拒绝安装旧演示版`)
  }
  const archive = release.assets.find(asset => asset.name.startsWith(STARDEW_ASSET_PREFIX) && asset.name.endsWith('.zip'))
  const checksumAsset = release.assets.find(asset => asset.name === 'SHA256SUMS.txt')
  if (archive === undefined || checksumAsset === undefined) {
    throw new Error('latest XiaoTangYuan Stardew release is missing its zip or SHA256SUMS.txt')
  }
  return { tagName: release.tag_name, archive, checksumAsset }
}

async function latestRelease(signal: AbortSignal): Promise<InstallableStardewRelease> {
  try {
    return await releaseFromManifest(signal)
  } catch (manifestError) {
    if (signal.aborted) throw manifestError
    try {
      return await releaseFromGithubApi(signal)
    } catch (apiError) {
      const manifestMessage = manifestError instanceof Error ? manifestError.message : String(manifestError)
      const apiMessage = apiError instanceof Error ? apiError.message : String(apiError)
      throw new Error(`无法读取星露谷安装源。静态清单：${manifestMessage}；GitHub API：${apiMessage}`)
    }
  }
}

function safeChild(parent: string, child: string): void {
  const pathFromParent = relative(resolve(parent), resolve(child))
  if (pathFromParent === '' || pathFromParent.startsWith('..') || isAbsolute(pathFromParent)) {
    throw new Error(`refusing unsafe MOD destination: ${child}`)
  }
}

function checksumLine(text: string, assetName: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (match?.[2] === assetName) return match[1]?.toLowerCase()
  }
  return undefined
}

export async function preserveStardewConfig(backupPath: string, destination: string): Promise<boolean> {
  const previousConfig = join(backupPath, 'config.json')
  if (!(await exists(previousConfig))) return false
  await cp(previousConfig, join(destination, 'config.json'), { force: true })
  return true
}

export async function installStardewMod(
  gamePath: string | undefined,
  signal: AbortSignal,
): Promise<StardewInstallResult> {
  const detection = await detectStardew(gamePath, signal)
  if (!detection.found || detection.gamePath === undefined || detection.modsPath === undefined) {
    throw new Error('Stardew Valley was not found; provide its installation directory as gamePath')
  }
  if (!detection.smapiInstalled) {
    throw new Error(`SMAPI was not found in ${detection.gamePath}; install SMAPI before installing this MOD`)
  }

  const release = await latestRelease(signal)
  const zipAsset = release.archive
  if (zipAsset.size > MAX_ARCHIVE_SIZE) throw new Error('refusing MOD archive larger than 50 MiB')

  const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-xiaotangyuan-game-'))
  try {
    const archivePath = join(tempRoot, basename(zipAsset.name))
    const archive = new Uint8Array(await (await fetchChecked(zipAsset.url, signal, 'application/octet-stream')).arrayBuffer())
    if (archive.byteLength > MAX_ARCHIVE_SIZE) throw new Error('downloaded MOD archive exceeds 50 MiB')
    let expected = release.expectedSha256
    if (expected === undefined) {
      if (release.checksumAsset === undefined) throw new Error('星露谷发布信息缺少 SHA-256 校验值')
      const checksumText = await (await fetchChecked(release.checksumAsset.url, signal, 'application/octet-stream')).text()
      expected = checksumLine(checksumText, zipAsset.name)
      if (expected === undefined) throw new Error(`SHA256SUMS.txt has no entry for ${zipAsset.name}`)
    }
    const actual = createHash('sha256').update(archive).digest('hex')
    if (actual !== expected) throw new Error(`MOD checksum mismatch: expected ${expected}, received ${actual}`)
    await writeFile(archivePath, archive)

    const extractedPath = join(tempRoot, 'extracted')
    await mkdir(extractedPath)
    await extract(archivePath, { dir: extractedPath })
    const sourcePath = join(extractedPath, MOD_FOLDER_NAME)
    const sourceManifest = await readManifest(join(sourcePath, 'manifest.json'))
    if (sourceManifest?.UniqueID !== 'qimidandapigu.StardewAgent' || sourceManifest.Version === undefined) {
      throw new Error('downloaded archive does not contain a valid Stardew Agent Mod')
    }

    await mkdir(detection.modsPath, { recursive: true })
    const destination = join(detection.modsPath, MOD_FOLDER_NAME)
    safeChild(detection.modsPath, destination)
    let backupPath: string | undefined
    if (await exists(destination)) {
      backupPath = join(
        detection.modsPath,
        `${MOD_FOLDER_NAME}.backup-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
      )
      safeChild(detection.modsPath, backupPath)
      await rename(destination, backupPath)
    }

    try {
      await cp(sourcePath, destination, { recursive: true, errorOnExist: true })
      if (backupPath !== undefined) await preserveStardewConfig(backupPath, destination)
      const installed = await readManifest(join(destination, 'manifest.json'))
      if (installed?.UniqueID !== 'qimidandapigu.StardewAgent') {
        throw new Error('installed MOD failed manifest verification')
      }
    } catch (error) {
      await rm(destination, { recursive: true, force: true })
      if (backupPath !== undefined && await exists(backupPath)) await rename(backupPath, destination)
      throw error
    }

    return {
      installed: true,
      version: sourceManifest.Version,
      gamePath: detection.gamePath,
      modPath: destination,
      ...(backupPath === undefined ? {} : { backupPath }),
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}
