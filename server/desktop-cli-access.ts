import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { DESKTOP_CLI_HEADER, DESKTOP_CLI_ONLY } from "../lib/agents/desktop-access";

/** The native host supplies a fresh secret via child env and trusted Tauri IPC.
 * A standalone web server has no secret and cannot enable local CLI access.
 */
export function desktopCliAccess(token = process.env.REXADB_DESKTOP_CLI_TOKEN || ""): RequestHandler {
  return (req, res, next) => {
    const supplied = req.get(DESKTOP_CLI_HEADER) || "";
    const expectedBytes = Buffer.from(token);
    const suppliedBytes = Buffer.from(supplied);
    if (!token || expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      res.status(403).json({ error: DESKTOP_CLI_ONLY });
      return;
    }
    next();
  };
}
