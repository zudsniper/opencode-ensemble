import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SKILL_ID = "opencode-ensemble"

/**
 * Skill record registered with the host. `path` is what the OpenCode 2.0.32
 * runtime reads; `location` is the same field under its @opencode/plugin 2.0.3
 * name. Both are set so either host version resolves the skill file.
 */
export interface BundledSkill {
  id: string
  name: string
  description: string
  path: string
  location: string
  content: string
}

/** Structural subset of the V2 `ctx.skill` domain (mock-friendly). */
export interface SkillDomainLike {
  transform(cb: (editor: never) => void): Promise<unknown>
}

/** Structural subset of a host config that carries skill search paths. */
export interface SkillConfigLike {
  skills?: { paths?: string[] }
}

interface SkillEditorLike {
  get(id: string): unknown
  add(skill: BundledSkill): void
}

/**
 * Absolute path of the `skills/` directory shipped with the package. Resolved
 * relative to this module, which sits one level below the package root both as
 * `src/skill.ts` and when bundled into `dist/index.js`.
 */
export function bundledSkillsDir(): string {
  return fileURLToPath(new URL("../skills", import.meta.url))
}

/** Read one scalar frontmatter value, dropping optional surrounding quotes. */
function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"))
  return match?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2")
}

/**
 * Load the bundled Ensemble skill from disk: frontmatter becomes the skill
 * metadata, the body becomes its content. Returns undefined when the file is
 * missing or malformed so callers can skip registration instead of failing.
 */
export function loadBundledSkill(skillsDir: string = bundledSkillsDir()): BundledSkill | undefined {
  const skillDir = path.join(skillsDir, SKILL_ID)
  const skillPath = path.join(skillDir, "SKILL.md")
  if (!existsSync(skillPath)) return undefined

  const match = readFileSync(skillPath, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return undefined
  const [, frontmatter = "", body = ""] = match
  const description = frontmatterValue(frontmatter, "description")
  if (!description) return undefined

  // The skill refers to `references/*.md` relatively; an embedded skill has no
  // implied base directory, so spell out where those files are.
  const content = `${body.trim()}\n\nReference files for this skill are in ${path.join(skillDir, "references")}.\n`
  return {
    id: SKILL_ID,
    name: frontmatterValue(frontmatter, "name") ?? SKILL_ID,
    description,
    path: skillPath,
    location: skillPath,
    content,
  }
}

/**
 * Register the bundled skill on a V2 host through `ctx.skill.transform`, so the
 * model sees it in its available-skills list without a separate install step.
 * A skill with the same id that the user already installed wins. Never throws:
 * a host without skill support just runs without the skill.
 */
export async function registerBundledSkill(
  domain: SkillDomainLike | undefined,
  skillsDir: string = bundledSkillsDir(),
): Promise<boolean> {
  if (typeof domain?.transform !== "function") return false
  const skill = loadBundledSkill(skillsDir)
  if (!skill) return false
  try {
    await domain.transform((raw) => {
      const editor = raw as unknown as SkillEditorLike
      if (editor.get(skill.id)) return
      editor.add(skill)
    })
    return true
  } catch {
    return false
  }
}

/**
 * Add the bundled skills directory to a V1 host config (`skills.paths`) from
 * the plugin `config` hook, so the host discovers the skill on its own.
 */
export function addSkillPathToConfig(config: SkillConfigLike, skillsDir: string = bundledSkillsDir()): void {
  if (!existsSync(path.join(skillsDir, SKILL_ID, "SKILL.md"))) return
  const paths = config.skills?.paths ?? []
  if (paths.includes(skillsDir)) return
  config.skills = { ...config.skills, paths: [...paths, skillsDir] }
}
