import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  DbError,
  ValidationError,
  messageForError,
  statusForError,
} from "../../server/effect/errors";
import {
  dynamicPostRoute,
  effectHandler,
  fromPromise,
  simplePostRoute,
} from "../../server/effect/http";
import {
  failureFromExit,
  runServerPromiseExit,
} from "../../server/effect/runtime";

function mockRes() {
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
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get json() {
      return json;
    },
  };
}

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
      const mocked = mockRes();
      await route(
        { body: { n: 7 } } as any,
        mocked.res as any,
        (() => undefined) as any,
      );
      expect(mocked.statusCode).toBe(200);
      expect(mocked.json).toEqual({ success: true, echo: 7 });
    }
  });

  test("effectHandler returns JSON when programFromReq throws synchronously", async () => {
    const route = effectHandler(() => {
      throw new Error("boom while building effect");
    });
    const mocked = mockRes();
    await route(
      { body: {} } as any,
      mocked.res as any,
      (() => undefined) as any,
    );
    expect(mocked.statusCode).toBe(200);
    expect(mocked.json).toEqual({
      success: false,
      error: "boom while building effect",
    });
  });

  test("simplePostRoute returns JSON when callback throws synchronously", async () => {
    const route = simplePostRoute(() => {
      throw new Error("sync post failure");
    });
    const mocked = mockRes();
    await route(
      { body: {} } as any,
      mocked.res as any,
      (() => undefined) as any,
    );
    expect(mocked.statusCode).toBe(200);
    expect(mocked.json).toEqual({
      success: false,
      error: "sync post failure",
    });
  });

  test("dynamicPostRoute loads via call-site import callback", async () => {
    const route = dynamicPostRoute(
      async () => ({
        echo: (body: { n: number }) => ({ success: true, echo: body.n }),
      }),
      (body, m) => m.echo(body),
    );
    const mocked = mockRes();
    await route(
      { body: { n: 3 } } as any,
      mocked.res as any,
      (() => undefined) as any,
    );
    expect(mocked.statusCode).toBe(200);
    expect(mocked.json).toEqual({ success: true, echo: 3 });
  });

  test("simpleGetRoute and studioGetRoute bridge Promises", async () => {
    const { simpleGetRoute, studioGetRoute } = await import(
      "../../server/effect/http"
    );
    const getRoute = simpleGetRoute(async () => ({ ok: true }));
    const getMock = mockRes();
    await getRoute({} as any, getMock.res as any, (() => undefined) as any);
    expect(getMock.json).toEqual({ ok: true });

    const studioRoute = studioGetRoute(async (id) => ({ id }));
    const studioMock = mockRes();
    await studioRoute(
      { params: { connectionId: "42" } } as any,
      studioMock.res as any,
      (() => undefined) as any,
    );
    expect(studioMock.json).toEqual({ id: 42 });
  });

  test("proxyBodyRoute short-circuits when tryProxy handles the request", async () => {
    const { proxyBodyRoute } = await import("../../server/effect/http");
    let ranFn = false;
    const route = proxyBodyRoute(
      async (_req, res) => {
        res.json({ proxied: true });
        return true;
      },
      async () => {
        ranFn = true;
        return { ran: true };
      },
    );
    const mocked = mockRes();
    await route({ body: {} } as any, mocked.res as any, (() => undefined) as any);
    expect(ranFn).toBe(false);
    expect(mocked.json).toEqual({ proxied: true });
  });

  test("proxyBodyRoute runs fn when tryProxy declines", async () => {
    const { proxyBodyRoute } = await import("../../server/effect/http");
    const route = proxyBodyRoute(
      async () => false,
      async (req) => ({ echo: req.body.x }),
    );
    const mocked = mockRes();
    await route(
      { body: { x: 9 } } as any,
      mocked.res as any,
      (() => undefined) as any,
    );
    expect(mocked.json).toEqual({ echo: 9 });
  });
});
