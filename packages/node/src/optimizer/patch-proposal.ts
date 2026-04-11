import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

export type PatchType =
  | "prompt"
  | "memory-schema"
  | "routing-rule"
  | "skill-add"
  | "skill-deprecate"
  | "sop-update"

export type PatchStatus = "pending" | "approved" | "rejected" | "applied"

export interface PatchProposal {
  id: string
  type: PatchType
  title: string
  description: string
  targetFile?: string
  diff?: string
  priority: "low" | "medium" | "high"
  status: PatchStatus
  evidence: string[]
  createdAt: number
  reviewedAt?: number
  appliedAt?: number
  reviewNote?: string
}

export class PatchProposalManager {
  private proposals: PatchProposal[] = []

  create(proposal: Omit<PatchProposal, "id" | "status" | "createdAt">): PatchProposal {
    const created: PatchProposal = {
      ...proposal,
      id: this.generateId(),
      status: "pending",
      createdAt: Date.now(),
    }

    this.proposals.push(created)
    return { ...created, evidence: [...created.evidence] }
  }

  getPending(): PatchProposal[] {
    return this.proposals
      .filter((proposal) => proposal.status === "pending")
      .map((proposal) => this.cloneProposal(proposal))
  }

  review(id: string, approved: boolean, note?: string): PatchProposal {
    const proposal = this.findById(id)

    proposal.status = approved ? "approved" : "rejected"
    proposal.reviewedAt = Date.now()
    proposal.reviewNote = note

    return this.cloneProposal(proposal)
  }

  markApplied(id: string): PatchProposal {
    const proposal = this.findById(id)

    proposal.status = "applied"
    proposal.appliedAt = Date.now()

    if (!proposal.reviewedAt) {
      proposal.reviewedAt = proposal.appliedAt
    }

    return this.cloneProposal(proposal)
  }

  list(status?: PatchStatus): PatchProposal[] {
    const proposals = status
      ? this.proposals.filter((proposal) => proposal.status === status)
      : this.proposals

    return proposals.map((proposal) => this.cloneProposal(proposal))
  }

  exportMarkdown(proposals: PatchProposal[] = this.proposals): string {
    if (proposals.length === 0) {
      return "# Patch Proposals\n\n_No proposals available._\n"
    }

    const lines: string[] = ["# Patch Proposals", ""]

    for (const proposal of proposals) {
      lines.push(`## ${proposal.title} (${proposal.id})`)
      lines.push("")
      lines.push(`- Type: ${proposal.type}`)
      lines.push(`- Priority: ${proposal.priority}`)
      lines.push(`- Status: ${proposal.status}`)
      lines.push(`- Created At: ${new Date(proposal.createdAt).toISOString()}`)

      if (proposal.targetFile) {
        lines.push(`- Target File: ${proposal.targetFile}`)
      }

      if (proposal.reviewedAt) {
        lines.push(`- Reviewed At: ${new Date(proposal.reviewedAt).toISOString()}`)
      }

      if (proposal.appliedAt) {
        lines.push(`- Applied At: ${new Date(proposal.appliedAt).toISOString()}`)
      }

      if (proposal.reviewNote) {
        lines.push(`- Review Note: ${proposal.reviewNote}`)
      }

      lines.push("")
      lines.push("### Description")
      lines.push("")
      lines.push(proposal.description)
      lines.push("")
      lines.push("### Evidence")
      lines.push("")

      for (const item of proposal.evidence) {
        lines.push(`- ${item}`)
      }

      if (proposal.diff) {
        lines.push("")
        lines.push("### Proposed Diff")
        lines.push("")
        lines.push("```diff")
        lines.push(proposal.diff)
        lines.push("```")
      }

      lines.push("")
    }

    return `${lines.join("\n").trimEnd()}\n`
  }

  save(filePath: string): void {
    const resolvedPath = path.resolve(filePath)
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
    fs.writeFileSync(resolvedPath, JSON.stringify(this.proposals, null, 2), "utf8")
  }

  load(filePath: string): void {
    const resolvedPath = path.resolve(filePath)

    if (!fs.existsSync(resolvedPath)) {
      this.proposals = []
      return
    }

    const content = fs.readFileSync(resolvedPath, "utf8")
    const parsed = JSON.parse(content) as PatchProposal[]

    this.proposals = parsed.map((proposal) => ({
      ...proposal,
      evidence: Array.isArray(proposal.evidence) ? [...proposal.evidence] : [],
    }))
  }

  private findById(id: string): PatchProposal {
    const proposal = this.proposals.find((item) => item.id === id)

    if (!proposal) {
      throw new Error(`Patch proposal not found: ${id}`)
    }

    return proposal
  }

  private generateId(): string {
    return `patch_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
  }

  private cloneProposal(proposal: PatchProposal): PatchProposal {
    return {
      ...proposal,
      evidence: [...proposal.evidence],
    }
  }
}
