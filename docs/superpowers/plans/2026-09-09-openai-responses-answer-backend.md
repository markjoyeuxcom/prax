# OpenAI Responses API Answer Backend

**Status:** Implemented
**Date:** 2026-09-09

## Problem

Prax sends the OpenAI Answer backend to the legacy Chat Completions endpoint. Current OpenAI
models can require the Responses API for tool calling, causing the in-app assistant to return
only `openai chat failed: 400`. The adapter also discards the provider's diagnostic message.

## Design

- Use `POST /v1/responses` for the real OpenAI backend.
- Keep `POST /v1/chat/completions` for the explicit llama.cpp backend.
- Translate Prax messages, function declarations, function calls, and function outputs to the
  Responses wire format.
- Set `store: false` and replay the complete response output on tool continuations. This keeps
  reasoning items intact without introducing provider-side response retention.
- Omit optional temperature hints because some reasoning models reject non-default sampling
  controls. Map Prax's output limit to `max_output_tokens`.
- Preserve provider output through the approval boundary with bounded, allowlisted
  deserialization.
- Include OpenAI's bounded error message in failures while keeping credentials out of errors.

## Regression evidence

Focused tests cover plain response text, function declarations, function-call parsing,
stateless encrypted reasoning replay, approval round trips, legacy llama.cpp compatibility,
safe error details, and malformed responses.

## References

- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
