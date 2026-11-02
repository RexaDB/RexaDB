import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const SIDECAR = "http://127.0.0.1:4242";

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let usePrivacySwitch: typeof import("@/hooks/use-privacy-switch").usePrivacySwitch;
let useAppUpdate: typeof import("@/hooks/use-app-update").useAppUpdate;
let logAppError: typeof import("@/lib/error-logger").logAppError;
let privacy: typeof import("@/lib/privacy-settings");
let tauri: typeof import("@tauri-apps/api/mocks");
let cleanups: Array<() => void | Promise<void>> = [];
let ipcCalls: string[] = [];

beforeAll(async () => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  react = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  ({ usePrivacySwitch } = await import("@/hooks/use-privacy-switch"));
  ({ useAppUpdate } = await import("@/hooks/use-app-update"));
  ({ logAppError } = await import("@/lib/error-logger"));
  privacy = await import("@/lib/privacy-settings");
  tauri = await import("@tauri-apps/api/mocks");
});

// Test files share a process: put back the globals and the sidecar address.
afterAll(async () => {
  tauri.mockIPC((cmd) => (cmd === "get_api_base_url" ? "http://127.0.0.1:3867" : undefined));
  const { refreshApiBase } = await import("@/lib/api-base");
  await refreshApiBase();
  tauri.clearMocks();
  await GlobalRegistrator.unregister();
});

afterEach(async () => {
  await Promise.all(cleanups.map((cleanup) => cleanup()));
  cleanups = [];
  ipcCalls = [];
  tauri.clearMocks();
  localStorage.clear();
});

function mockDesktop(installKind: string) {
  tauri.mockIPC((cmd) => {
    ipcCalls.push(cmd);
    if (cmd === "install_kind") return installKind;
    if (cmd === "get_api_base_url") return SIDECAR;
    if (cmd === "plugin:app|version") return "1.3.32";
    return undefined;
  });
}

async function renderHook<T>(useHook: () => T) {
  let current = undefined as T;
  function Probe() {
    const value = useHook();
    react.useEffect(() => {
      current = value;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await react.act(async () => {
    root.render(react.createElement(Probe));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanups.push(() => react.act(async () => root.unmount()));
  return {
    get current() {
      return current;
    },
  };
}

const useAutoUpdateSwitch = () =>
  usePrivacySwitch(
    privacy.AUTO_UPDATE_CHECKS_STORAGE_KEY,
    privacy.AUTO_UPDATE_CHECKS_DEFAULT,
  );

describe("the settings switch agrees with the launch gate", () => {
  test("with nothing stored", async () => {
    const result = await renderHook(useAutoUpdateSwitch);
    expect(result.current[0]).toBe(true);
    expect(result.current[0]).toBe(privacy.isAutoUpdateCheckEnabled());
  });

  test("with a corrupt value", async () => {
    localStorage.setItem(privacy.AUTO_UPDATE_CHECKS_STORAGE_KEY, "{nope");
    const result = await renderHook(useAutoUpdateSwitch);
    expect(result.current[0]).toBe(false);
    expect(result.current[0]).toBe(privacy.isAutoUpdateCheckEnabled());
  });

  test("after it is toggled", async () => {
    const result = await renderHook(useAutoUpdateSwitch);
    await react.act(async () => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(privacy.isAutoUpdateCheckEnabled()).toBe(false);
  });
});

describe("with automatic update checks off", () => {
  test("a Nix install is recognized without a release check", async () => {
    localStorage.setItem(privacy.AUTO_UPDATE_CHECKS_STORAGE_KEY, "false");
    mockDesktop("nix");
    const result = await renderHook(useAppUpdate);
    await react.act(async () => {
      for (let i = 0; i < 100 && result.current.updateState.installKind !== "nix"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    });
    expect(result.current.updateState.installKind).toBe("nix");
    expect(ipcCalls).not.toContain("latest_release_info");
  });
});

describe("the local error log", () => {
  test("reaches the sidecar at its discovered address", async () => {
    mockDesktop("standalone");
    const { refreshApiBase } = await import("@/lib/api-base");
    await refreshApiBase();
    const realFetch = globalThis.fetch;
    const fetchMock = mock(async () => new Response("{}"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    cleanups.push(() => {
      globalThis.fetch = realFetch;
    });

    await logAppError({
      errorType: "test",
      message: "boom",
      stack: null,
      url: null,
      componentStack: null,
      metadata: {},
      appVersion: null,
      os: null,
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${SIDECAR}/api/errors/log`);
  });
});
