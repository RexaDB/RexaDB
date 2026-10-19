import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  DbError,
  ValidationError,
  messageForError,
  statusForError,
} from "../../server/effect/errors";
import { fromPromise, simplePostRoute } from "../../server/effect/http";
import {
  failureFromExit,
  runServerPromiseExit,
} from "../../server/effect/runtime";

describe("server/effect errors", () => {
  test("statusForError maps tagged errors", () => {
    expect(statusForError(new ValidationError({ message: "bad" }))).toBe(400);
    expect(statusForError(new DbError({ message: "db", status: 503 }))).toBe(503);
    expect(statusForError(new Error("plain"))).toBe(200);
    expect(statusForError(new Error("plain"), 500)).toBe(500);
  });

  test("messageForError reads tagged and Error messages", () => {
    expect(messageForError(new ValidationError({ message: "nope" }))).toBe("nope");
    expect(messageForError(new Error("boom"))).toBe("boom");
  });
});

describe("server/effect runtime", () => {
  test("runServerPromiseExit captures tagged failure", async () => {
    const exit = await runServerPromiseExit(
      Effect.fail(new ValidationError({ message: "invalid" })),
    );
    const err = failureFromExit(exit) as ValidationError;
    expect(err._tag).toBe("ValidationError");
    expect(err.message).toBe("invalid");
  });
});

describe("server/effect http bridge", () => {
  test("fromPromise succeeds and remaps rejection", async () => {
    const ok = await Effect.runPromise(fromPromise(async () => 42));
    expect(ok).toBe(42);

    const exit = await runServerPromiseExit(
      fromPromise(
        async () => {
          throw new Error("nope");
        },
        (cause) =>
          new DbError({
            message: cause instanceof Error ? cause.message : "x",
          }),
      ),
    );
    const err = failureFromExit(exit) as DbError;
    expect(err._tag).toBe("DbError");
    expect(err.message).toBe("nope");
  });

  test("simplePostRoute accepts Promise and Effect", async () => {
    const promiseRoute = simplePostRoute(async (body) => ({
      success: true,
      echo: body.n,
    }));
    const effectRoute = simplePostRoute((body) =>
      Effect.succeed({ success: true, echo: body.n }),
    );

    for (const route of [promiseRoute, effectRoute]) {
      let statusCode = 200;
      let json: unknown;
      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          json = payload;
        },
      };
      await route(
        { body: { n: 7 } } as any,
        res as any,
        (() => undefined) as any,
      );
      expect(statusCode).toBe(200);
      expect(json).toEqual({ success: true, echo: 7 });
    }
  });
});
