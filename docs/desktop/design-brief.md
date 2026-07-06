# Prax Desktop — Design Brief

A paste-ready prompt for a design tool (e.g. Claude for design work). Self-contained —
the designer does not need repo access. Gives a full feature inventory, sets the
"modern desktop, no console look" direction, and hands over creative freedom.

---

You are a senior product designer. Design a modern desktop application from the
brief below. I want high-fidelity, opinionated design — you have full creative
freedom over the visual language, layout, and interaction model. Surprise me.

## The product

"Prax" is a self-hosted personal console for **tasks, notes, and runbooks**. It's
a single-user tool that runs locally on my own Mac and Windows PC (not a web SaaS, not
a team tool). Today it looks like a quiet, terminal/console-inspired web app. I want to
**throw out the terminal aesthetic entirely** and reimagine it as a polished, modern
desktop application that feels native and calm — something I'd happily live in all day.

Think of the class of apps it should feel at home beside: Linear, Things, Obsidian,
Notion, Craft, Height, Raycast. Not a retro terminal, not a generic Bootstrap dashboard.

## What it does (design real screens for all of this)

1. **Projects** — I organize everything into projects with states: active, on-hold,
   completed, archived. There's an "All projects" cross-project view, a project manager,
   and an archive.

2. **Tasks** — each project has tasks with: title, notes, priority, due date, status.
   I view tasks four ways:
   - **List / queue** (grouped, sortable)
   - **Kanban board** with drag-and-drop columns (priority, in-progress, planned,
     completed) — cards show a priority dot, overdue / due-soon flags, a project chip,
     and small signals (checklist progress, linked-doc count, latest activity).
   - **Backlog**
   - **Archive**
   - A **task detail panel** (drawer) with notes, a checklist, an activity log, and
     links to related documents.

3. **Library** — a Markdown knowledge base of **runbooks and notes**: tags, saved tag
   views, type/sort/group controls, full-text search, and an optional **semantic
   (AI) search** mode. Markdown `.md` import/export.

4. **Editor** — an Obsidian-style Markdown editing workspace: edit / preview / split
   modes, focus mode, live preview, formatting toolbar.

5. **Cross-links** — tasks link to library documents, so operational work points at the
   docs that support it.

6. **Settings** — appearance preferences (themes + font scale), plus admin (backup,
   JSON task import/export).

## Design goals

- **Modern, native desktop feel** for macOS and Windows — real window chrome, a sensible
  sidebar/navigation, comfortable-but-dense information design. Consider platform
  conventions (traffic lights vs. Windows controls, native menus).
- **Drop the console look completely.** No monospace-everything, no faux-terminal green
  text, no CRT vibe. Use a refined typographic and color system of your choosing.
- **Fast and keyboard-driven.** This is a power-user tool: design for keyboard shortcuts,
  a command palette, and quick capture.
- **Light and dark themes**, both first-class.
- **Calm and focused** — lots of Markdown reading/writing, so typography and whitespace
  matter more than chrome.
- Responsive enough to work in a small window and a large one.

## Deliverables

- A cohesive **design system**: color (light + dark), typography, spacing, elevation,
  iconography direction, and core components (sidebar, cards, buttons, inputs, tags,
  chips, drawers, modals, command palette).
- **High-fidelity mockups** of the key screens: project sidebar + list view, the kanban
  board, the task detail drawer, the Markdown library browser, the editor (split mode),
  semantic search, and settings.
- Show at least the **empty state**, a **populated state**, and **dark mode** for the
  main views.
- A short rationale for your direction (the mood/personality you chose and why).

Make bold choices. Prioritize taste and a strong point of view over playing it safe.
