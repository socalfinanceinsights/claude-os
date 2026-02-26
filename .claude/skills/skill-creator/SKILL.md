---
name: skill-creator
description: "Guides creation of a new skill from scratch using a structured 6-step process. Use when creating a new skill, designing a new capability, or turning a recurring workflow into a reusable skill. Activates on 'create a skill', 'new skill', 'build a skill'."
---

# SKILL: SKILL-CREATOR

## TRIGGER

Activate when:
- User runs `/skill-creator`
- User says "create a skill", "new skill", "build a skill", "turn this into a skill"
- User describes a recurring workflow that should be formalized

**Do NOT activate when:**
- User wants to modify or update an existing skill → route to `/skillsmanager`
- User wants to audit a skill's performance → route to `/skillaudit`

---

## CORE CHARACTER

Skill-creator classifies before building. It does not write a single line of SKILL.md until the taxonomy type is confirmed and requirements are clear. It pushes back when a skill is mislabeled.

**Boundary:** skill-creator creates new skills from scratch. skillsmanager maintains existing ones. No overlap.

---

## STEP 0: CLASSIFY TAXONOMY

Classify what is being built before anything else. Present the classification to the user and confirm.

| Type | Signals | Invoked by |
|------|---------|------------|
| **Interactive skill** | User invokes via `/command`. Runs in main session. No agent spawning. | User |
| **Standards library** | Domain rules only. Never invoked directly. Injected into agent profiles via `skills` field. | Agent profiles |
| **Orchestrating skill** | Spawns agent profiles, coordinates work, synthesizes results. User invokes via `/command`. | User |

**Push back on mislabeling:**
- User describes agent spawning but calls it "simple" → "This sounds like an orchestrating skill — you described agents doing different jobs. Confirm?"
- User describes domain rules but calls it "interactive" → "This sounds like a standards library — it's never invoked directly, only injected. Confirm?"

**For orchestrating skills only:** Check `.claude/agents/` directory. Identify which profiles already exist and can be reused vs. which need to be created. Flag new profiles needed: "This skill needs a [name] agent profile — that's a separate build. I'll scaffold the SKILL.md and note required profiles."

---

## STEP 1: UNDERSTAND

Gather concrete usage examples before designing anything. 2–3 questions per round — don't dump all at once.

**Core questions:**
1. Give me a concrete example of when this skill gets invoked. What does the user say or do?
2. What does it produce? (File? Decision? Action? Briefing to user?)
3. Who or what consumes the output? (User? Another skill? `/build`? An agent?)
4. What breaks if the skill doesn't exist? (This defines the failure mode — core to the description field.)
5. What should it explicitly NOT do? (Boundary definition — prevents scope creep.)

Stop when you have: trigger conditions, output type, consumer, failure mode, out-of-scope boundaries.

---

## STEP 2: PLAN

Identify what the skill needs before touching any file.

| What you need | Where it goes |
|--------------|---------------|
| Workflow steps, rules, trigger conditions | SKILL.md body |
| Reference specs, schemas, examples | `resources/[topic].md` — linked from SKILL.md |
| Config constants | Existing config file or skill body |
| Agent profiles (orchestrating only) | `.claude/agents/[name].md` — flag, don't build here |

**Hub/spoke rule:** Information lives in ONE place. If something is already in a REF file or another skill, link to it — don't duplicate it.

**Size target:** SKILL.md under 500 lines. If your outline exceeds that, move the excess to `resources/`.

**Degrees of freedom — match prescriptiveness to fragility:**
- **High (text guidance):** Context-dependent, multiple valid approaches → "Use your judgment to..."
- **Medium (pseudocode + parameters):** Preferred pattern, some variation → "Follow this workflow, adjusting steps N–M..."
- **Low (exact steps):** Fragile operations, consistency critical → "Run this exact sequence with these exact parameters."

---

## STEP 3: INITIALIZE

Create the directory structure:

```
.claude/skills/[skill-name]/           ← always
.claude/skills/[skill-name]/resources/ ← only if resources needed
```

**Naming rules:**
- Skill directory: lowercase, hyphens, no spaces, max 64 chars
- Resource files: descriptive kebab-case `.md` names

---

## STEP 4: EDIT

Write resources first. Then write SKILL.md. This order prevents SKILL.md from accumulating content that belongs in resources.

### 4a: Write Resources

For each resource file identified in Step 2:
- Dense reference content — resources load on demand, not at startup
- One topic per file
- Write for a Claude instance with zero prior context about this session

### 4b: Write SKILL.md Frontmatter

```yaml
---
name: [skill-name]
description: "[trigger phrases]. [What it does]. Under 300 characters. Third person."
---
```

**Description rules (this is the auto-invocation mechanism):**
- Under 300 characters — hard limit
- Lead with trigger phrases users will actually say
- Third person ("Guides creation of..." not "I guide creation of...")

**When to add non-standard fields:**
- `user-invocable: false` → standards libraries only (hides from `/skills` menu)
- `allowed-tools: Read, Grep, Glob` → only if specific tools need permission bypass
- `context: fork` → ONLY for fully isolated execution. **WARNING: fork strips the Task tool. Never use on skills that spawn subagents.**
- Do not add `model` field — skills inherit session model.

### 4c: Write SKILL.md Body

**Interactive / Standards library structure:**

```markdown
# SKILL: [NAME]

## TRIGGER
[Activate when / Do NOT activate when]

## CORE CHARACTER
[Optional — for complex roles with behavioral constraints.]

## STEP N: [NAME]
[Workflow steps — imperative language]

## RULES
[Hard constraints — numbered, imperative]

## REMEMBER
[Optional — 2–4 key principles as short quotes.]
```

**Orchestrating skill structure** (extends the above):

```markdown
# SKILL: [NAME]

## TRIGGER
[Activate when / Do NOT activate when]

## CORE CHARACTER
[What this orchestrator coordinates. What it does NOT do itself.]

## STEP 0: ASSESS
[Evaluate task complexity. Select agent profiles. Write spawn plan for user visibility.]

## STEP 1: DELEGATE
[Read agent profiles via Runtime Read pattern. Construct four-part task descriptions. Spawn.]

## STEP 2: COLLECT
[Gather results. Check for failures or missing data.]

## STEP 3: SYNTHESIZE
[Cross-reference results. Apply synthesis decision rule. Present to user.]

## STEP 4: VERIFY (if applicable)
[Spawn verification agent. Confirm output correctness.]

## RULES
[Hard constraints — numbered, imperative]

## REMEMBER
[2–4 key principles]
```

**Writing principles (all types):**
- Imperative language: "Read the file" not "You should read the file"
- No narrative padding: don't describe the skill's purpose, demonstrate it through structure
- Exact paths: full absolute paths, not "the skills folder"
- Every `resources/` file must be linked from SKILL.md with a relative path
- Headers are navigation: Claude reads top-down, uses headers to jump to sections

---

## STEP 5: FINALIZE

Run the creation checklist. Every item must pass before the skill is deployed.

- [ ] `name`: lowercase + hyphens only, max 64 chars
- [ ] `description`: under 300 characters, third person, includes trigger phrases
- [ ] SKILL.md body under 500 lines
- [ ] Resource files are `.md` and linked from SKILL.md with relative paths
- [ ] No `.json`, `.csv`, `.gs` files in the skill directory
- [ ] No duplicated content between SKILL.md and resources (one truth, one location)
- [ ] `context: fork` NOT set on any skill that spawns subagents
- [ ] Standards libraries have `user-invocable: false`
- [ ] If orchestrating skill: required agent profiles are flagged, not yet built
- [ ] If orchestrating skill: every spawn uses four-part task description (Objective/Output/Tools/Boundary)
- [ ] If orchestrating skill: Runtime Read pattern used (not hardcoded agent prompts)
- [ ] If orchestrating skill: stop conditions defined
- [ ] If orchestrating skill: `context: fork` NOT set (fork strips Task tool)
- [ ] Test: run `/[skill-name]` and verify it loads

Skills hot-reload — no restart needed after file changes.

---

## STEP 6: ITERATE

Deploy immediately on a real task. Don't assume it works from theory.

After first real use:
- Note where it asked the wrong questions, routed wrong, or produced bad output
- Feed failures into `/skillaudit` → `/skillsmanager` cycle
- Redesign from evidence, not from theory

---

## RULES

1. **Classify before touching files.** Taxonomy determines structure. Confirm type before writing.
2. **Resources first, SKILL.md second.** Writing hub before spokes pulls content into the wrong place.
3. **Hub under 500 lines.** If it's over, something belongs in resources.
4. **One truth, one location.** If content already exists in a REF or another skill, link to it.
5. **Description under 300 characters.** It's a trigger string, not documentation.
6. **Never fork a skill that spawns subagents.** Fork strips the Task tool.
7. **Standards libraries get `user-invocable: false`.** They're injected, not invoked.
8. **No `model` field on skills.** Skills inherit session model.
9. **Test before declaring done.** `/skill-name` load check + `/context` budget check.
10. **Skill-creator creates. Skillsmanager maintains.** If the user wants changes to an existing skill, route to skillsmanager.
