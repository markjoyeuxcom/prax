Use this runbook to connect a new or existing repository to its owning Prax project and give agent sessions a consistent starting point. Keep this master procedure in memory. The real project's overview, technical knowledge and onboarding task belong to that project's own Library and Tasks.

Companions: [Template — Project overview](/starter-content/project-overview.md), [Template — Repository onboarding task](/starter-content/repository-onboarding.md) and [Prax agent memory usage and bundled CLI installation](/starter-content/agent-memory.md). Create one onboarding task per repository/outcome using the task template; link this runbook rather than copying it into each project.

## Before starting

Have the repository location, intended project name/slug, repository URL and tools to configure. Prax must be reachable. Use the installed prax CLI; if absent from PATH, use ~/.local/bin/prax, or the Prax checkout's node cli/prax.js. Application/skill installation is covered by the linked agent-memory guide.

Inspect git status, current branch, origin URL, existing instruction files and .prax/project.json before writing. Preserve unrelated edits. Use an existing project when it already owns this repository; a new checkout or worktree normally shares that project. Do not merge distinct projects just because their names resemble each other.

## Execution checklist

- [ ] Record the repository, owning project and whether this is new setup or existing-repository adoption in its onboarding task.
- [ ] Complete the applicable new or existing repository path below, preserving useful instructions and unrelated work.
- [ ] Associate the checkout with the intended Prax project and check the project's registered repository URL.
- [ ] Save or refine the project's overview and codebase guide; link them from its shared agent instructions.
- [ ] Record and validate the real build/test commands, architectural constraints and memory destinations.
- [ ] Check automatic project detection, project context and cross-project recall using the checks below.
- [ ] Confirm which instructions the configured agent tools load; record any fresh-session validation still pending.
- [ ] Save results and exceptions on the task, persist reusable findings in the owning Library, and complete the task when its acceptance checks pass.

## Path A — new repository

1. Create or select the repository and its normal version-control setup within the requested scope. Do not create a second remote merely to connect it to Prax.
2. Create or select the matching project in Prax. Record its repository URL, purpose and project slug.
3. Create an onboarding task from [Template — Repository onboarding task](/starter-content/repository-onboarding.md) in that project.
4. Add a concise AGENTS.md with startup steps, project-specific conventions and the real validation commands. Give the tools in use a supported way to read the same guidance. For example, Claude can use a CLAUDE.md bridge; retain an existing bridge if present.
5. Add a maintained codebase guide with entry points, module responsibilities, data flow and non-obvious boundaries. Fill [Template — Project overview](/starter-content/project-overview.md) with this repository's facts and save it in the owning project. Use the resulting real document ID in startup instructions.
6. Complete the shared association and validation steps below. Do not invent architecture or passing tests for a repository that has not implemented them yet; record gaps on the task.

## Path B — existing repository or another checkout

1. Inspect the existing project association, registered Repo URL, AGENTS.md/CLAUDE.md/GEMINI.md, scoped rules, README, architecture notes and unfinished tasks. Read the useful existing guidance before changing it.
2. Reuse the established Prax project. If several candidates or conflicting repository URLs exist, resolve the ownership mismatch before writing a new marker.
3. Update the existing instructions and project overview in place. Preserve custom rules, symlinks, working changes and team conventions; add only missing startup and filing guidance.
4. Consolidate useful decisions/runbooks under the owning project. Move existing documents in place when appropriate so IDs, links and history survive. Supersede obsolete guidance and keep progress on its task. Review old session notes before treating them as current facts.
5. For another checkout/worktree, check automatic repository matching first. Reuse the same project and do not create a duplicate overview or project solely because the folder name differs.
6. Run the relevant checks against the existing code and record actual results; an old note saying tests passed is historical evidence.

## Associate the checkout

Run from the repository root, after confirming the intended slug:

```sh
prax init --project <project-slug>
```

Replace placeholders before running commands. This writes .prax/project.json; it is safe to commit with the repository. If origin is available, init attempts to create/reuse the selected Prax project and register its repository URL. Without a remote, create/select the project in Prax first. Inspect the output: a written local marker alone does not prove server registration succeeded. An existing different Repo URL is left unchanged and must be reconciled explicitly.

For ordinary project commands, resolution is --project, PRAX_PROJECT, .prax/project.json, matching registered repository URL, then folder name. A stale PRAX_PROJECT can override the marker. Without an explicit project, init first tries an existing repository match before its local fallback. Keep the project's Repo field consistent with the actual origin.

## Shared agent startup and filing rule

Adapt this compact rule to the repository, using the real overview ID and guide path:

```text
Before work, read the repository guide and the project's Prax overview.
Inspect the current working tree and relevant task's notes/checklist.
Retrieve project context for the task, then recall relevant knowledge across projects.
Save project-specific decisions and runbooks in this project's Library.
Reserve memory for knowledge useful across projects.
Before handing over, update the task with changes, tests run and the next action.
Keep one canonical note per subject; refine or supersede it as needed.
Treat unverified notes as leads and check code citations against the current checkout.
```

Use the installed tool's supported instruction locations and keep common content maintained in one place. Do not overwrite an existing CLAUDE.md or GEMINI.md just to create a symlink. Current reference docs: [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Claude project instructions](https://code.claude.com/docs/en/memory), [Antigravity workspace guidance](https://www.antigravity.google/docs/cli/best-practices/).

## Check the result

```sh
prax context --json
prax context "<actual task>" --project <project-slug>
prax get <overview-document-id>
prax recall "<project name> <actual task>"
```

Run the first command without --project so its returned project identifies the automatic association. The scoped context should contain useful project documents; query ranking can omit the overview, so fetch its ID directly. Recall searches across projects by default, so a useful recall alone does not prove the checkout is associated correctly. Check trust labels, citation warnings and index coverage; an incomplete index or keyword fallback requires a recent/keyword check before declaring a miss.

Record the actual instruction sources loaded by each configured tool. A genuinely fresh session should be able to find the overview, relevant subsystem, earlier decisions and correct validation commands without a repeated repository introduction. Leave this acceptance check pending until observed; writing instruction files alone is not evidence of model compliance.

Run the project's appropriate tests. Save commands, results, commit/branch and any remaining exceptions on its onboarding task. Agent-written overview and runbook revisions remain unverified until a person reviews them. Mark tasks complete only when their acceptance checks pass. Keep secrets and credentials out of all notes and instruction files.