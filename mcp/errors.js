// The MCP tools' error classes are the shared transport's
// (server/praxTransport.js), so a tool, the prax CLI and the skills classify a
// failure the same way: PraxUnavailableError (unreachable, or `timedOut`) and
// PraxApiError (an HTTP error with `status`).
export { PraxApiError, PraxUnavailableError } from '../server/praxTransport.js';
