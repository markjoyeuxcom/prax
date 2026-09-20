# Templates and starter guides

Open **Library → New doc → Templates & guides**. Select a starting point, review its
contents, choose the destination project and title, then create a copy. No AI provider is
required. This chooser is available even when the Library is empty.

- **Repository setup guide:** the procedure for new repositories, existing ones and
  additional checkouts. Normally file a reusable copy in Memory.
- **Project overview:** an editable reference tagged `project-card`, filed in its owning
  project. Fill placeholders with checked facts. New copies are unverified; a person can
  verify the completed overview to give it a dedicated context-pack section.
- **Repository onboarding task:** a planned task with notes and nine native unchecked
  acceptance items. No date is imposed. It uses the existing atomic task import contract
  to create the task and checklist together.
- **Shared agent memory guide:** installation, startup, knowledge ownership, trust and
  handoffs. Normally file reusable guidance in Memory.

Create your own master with **New doc → Reusable template**, or change an existing
document's Type to **Template** in Document info. An active Template has **Use template**
in its editor and appears in the chooser. Select the copy's type when creating it. Only
the title, body and topic tags are copied; verification, history, links, external/code
references and lifecycle state are not transferred. No source document is modified.

The onboarding task is a specialised bundled starter. User-authored Template documents
create Library documents; they do not automatically interpret arbitrary prose as task fields.

## Fresh installations and upgrades

The canonical generic Markdown lives in [public/starter-content](../public/starter-content/).
The server exposes the complete catalogue at `GET /api/library/starters`. Desktop staging
and container packaging include these files with the ordinary public payload. The CLI,
skills and their installation instructions are also included in both payloads.

There is no database seed or migration. Both a fresh database and an upgraded one can open
the current packaged starters. Only choosing Use template/Create task writes to a project.
An upgrade updates the bundled originals; your copies, edits, verification and archives stay
under your control. Existing projects and personal notes still require your database/backup.

The recent repository organisation guidance is also recorded in [Working on Prax](working-on-prax.md),
[agent memory](agent-memory.md), the CLI documentation, root agent instructions and portable
skill instructions. The personalised Library cleanup and historical release evidence are
user data; they are not universal product defaults.

## Recovery and contracts

This tab's session storage preserves the chooser draft and, before any write, its stable
creation identity and reviewed content. A pending attempt locks its fields. Retry uses that
same identity. Document creates use a durable operation receipt and reconcile a lost response by ID;
tasks use an exact-once import receipt. A retry preserves subsequent edits and cannot
recreate a permanently deleted result. Collection refresh failure does not undo or falsely fail a committed create.
Closing the chooser retains unfinished work for reopening in this tab. Discard draft
requires confirmation; after an uncertain response it warns that the copy may already
exist and that discarding the local draft does not delete it. Storage must be
available before the UI will submit a creation. Browser session storage is not a backup.

`template` is accepted by the shared HTTP/MCP/CLI/skill type registry and the Markdown
export format. The existing raw Markdown importer still creates notes; it does not
round-trip front-matter types or trust metadata. The read-only catalogue returns `{version: 1, items: [...]}`; each item
has `id`, `version`, `label`, `title`, `hint`, `target` (`document` or `task`), `tags`, `body`,
and `documentType` for documents. It is a complete bounded product catalogue, not a list
of personal Library templates. Those remain ordinary documents of type `template`.
