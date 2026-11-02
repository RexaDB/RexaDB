import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AUTO_UPDATE_CHECKS_STORAGE_KEY,
  DIAGNOSTICS_STORAGE_KEY,
  isAutoUpdateCheckEnabled,
  isDiagnosticsEnabled,
} from "@/lib/privacy-settings";

const rpc = mock(async () => ({ error: null }));
mock.module("@/lib/supabase/backend-client", () => ({
  getBackendClient: async () => ({ rpc }),
}));

const { logAppError } = await import("@/lib/error-logger");

const payload = {
  errorType: "react-root-error",
  message: "boom",
  stack: null,
  url: null,
  componentStack: null,
  metadata: {},
  appVersion: null,
  os: null,
};

let store: Map<string, string>;
const realFetch = globalThis.fetch;
const realLocalStorage = globalThis.localStorage;
const fetchMock = mock(async () => new Response("{}"));

function setStorage(storage: unknown) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

beforeEach(() => {
  store = new Map();
  setStorage({
    getItem: (key: string) => store.get(key) ?? null,
  });
  rpc.mockClear();
  fetchMock.mockClear();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  setStorage(realLocalStorage);
  globalThis.fetch = realFetch;
});

describe("privacy defaults", () => {
  test("diagnostics are opt-in", () => {
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  test("automatic update checks are on until turned off", () => {
    expect(isAutoUpdateCheckEnabled()).toBe(true);
    store.set(AUTO_UPDATE_CHECKS_STORAGE_KEY, "false");
    expect(isAutoUpdateCheckEnabled()).toBe(false);
  });

  test("a corrupt value counts as off", () => {
    store.set(AUTO_UPDATE_CHECKS_STORAGE_KEY, "{nope");
    store.set(DIAGNOSTICS_STORAGE_KEY, "{nope");
    expect(isAutoUpdateCheckEnabled()).toBe(false);
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  test("unavailable storage counts as off", () => {
    setStorage({
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(isAutoUpdateCheckEnabled()).toBe(false);
    expect(isDiagnosticsEnabled()).toBe(false);
  });
});

describe("logAppError", () => {
  test("stays on the device without consent", async () => {
    await logAppError(payload);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain(":3867/api/errors/log");
  });

  test("uploads once diagnostics are turned on", async () => {
    store.set(DIAGNOSTICS_STORAGE_KEY, "true");
    await logAppError(payload);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
