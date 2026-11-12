import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { addSkillPathToConfig, bundledSkillsDir, loadBundledSkill, registerBundledSkill } from "../src/skill"
import type { BundledSkill } from "../src/skill"

/** Minimal in-memory stand-in for the V2 skill editor. */
function mockSkillDomain(existing: BundledSkill[] = []) {
  const skills = [...existing]
  return {
    skills,
    transform: async (cb: (editor: never) => void) => {
      cb({
        get: (id: string) => skills.find((s) => s.id === id),
        add: (skill: BundledSkill) => void skills.push(skill),
      } as never)
      return { dispose: async () => undefined }
    },
  }
}

describe("bundled skill", () => {
  test("resolves the skills directory shipped with the package", () => {
    expect(path.isAbsolute(bundledSkillsDir())).toBe(true)
    expect(existsSync(path.join(bundledSkillsDir(), "opencode-ensemble", "SKILL.md"))).toBe(true)
  })

  test("loads SKILL.md with frontmatter parsed and stripped", () => {
    const skill = loadBundledSkill()
    expect(skill).toBeDefined()
    expect(skill?.id).toBe("opencode-ensemble")
    expect(skill?.name).toBe("opencode-ensemble")
    expect(skill?.description).toStartWith("Use when coordinating multiple coding agents")
    expect(skill?.description).not.toContain('"')
    expect(skill?.content).toStartWith("# OpenCode Ensemble")
    expect(skill?.content).not.toContain("license: MIT")
    expect(skill?.path).toBe(path.join(bundledSkillsDir(), "opencode-ensemble", "SKILL.md"))
    // 2.0.3 types call it `location`, the 2.0.32 runtime `path` — carry both.
    expect(skill?.location).toBe(skill?.path)
  })

  test("points the model at absolute reference paths", () => {
    const skill = loadBundledSkill()
    expect(skill?.content).toContain(path.join(bundledSkillsDir(), "opencode-ensemble", "references"))
  })

  test("returns undefined when the skill file is missing", () => {
    expect(loadBundledSkill("/nonexistent/skills")).toBeUndefined()
  })
})

describe("registerBundledSkill (V2)", () => {
  test("adds the skill through the skill transform", async () => {
    const domain = mockSkillDomain()
    expect(await registerBundledSkill(domain)).toBe(true)
    expect(domain.skills.map((s) => s.id)).toEqual(["opencode-ensemble"])
  })

  test("does not clobber a skill the user already installed", async () => {
    const mine = { ...(loadBundledSkill() as BundledSkill), content: "user copy" }
    const domain = mockSkillDomain([mine])
    await registerBundledSkill(domain)
    expect(domain.skills).toHaveLength(1)
    expect(domain.skills[0]?.content).toBe("user copy")
  })

  test("is a no-op on hosts without a skill domain", async () => {
    expect(await registerBundledSkill(undefined)).toBe(false)
  })

  test("swallows host errors instead of failing plugin setup", async () => {
    const domain = { transform: async () => { throw new Error("boom") } }
    expect(await registerBundledSkill(domain)).toBe(false)
  })

  test("skips registration when the skill file is missing", async () => {
    const domain = mockSkillDomain()
    expect(await registerBundledSkill(domain, "/nonexistent/skills")).toBe(false)
    expect(domain.skills).toHaveLength(0)
  })
})

describe("addSkillPathToConfig (V1)", () => {
  test("appends the bundled skills dir, preserving existing paths", () => {
    const config: { skills?: { paths?: string[]; urls?: string[] } } = { skills: { paths: ["/mine"], urls: ["https://x"] } }
    addSkillPathToConfig(config)
    expect(config.skills?.paths).toEqual(["/mine", bundledSkillsDir()])
    expect(config.skills?.urls).toEqual(["https://x"])
  })

  test("creates the skills section and is idempotent", () => {
    const config: { skills?: { paths?: string[] } } = {}
    addSkillPathToConfig(config)
    addSkillPathToConfig(config)
    expect(config.skills?.paths).toEqual([bundledSkillsDir()])
  })

  test("leaves config alone when the bundled dir is missing", () => {
    const config: { skills?: { paths?: string[] } } = {}
    addSkillPathToConfig(config, "/nonexistent/skills")
    expect(config.skills).toBeUndefined()
  })
})
