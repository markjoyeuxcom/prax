# Templates and starter guides implementation

1. Preserve the existing release and organisation changes in the working tree.
2. Add the shared Template type; refresh CLI/MCP/skill descriptions and bundled skills.
3. Put generic starter Markdown in public/starter-content with a bounded read-only API.
4. Implement an accessible chooser and saved-template action using existing write APIs.
5. Preserve creation drafts and identities; use atomic task import for native checklists.
6. Document fresh-install/upgrade behaviour, package the earlier instructions and remove
   machine-specific startup IDs from the repository's mandatory instructions.
7. Exercise backend, portability, browser and packaging checks; record actual evidence.

Review: no database seeding/migration or title-based overwrite is needed. Static content
already falls within desktop and container public payloads. Keep runtime changes limited
to the new workflow and central taxonomy. Publishing/tagging remains a separate release step.
