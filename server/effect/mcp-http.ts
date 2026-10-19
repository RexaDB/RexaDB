import { Effect } from "effect";
import { McpDisabledError, McpRequestError } from "./mcp-errors";
import { loadMcpExternalConfig } from "../../lib/agents/mcp/external-config";
import { handleMcpHttpRequest, isMcpBearerAuthorized } from "../../lib/agents/mcp/http";
import type { Request, Response } from "express";

/** Handle MCP HTTP request with Effect — checks config, auth, then delegates. */
export const handleMcpHttpRequestEffect = (req: Request, res: Response) =>
  Effect.gen(function* () {
    const config = yield* Effect.tryPromise({
      try: () => loadMcpExternalConfig(),
      catch: (cause) =>
        new McpRequestError({
          message: cause instanceof Error ? cause.message : String(cause),
          status: 500,
        }),
    });

    if (!config.enabled || (config.transports !== "http" && config.transports !== "both")) {
      return yield* Effect.fail(
        new McpDisabledError({
          message: "MCP HTTP transport is disabled. Enable it in Settings → MCP Server.",
          status: 503,
        }),
      );
    }

    if (!isMcpBearerAuthorized(req, config.authToken)) {
      return yield* Effect.fail(
        new McpRequestError({
          message: "Unauthorized. Provide Authorization: Bearer <mcp-token>.",
          status: 401,
        }),
      );
    }

    yield* Effect.tryPromise({
      try: () => handleMcpHttpRequest(req, res),
      catch: (cause) =>
        new McpRequestError({
          message: cause instanceof Error ? cause.message : String(cause),
          status: 500,
        }),
    });
  });
