/**
 * Single place to run Effects at the sidecar edge.
 * Domain modules must not call these — only Express adapters / tests.
 */
import { Cause, Effect, Exit, Option } from "effect";

export type LogFn = (...args: unknown[]) => void;

let logDefect: LogFn = (...args) => {
  try {
    process.stderr.write(
      `[effect] ${args.map((a) => (typeof a === "string" ? a : String(a))).join(" ")}\n`,
    );
  } catch {
    // ignore logging failures
  }
};

/** Optional override so server/index can route defects through logToFile. */
export function setDefectLogger(fn: LogFn): void {
  logDefect = fn;
}

export function runServerPromise<A, E>(
  program: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(program);
}

export function runServerPromiseExit<A, E>(
  program: Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(program);
}

/** Log defects / interruptions from a failed Exit without throwing. */
export function logExitDefects<A, E>(exit: Exit.Exit<A, E>): void {
  if (Exit.isSuccess(exit)) return;
  const cause = exit.cause;
  if (Cause.hasDies(cause) || Cause.hasInterrupts(cause)) {
    logDefect("defect/interrupt:", Cause.pretty(cause));
  }
}

/** Prefer typed failure; otherwise squash cause for a printable error. */
export function failureFromExit<A, E>(exit: Exit.Exit<A, E>): E | unknown {
  if (Exit.isSuccess(exit)) {
    throw new Error("failureFromExit called on success Exit");
  }
  const typed = Cause.findErrorOption(exit.cause);
  if (Option.isSome(typed)) return typed.value;
  return Cause.squash(exit.cause);
}
