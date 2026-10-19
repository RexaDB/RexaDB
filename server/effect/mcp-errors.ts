import { Data } from "effect";

/** MCP server is disabled or HTTP transport not enabled. */
export class McpDisabledError extends Data.TaggedError("McpDisabledError")<{
  message: string;
  status: number;
}> {}

/** Invalid MCP config or mode. */
export class McpConfigError extends Data.TaggedError("McpConfigError")<{
  message: string;
  status: number;
}> {}

/** MCP HTTP request handler failure. */
export class McpRequestError extends Data.TaggedError("McpRequestError")<{
  message: string;
  status: number;
}> {}
