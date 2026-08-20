import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResolvedConfig } from '../../config.js'
import type { SkillRecord } from './contracts.js'
import { validateSkillProgram } from './skill-runtime.js'

interface SkillDocument { schemaVersion: 1, skills: SkillRecord[], history: SkillRecord[] }

function butterflySkill(now: string): SkillRecord {
  return {
    id: 'dst.hunt-and-collect-butterfly',
    gameId: 'dont-starve-together',
    name: '打蝴蝶并捡起掉落',
    description: '寻找附近最近的蝴蝶，让小汤圆追上并击杀，再把蝴蝶翅膀或黄油捡进自己的容器。',
    triggers: ['打蝴蝶', '抓蝴蝶', '捡蝴蝶', '蝴蝶翅膀', 'butterfly'],
    version: 1,
    status: 'active',
    program: {
      language: 'xiaotangyuan-skill-v1',
      steps: [
        { op: 'call', atom: 'dst.find_nearest_butterfly', args: { radius: 20 }, saveAs: 'target' },
        { op: 'call', atom: 'dst.attack_butterfly', args: { targetId: '$target.targetId' }, saveAs: 'attack' },
        { op: 'call', atom: 'dst.collect_butterfly_loot', args: { x: '$attack.x', z: '$attack.z', radius: 4 }, saveAs: 'loot' },
      ],
    },
    createdAt: now,
    updatedAt: now,
    successCount: 0,
    failureCount: 0,
  }
}

export class SkillStore {
  private readonly path: string
  private document: SkillDocument

  constructor(private readonly config: ResolvedConfig['skills']) {
    mkdirSync(config.directory, { recursive: true })
    this.path = join(config.directory, 'skills-v1.json')
    this.document = this.load()
    this.ensureBuiltins()
  }

  private load(): SkillDocument {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as SkillDocument
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.skills)) {
        return { ...parsed, history: Array.isArray(parsed.history) ? parsed.history : [] }
      }
    } catch {}
    return { schemaVersion: 1, skills: [], history: [] }
  }

  private save(): void {
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify(this.document, null, 2), 'utf8')
    renameSync(temporary, this.path)
  }

  private ensureBuiltins(): void {
    if (!this.document.skills.some(skill => skill.id === 'dst.hunt-and-collect-butterfly')) {
      this.document.skills.push(butterflySkill(new Date().toISOString()))
      this.save()
    }
  }

  get(gameId: string, skillId: string): SkillRecord | undefined {
    return this.document.skills.find(skill => skill.gameId === gameId && skill.id === skillId && skill.status === 'active')
  }

  find(gameId: string, skillId: string): SkillRecord | undefined {
    return this.document.skills.find(skill => skill.gameId === gameId && skill.id === skillId)
  }

  list(gameId: string): SkillRecord[] {
    return this.document.skills.filter(skill => skill.gameId === gameId && skill.status === 'active')
  }

  upsert(record: SkillRecord): SkillRecord {
    if (!/^[a-z0-9][a-z0-9._-]{2,99}$/.test(record.id)) throw new Error('技能 ID 无效')
    if (record.name.trim() === '' || record.description.trim() === '') throw new Error('技能名称和描述不能为空')
    validateSkillProgram(record.program)
    const index = this.document.skills.findIndex(skill => skill.gameId === record.gameId && skill.id === record.id)
    const now = new Date().toISOString()
    const next = { ...record, updatedAt: now }
    if (index < 0) this.document.skills.push(next)
    else {
      this.document.history.push({ ...this.document.skills[index], status: 'archived' })
      this.document.history = this.document.history.slice(-100)
      this.document.skills[index] = next
    }
    this.enforceLimit(record.gameId, record.id)
    this.save()
    return next
  }

  recordRun(gameId: string, skillId: string, success: boolean, error?: string): void {
    const skill = this.document.skills.find(item => item.gameId === gameId && item.id === skillId)
    if (skill === undefined) return
    skill.lastUsedAt = new Date().toISOString()
    skill.successCount += success ? 1 : 0
    skill.failureCount += success ? 0 : 1
    skill.lastError = success ? undefined : error
    this.save()
  }

  private enforceLimit(gameId: string, protectedId: string): void {
    const active = this.document.skills.filter(skill => skill.gameId === gameId && skill.status === 'active')
    while (active.length > this.config.activeLimit) {
      const candidates = active.filter(skill => skill.id !== protectedId)
      const forgotten = candidates.sort((a, b) => {
        const aScore = a.successCount * 3 - a.failureCount + (a.lastUsedAt === undefined ? 0 : 1)
        const bScore = b.successCount * 3 - b.failureCount + (b.lastUsedAt === undefined ? 0 : 1)
        return aScore - bScore || a.updatedAt.localeCompare(b.updatedAt)
      })[0]
      if (forgotten === undefined) break
      forgotten.status = 'archived'
      active.splice(active.indexOf(forgotten), 1)
    }
  }
}
