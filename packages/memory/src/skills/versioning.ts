import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface SkillVersion {
  skillId: string
  version: string
  changelog: string
  author: string
  createdAt: number
  isActive: boolean
  rollbackTo?: string
}

export interface VersionDiff {
  skillId: string
  from: string
  to: string
  changes: string[]
}

type VersionStore = Record<string, SkillVersion[]>

const DEFAULT_AUTHOR = 'system'
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

export class SkillVersionManager {
  private versions: VersionStore = {}

  publish(skillId: string, version: string, changelog: string, author = DEFAULT_AUTHOR): SkillVersion {
    this.assertSkillId(skillId)
    this.assertVersion(version)

    const history = this.getSkillVersions(skillId)

    if (history.some((entry) => entry.version === version)) {
      throw new Error(`Version already exists for skill ${skillId}: ${version}`)
    }

    const previousActive = history.find((entry) => entry.isActive)

    history.forEach((entry) => {
      entry.isActive = false
    })

    const nextVersion: SkillVersion = {
      skillId,
      version,
      changelog,
      author,
      createdAt: Date.now(),
      isActive: true,
      rollbackTo: previousActive?.version,
    }

    history.push(nextVersion)
    history.sort((left, right) => this.compareVersions(left.version, right.version))

    return { ...nextVersion }
  }

  rollback(skillId: string, targetVersion: string): SkillVersion {
    this.assertSkillId(skillId)
    this.assertVersion(targetVersion)

    const history = this.getSkillVersions(skillId)
    const target = history.find((entry) => entry.version === targetVersion)

    if (!target) {
      throw new Error(`Version not found for skill ${skillId}: ${targetVersion}`)
    }

    const current = history.find((entry) => entry.isActive)

    history.forEach((entry) => {
      entry.isActive = false
    })

    target.isActive = true
    target.rollbackTo = current && current.version !== target.version ? current.version : target.rollbackTo

    return { ...target }
  }

  getActive(skillId: string): SkillVersion | null {
    this.assertSkillId(skillId)

    const active = this.getSkillVersions(skillId).find((entry) => entry.isActive)
    return active ? { ...active } : null
  }

  getHistory(skillId: string): SkillVersion[] {
    this.assertSkillId(skillId)

    return this.getSkillVersions(skillId)
      .slice()
      .sort((left, right) => this.compareVersions(right.version, left.version))
      .map((entry) => ({ ...entry }))
  }

  diff(skillId: string, from: string, to: string): VersionDiff {
    this.assertSkillId(skillId)
    this.assertVersion(from)
    this.assertVersion(to)

    const history = this.getSkillVersions(skillId)
    const fromVersion = history.find((entry) => entry.version === from)
    const toVersion = history.find((entry) => entry.version === to)

    if (!fromVersion) {
      throw new Error(`Version not found for skill ${skillId}: ${from}`)
    }

    if (!toVersion) {
      throw new Error(`Version not found for skill ${skillId}: ${to}`)
    }

    const lower = this.compareVersions(from, to) <= 0 ? from : to
    const upper = lower === from ? to : from

    const changes = history
      .filter((entry) => this.compareVersions(entry.version, lower) > 0 && this.compareVersions(entry.version, upper) <= 0)
      .sort((left, right) => this.compareVersions(left.version, right.version))
      .map((entry) => `${entry.version}: ${entry.changelog}`)

    if (changes.length === 0 && from !== to) {
      changes.push(`${toVersion.version}: ${toVersion.changelog}`)
    }

    if (from === to) {
      changes.push(`${fromVersion.version}: ${fromVersion.changelog}`)
    }

    return {
      skillId,
      from,
      to,
      changes,
    }
  }

  deprecate(skillId: string, version: string): void {
    this.assertSkillId(skillId)
    this.assertVersion(version)

    const history = this.getSkillVersions(skillId)
    const target = history.find((entry) => entry.version === version)

    if (!target) {
      throw new Error(`Version not found for skill ${skillId}: ${version}`)
    }

    if (target.isActive) {
      throw new Error(`Cannot deprecate active version for skill ${skillId}: ${version}`)
    }

    this.versions[skillId] = history.filter((entry) => entry.version !== version)

    if (this.versions[skillId].length === 0) {
      delete this.versions[skillId]
    }
  }

  save(filePath: string): void {
    writeFileSync(filePath, JSON.stringify(this.versions, null, 2), 'utf8')
  }

  load(filePath: string): void {
    if (!existsSync(filePath)) {
      this.versions = {}
      return
    }

    const raw = readFileSync(filePath, 'utf8').trim()

    if (!raw) {
      this.versions = {}
      return
    }

    const parsed = JSON.parse(raw) as VersionStore
    const nextState: VersionStore = {}

    for (const [skillId, entries] of Object.entries(parsed)) {
      this.assertSkillId(skillId)

      if (!Array.isArray(entries)) {
        throw new Error(`Invalid version history for skill ${skillId}`)
      }

      const normalized = entries.map((entry) => this.normalizeVersion(skillId, entry))
      const activeCount = normalized.filter((entry) => entry.isActive).length

      if (activeCount > 1) {
        throw new Error(`Multiple active versions found for skill ${skillId}`)
      }

      normalized.sort((left, right) => this.compareVersions(left.version, right.version))
      nextState[skillId] = normalized
    }

    this.versions = nextState
  }

  private getSkillVersions(skillId: string): SkillVersion[] {
    if (!this.versions[skillId]) {
      this.versions[skillId] = []
    }

    return this.versions[skillId]
  }

  private normalizeVersion(skillId: string, entry: SkillVersion): SkillVersion {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid version entry for skill ${skillId}`)
    }

    this.assertVersion(entry.version)

    return {
      skillId,
      version: entry.version,
      changelog: typeof entry.changelog === 'string' ? entry.changelog : '',
      author: typeof entry.author === 'string' && entry.author.trim() ? entry.author : DEFAULT_AUTHOR,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
      isActive: Boolean(entry.isActive),
      rollbackTo: typeof entry.rollbackTo === 'string' ? entry.rollbackTo : undefined,
    }
  }

  private assertSkillId(skillId: string): void {
    if (!skillId || !skillId.trim()) {
      throw new Error('skillId is required')
    }
  }

  private assertVersion(version: string): void {
    if (!SEMVER_PATTERN.test(version)) {
      throw new Error(`Invalid semver version: ${version}`)
    }
  }

  private compareVersions(left: string, right: string): number {
    const leftParts = this.parseVersion(left)
    const rightParts = this.parseVersion(right)

    for (let index = 0; index < 3; index += 1) {
      const delta = leftParts.core[index] - rightParts.core[index]
      if (delta !== 0) {
        return delta
      }
    }

    if (!leftParts.prerelease.length && !rightParts.prerelease.length) {
      return 0
    }

    if (!leftParts.prerelease.length) {
      return 1
    }

    if (!rightParts.prerelease.length) {
      return -1
    }

    const length = Math.max(leftParts.prerelease.length, rightParts.prerelease.length)

    for (let index = 0; index < length; index += 1) {
      const leftToken = leftParts.prerelease[index]
      const rightToken = rightParts.prerelease[index]

      if (leftToken === undefined) {
        return -1
      }

      if (rightToken === undefined) {
        return 1
      }

      const leftIsNumber = /^\d+$/.test(leftToken)
      const rightIsNumber = /^\d+$/.test(rightToken)

      if (leftIsNumber && rightIsNumber) {
        const delta = Number(leftToken) - Number(rightToken)
        if (delta !== 0) {
          return delta
        }
        continue
      }

      if (leftIsNumber) {
        return -1
      }

      if (rightIsNumber) {
        return 1
      }

      const delta = leftToken.localeCompare(rightToken)
      if (delta !== 0) {
        return delta
      }
    }

    return 0
  }

  private parseVersion(version: string): { core: [number, number, number]; prerelease: string[] } {
    const [corePart, metadataPart] = version.split('-', 2)
    const [major, minor, patch] = corePart.split('.').map((token) => Number(token)) as [number, number, number]
    const prerelease = metadataPart ? metadataPart.split('+', 1)[0].split('.') : []

    return {
      core: [major, minor, patch],
      prerelease,
    }
  }
}
