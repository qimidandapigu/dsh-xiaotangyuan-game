import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectStardewPath,
  parseSteamLibraryPaths,
  selectStardewRelease,
} from '../src/games/stardew-valley/installer.js'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(path => rm(path, { recursive: true, force: true })))
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
      { tag_name: 'stardew-v0.2.0', draft: false, assets: [{ name: 'mod.zip', url: 'https://example.test', size: 1 }] },
      { tag_name: 'stardew-v0.1.0', draft: false, assets: [] },
    ]).tag_name).toBe('stardew-v0.2.0')
  })

  it('rejects a list with no published Stardew release', () => {
    expect(() => selectStardewRelease([
      { tag_name: 'stardew-v0.2.0', draft: true, assets: [] },
      { tag_name: 'plugin-v0.3.0', draft: false, assets: [] },
    ])).toThrow('no Stardew Valley release')
  })
})
