import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectStardewPath,
  isCompatibleStardewRelease,
  parseStardewDistributionManifest,
  parseSteamLibraryPaths,
  preserveStardewConfig,
  selectStardewRelease,
} from '../src/installation/stardew-valley.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('preserveStardewConfig', () => {
  it('restores the previous config over packaged defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stardew-config-test-'))
    temporaryPaths.push(root)
    const backup = join(root, 'backup')
    const destination = join(root, 'destination')
    await mkdir(backup)
    await mkdir(destination)
    await writeFile(join(backup, 'config.json'), '{"TextChatKey":"T"}')
    await writeFile(join(destination, 'config.json'), '{"TextChatKey":"Y"}')

    await expect(preserveStardewConfig(backup, destination)).resolves.toBe(true)
    await expect(readFile(join(destination, 'config.json'), 'utf8')).resolves.toBe('{"TextChatKey":"T"}')
  })

  it('leaves the destination unchanged when no previous config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stardew-config-test-'))
    temporaryPaths.push(root)
    const backup = join(root, 'backup')
    const destination = join(root, 'destination')
    await mkdir(backup)
    await mkdir(destination)
    await writeFile(join(destination, 'config.json'), '{"TextChatKey":"Y"}')

    await expect(preserveStardewConfig(backup, destination)).resolves.toBe(false)
    await expect(readFile(join(destination, 'config.json'), 'utf8')).resolves.toBe('{"TextChatKey":"Y"}')
  })
})

describe('parseStardewDistributionManifest', () => {
  const validManifest = {
    schemaVersion: 1,
    tag: 'stardew-v0.4.0',
    version: '0.4.0',
    archive: {
      name: 'dsh-xiaotangyuan-game-stardew-0.4.0.zip',
      url: 'https://github.com/qimidandapigu/dsh-xiaotangyuan-game/releases/download/stardew-v0.4.0/dsh-xiaotangyuan-game-stardew-0.4.0.zip',
      size: 39081,
      sha256: '0a1b712f4ca0498e79d742cfe6c0c3fea9d49a64300505e1590044da7a233a3b',
    },
  }

  it('accepts the official static release manifest', () => {
    expect(parseStardewDistributionManifest(validManifest)).toEqual(validManifest)
  })

  it('rejects a mismatched version or foreign archive URL', () => {
    expect(() => parseStardewDistributionManifest({ ...validManifest, version: '0.3.0' })).toThrow('版本与标签不一致')
    expect(() => parseStardewDistributionManifest({
      ...validManifest,
      archive: { ...validManifest.archive, url: 'https://example.test/mod.zip' },
    })).toThrow('非官方安装地址')
  })

  it('rejects an invalid checksum', () => {
    expect(() => parseStardewDistributionManifest({
      ...validManifest,
      archive: { ...validManifest.archive, sha256: 'not-a-checksum' },
    })).toThrow('无效的 SHA-256')
  })
})

describe('parseSteamLibraryPaths', () => {
  it('reads and deduplicates Steam library paths', () => {
    const paths = parseSteamLibraryPaths(`
      "1" { "path" "D:\\\\SteamLibrary" }
      "2" { "path" "E:\\\\Games" }
      "3" { "path" "D:\\\\SteamLibrary" }
    `)
    expect(paths).toEqual(['D:\\SteamLibrary', 'E:\\Games'])
  })
})

describe('inspectStardewPath', () => {
  it('reports SMAPI and the installed MOD version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stardew-detect-test-'))
    temporaryPaths.push(root)
    await writeFile(join(root, 'Stardew Valley.dll'), '')
    await writeFile(join(root, process.platform === 'win32' ? 'StardewModdingAPI.exe' : 'StardewModdingAPI'), '')
    const modPath = join(root, 'Mods', 'StardewAgentMod')
    await mkdir(modPath, { recursive: true })
    await writeFile(join(modPath, 'manifest.json'), JSON.stringify({ Version: '0.1.0' }))

    await expect(inspectStardewPath(root)).resolves.toMatchObject({
      found: true,
      smapiInstalled: true,
      installedVersion: '0.1.0',
    })
  })

  it('rejects a directory without a game marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stardew-detect-test-'))
    temporaryPaths.push(root)
    await expect(inspectStardewPath(root)).resolves.toBeUndefined()
  })
})

describe('selectStardewRelease', () => {
  it('selects the newest Stardew release and skips plugin releases', () => {
    expect(selectStardewRelease([
      { tag_name: 'plugin-v0.3.0', draft: false, assets: [] },
      { tag_name: 'stardew-v0.3.0', draft: false, assets: [{ name: 'mod.zip', url: 'https://example.test', size: 1 }] },
      { tag_name: 'stardew-v0.2.0', draft: false, assets: [{ name: 'mod.zip', url: 'https://example.test', size: 1 }] },
      { tag_name: 'stardew-v0.1.0', draft: false, assets: [] },
    ]).tag_name).toBe('stardew-v0.3.0')
  })

  it('rejects a list with no published Stardew release', () => {
    expect(() => selectStardewRelease([
      { tag_name: 'stardew-v0.2.0', draft: true, assets: [] },
      { tag_name: 'plugin-v0.3.0', draft: false, assets: [] },
    ])).toThrow('no Stardew Valley release')
  })

  it('rejects releases older than the first Harness-owned voice adapter', () => {
    expect(isCompatibleStardewRelease('stardew-v0.2.0')).toBe(false)
    expect(isCompatibleStardewRelease('stardew-v0.3.0')).toBe(true)
    expect(isCompatibleStardewRelease('stardew-v1.0.0')).toBe(true)
  })
})
