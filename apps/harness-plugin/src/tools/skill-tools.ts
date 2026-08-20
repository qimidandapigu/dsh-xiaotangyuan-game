import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { AdapterHello } from '../protocol/game.js'
import type { GameAtomExecutor } from '../runtime/skills/contracts.js'
import type { SkillService } from '../runtime/skills/skill-service.js'
import type { SkillProgram } from '../runtime/skills/contracts.js'

export function registerSkillTools(
  ctx: Context,
  adapter: AdapterHello | undefined,
  skills: SkillService,
  executor: GameAtomExecutor,
): void {
  const gameId = adapter?.gameId ?? 'unknown'
  const available = skills.store.list(gameId)
  const allowedAtoms = new Set((adapter?.capabilities ?? []).filter(capability =>
    !capability.startsWith('assistant.') && !capability.startsWith('speech.')))
  if (available.length > 0) ctx.tools.register(defineTool({
    name: 'xiaotangyuan_skill_run',
    description: `执行小汤圆已经学会的游戏技能。玩家要求实际行动时必须调用；成功与否只以工具结果为准。当前技能：${available.map(skill => `${skill.id}（${skill.triggers.join('、')}）`).join('；')}`,
    parameters: {
      skillId: { type: 'string', required: true, description: '要执行的技能 ID。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          skillId: { type: 'string', required: true },
          skillVersion: { type: 'number', required: true },
          message: { type: 'string', required: true },
          traceJson: { type: 'string', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    execute: async (args, exec) => {
      const result = await skills.run(gameId, args.skillId, allowedAtoms, executor, exec.signal)
      return {
        success: result.success,
        skillId: result.skillId,
        skillVersion: result.skillVersion,
        message: result.success ? '技能执行成功。' : `技能执行失败：${result.error}`,
        traceJson: JSON.stringify(result.trace),
        ...(result.error === undefined ? {} : { error: result.error }),
      }
    },
  }))

  if (allowedAtoms.size === 0) return
  ctx.tools.register(defineTool({
    name: 'xiaotangyuan_skill_save',
    description: `创建或修改一段可执行技能程序。只在玩家明确教学/修改技能，或已有技能因程序步骤错误需要修复时调用；环境暂时没有目标、距离过远、容器已满等不是程序错误，不能改代码。程序只能组合 Adapter 已声明的原子能力：${[...allowedAtoms].join('、')}`,
    parameters: {
      skillId: { type: 'string', required: true, description: '稳定技能 ID，例如 dst.hunt-and-collect-butterfly。' },
      name: { type: 'string', required: true, description: '简短技能名称。' },
      description: { type: 'string', required: true, description: '技能要完成的目标。' },
      triggers: { type: 'string', required: true, description: '逗号分隔的玩家触发说法。' },
      programJson: { type: 'string', required: true, description: 'xiaotangyuan-skill-v1 JSON 程序，包含 language 和 1-20 个 call 步骤。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          skillId: { type: 'string', required: true },
          version: { type: 'number', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    execute: async args => {
      let program: SkillProgram
      try {
        program = JSON.parse(args.programJson) as SkillProgram
      } catch {
        throw new Error('技能程序不是有效 JSON')
      }
      const skill = skills.saveGenerated({
        gameId, skillId: args.skillId, name: args.name, description: args.description,
        triggers: args.triggers.split(/[,，]/).map(item => item.trim()).filter(Boolean),
        program,
      }, allowedAtoms)
      return { success: true, skillId: skill.id, version: skill.version, message: `我把“${skill.name}”记成了第 ${skill.version} 版技能。` }
    },
  }))
}
