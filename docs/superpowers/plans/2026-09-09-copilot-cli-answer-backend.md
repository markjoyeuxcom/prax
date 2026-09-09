# GitHub Copilot CLI Answer Backend

**Status:** Implemented
**Date:** 2026-09-09

## Goal

Add the local GitHub Copilot CLI as a keyless Answer model. Prax should use the user's existing
`copilot` login, allow `auto` or an explicit entitled model ID, and preserve the existing rule
that CLI-backed answers cannot invoke the in-app assistant's tools.

The provider is GitHub Copilot CLI, whose executable is `copilot`. GitLab Duo CLI is a separate
product exposed through `glab duo cli`; its documented headless mode automatically approves all
tools, so it does not satisfy Prax's answer-only execution boundary.

## Safety contract

- Run `copilot --prompt` in non-interactive, non-streaming text mode.
- Restrict tool availability to one inert documentation tool and deny that same tool. GitHub's
  deny rules take precedence over allow rules. An empty `--available-tools` value is not used
  because the current CLI treats it as unrestricted.
- Disable built-in MCP servers, repository custom instructions, remote control/export, automatic
  updates, and user-question tools for the spawned process.
- Run from an empty scratch directory, serialize processes, and enforce a 120-second timeout.
- Report `supportsTools: false`; reject tool-bearing completions before spawning.
- Keep credentials outside Prax. Availability uses the local binary's quota-free `--version`
  response, while login and rate-limit failures surface on the first real completion.

## Implementation

- `server/chat/copilotCli.js`: binary discovery, prompt serialization, safety-fenced process
  runner, output parsing, timeout, and serialization.
- `server/chat/index.js` and `server/chatProvider.js`: `copilot-cli` registration and `auto`
  default model.
- `public/js/renderSettings.js`: provider card plus keyless binary/model settings.
- `tests/backend/chatCopilotCli.test.js` and `tests/frontend/renderSettings.test.js`: adapter,
  settings persistence, route status, failure behavior, process fencing, and UI contracts.

## Verification

- Focused backend and settings-render tests.
- Live completion through the installed `copilot` binary returned the requested response.
- Full `npm test` and `npm run check` repository gates.

## References

- [GitHub Copilot CLI programmatic use](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically)
- [GitHub Copilot CLI tool controls](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools)
- [GitLab Duo CLI headless mode](https://docs.gitlab.com/user/gitlab_duo_cli/use/)
