import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { detectStardew, installStardewMod } from '../installation/stardew-valley.js'

const detectionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean', required: true },
    platform: { type: 'string', required: true },
    gamePath: { type: 'string' },
    modsPath: { type: 'string' },
    smapiInstalled: { type: 'boolean', required: true },
    installedVersion: { type: 'string' },
    contentPatcherVersion: { type: 'string' },
    trinketTinkerVersion: { type: 'string' },
    companionPackVersion: { type: 'string' },
  },
} as const

export function registerGameTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'game_mod_detect',
    description: 'Detect the local Stardew Valley installation, SMAPI, and the installed Stardew Agent Mod version. This is read-only and should be called before installation.',
    parameters: {
      gamePath: {
        type: 'string',
        description: 'Optional absolute Stardew Valley installation directory when automatic Steam detection fails.',
      },
    },
    output: {
      schema: detectionSchema,
      render: (_args, value) => [{
        type: 'text',
        text: value.found
          ? `Found Stardew Valley at ${value.gamePath}. SMAPI: ${value.smapiInstalled ? 'installed' : 'missing'}. Agent MOD: ${value.installedVersion ?? 'not installed'}. Content Patcher: ${value.contentPatcherVersion ?? 'missing'}. TrinketTinker: ${value.trinketTinkerVersion ?? 'missing'}. Companion pack: ${value.companionPackVersion ?? 'missing'}.`
          : 'Stardew Valley was not found automatically.',
      }],
    },
    execute: async (args, exec) => detectStardew(args.gamePath, exec.signal),
  }))

  ctx.tools.register(defineTool({
    name: 'game_mod_install',
    description: 'Download, verify, back up, and install or update the Stardew Agent Mod, its XiaoTangYuan companion pack, and required official framework components. Call only after the user explicitly asks to install or update it. SMAPI must already be installed.',
    parameters: {
      confirmed: {
        type: 'boolean',
        required: true,
        description: 'Must be true only when the user explicitly requested this installation or update.',
      },
      gamePath: {
        type: 'string',
        description: 'Optional absolute Stardew Valley installation directory when automatic Steam detection fails.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          installed: { type: 'boolean', required: true },
          version: { type: 'string', required: true },
          gamePath: { type: 'string', required: true },
          modPath: { type: 'string', required: true },
          backupPath: { type: 'string' },
          components: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Installed Stardew Agent Mod ${value.version} at ${value.modPath}. Components: ${value.components}.${value.backupPath === undefined ? '' : ` Previous version backed up to ${value.backupPath}.`} Restart Stardew Valley through SMAPI to load it.`,
      }],
    },
    async execute(args, exec) {
      if (!args.confirmed) throw new Error('installation requires confirmed=true after an explicit user request')
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(120_000)])
      return installStardewMod(args.gamePath, signal)
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Install Stardew Agent Mod',
      kind: 'other',
      rawInput: args.gamePath ?? 'auto-detect Steam installation',
    }),
  }))
}
