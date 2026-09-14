/**
 * Extension host — runs each extension's `main` JS inside a Web Worker sandbox
 * and exposes a VS Code-like `rexa` API over an async RPC channel.
 *
 * Protocol (postMessage):
 *   worker -> host: { kind: "rpc", id, namespace, method, args }
 *   host   -> worker: { kind: "result", id, ok, value|error }
 *   host   -> worker: { kind: "init", extensionId }
 *   host   -> worker: { kind: "execute", handler, args, callId }
 *   worker -> host: { kind: "ready" } | { kind: "log", level, args }
 *   worker -> host: { kind: "handler-result", callId, ok, value|error }
 *
 * Extension code shape (bundled single file, no imports):
 *   globalThis.activate = async (rexa) => { await rexa.commands.registerCommand(...) }
 *   // or: export-style for tests: module.exports.activate / return value of
 *   // evaluateExtensionFactory.
 *
 * In Node/bun (tests) Web Workers may not exist — `runInProcess` executes the
 * factory directly against the same host implementation so behaviour is tested
 * without a browser.
 */

import type { RexaHostApi, RexaTreeItem } from "./types";
import { isWriteQuery } from "./db-bridge";
import type { ExtensionSchemaInfo } from "./db-bridge";

export type HostCallbacks = {
  onLog?: (extensionId: string, level: "log" | "warn" | "error", args: unknown[]) => void;
  /** Manifest capabilities (e.g. `query:write`) for capability gating. */
  resolveCapabilities?: (extensionId: string) => string[];
  commands: {
    register(extensionId: string, command: string, title?: string, group?: string): void;
    execute<T>(command: string, ...args: unknown[]): Promise<T>;
    list(): Array<{ command: string; title: string; group?: string }>;
  };
  window: {
    showMessage(kind: "info" | "warning" | "error", message: string): Promise<void>;
    showInputBox(prompt: string, initialValue?: string): Promise<string | undefined>;
    statusBarCreate(
      extensionId: string,
      id: string,
      text: string,
      opts?: { tooltip?: string; command?: string; alignment?: "left" | "right"; priority?: number },
    ): void;
    statusBarUpdate(extensionId: string, id: string, patch: { text?: string; tooltip?: string }): void;
    webviewViewRegister(extensionId: string, viewId: string, html: string): void;
    sidebarPageRegister(extensionId: string, containerId: string, html: string): void;
    webviewPanelOpen(extensionId: string, panelId: string, html?: string): void;
  };
  tree: {
    registerProvider(extensionId: string, viewId: string): void;
    setChildren(viewId: string, parentId: string | undefined, items: RexaTreeItem[]): void;
  };
  workspace: {
    get(section?: string): Promise<Record<string, unknown>>;
    set(section: string, value: unknown): Promise<void>;
  };
  languages: {
    completionsAdd(languageId: string, items: Array<{ label: string; detail?: string; insertText?: string }>): void;
    formatterAdd(languageId: string, extensionId: string): void;
  };
  db: HostCallbacks["commands"] extends never
    ? never
    : {
        getConnections(): Promise<Array<{ id: number; name: string; dbType: string }>>;
        getActiveConnection(): Promise<{ id: number; name: string; dbType: string } | null>;
        executeQuery<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; fields: string[] }>;
        getSchema(): Promise<ExtensionSchemaInfo>;
        readTable(schema: string, table: string, limit?: number): Promise<{ rows: unknown[]; fields: string[] }>;
        getActiveQuery(): Promise<string>;
        setActiveQuery(sql: string): Promise<void>;
        openVisualizer(visualizerId: string, data: unknown): Promise<void>;
      };
  ai: { registerTool(extensionId: string, tool: { id: string; label: string; description?: string }): void };
  env: { clipboardWrite(text: string): Promise<void> };
  rail: {
    create(
      extensionId: string,
      item: { id: string; title: string; command?: string; viewId?: string; tooltip?: string; icon?: string },
    ): void;
  };
  tabs: { open(extensionId: string, viewId: string, opts?: { title?: string }): void };
};

type PendingCall = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const SHIM_SOURCE = `
const __pending = new Map();
let __seq = 0;
function __call(namespace, method, args) {
  const id = ++__seq;
  return new Promise((resolve, reject) => {
    __pending.set(id, { resolve, reject });
    postMessage({ kind: "rpc", id, namespace, method, args });
  });
}
const __handlers = new Map();
function __registerHandler(name, fn) { __handlers.set(name, fn); }
const rexa = {
  commands: {
    registerCommand: (command, title, group) => __call("commands", "register", [command, title, group]),
    executeCommand: (command, ...args) => __call("commands", "execute", [command, ...args]),
    getCommands: () => __call("commands", "list", []),
  },
  window: {
    showInformationMessage: (m) => __call("window", "showMessage", ["info", m]),
    showWarningMessage: (m) => __call("window", "showMessage", ["warning", m]),
    showErrorMessage: (m) => __call("window", "showMessage", ["error", m]),
    showInputBox: (prompt, initialValue) => __call("window", "showInputBox", [prompt, initialValue]),
    createStatusBarItem: (id, text, opts) => __call("window", "statusBarCreate", [id, text, opts]),
    updateStatusBarItem: (id, patch) => __call("window", "statusBarUpdate", [id, patch]),
    registerTreeDataProvider: (viewId) => __call("tree", "registerProvider", [viewId]),
    registerWebviewView: (viewId, html) => __call("window", "webviewViewRegister", [viewId, html]),
    registerSidebarPage: (containerId, html) => __call("window", "sidebarPageRegister", [containerId, html]),
    openWebviewPanel: (panelId, html) => __call("window", "webviewPanelOpen", [panelId, html]),
    openTab: (viewId, opts) => __call("tabs", "open", [viewId, opts]),
    createRailItem: (id, title, opts) => __call("rail", "create", [id, title, opts]),
  },
  workspace: {
    getConfiguration: (section) => __call("workspace", "get", [section]),
    updateConfiguration: (section, value) => __call("workspace", "set", [section, value]),
  },
  languages: {
    registerCompletionItems: (languageId, items) => __call("languages", "completionsAdd", [languageId, items]),
    registerFormatter: (languageId) => __call("languages", "formatterAdd", [languageId]),
  },
  rexaDb: {
    getConnections: () => __call("db", "getConnections", []),
    getActiveConnection: () => __call("db", "getActiveConnection", []),
    executeQuery: (sql, params) => __call("db", "executeQuery", [sql, params]),
    getSchema: () => __call("db", "getSchema", []),
    readTable: (schema, table, limit) => __call("db", "readTable", [schema, table, limit]),
    getActiveQuery: () => __call("db", "getActiveQuery", []),
    setActiveQuery: (sql) => __call("db", "setActiveQuery", [sql]),
    openResultVisualizer: (id, data) => __call("db", "openVisualizer", [id, data]),
  },
  ai: { registerTool: (tool) => __call("ai", "registerTool", [tool]) },
  env: { clipboardWrite: (text) => __call("env", "clipboardWrite", [text]) },
};
// Tree provider + command handlers live in worker; host asks via "execute".
rexa.__registerHandler = __registerHandler;
onmessage = async (e) => {
  const msg = e.data;
  if (msg?.kind === "result") {
    const p = __pending.get(msg.id);
    if (p) { __pending.delete(msg.id); if (msg.ok) p.resolve(msg.value); else p.reject(new Error(msg.error)); }
    return;
  }
  if (msg?.kind === "init") {
    try {
      const factory = (typeof __extensionActivate === "function") ? __extensionActivate : (typeof activate === "function" ? activate : null);
      if (!factory) { postMessage({ kind: "ready", ok: false, error: "no activate() export found" }); return; }
      // Wrap tree-provider + command callbacks so host can invoke them later.
      rexa.window.__wrapTreeProvider = (viewId, getChildren) => {
        __registerHandler("tree:" + viewId, (parentId) => getChildren(parentId));
        return rexa.window.registerTreeDataProvider(viewId);
      };
      rexa.commands.__wrapRegister = (command, handler, title, group) => {
        __registerHandler("command:" + command, (args) => handler(...(args || [])));
        return rexa.commands.registerCommand(command, title, group);
      };
      await factory(rexa);
      postMessage({ kind: "ready", ok: true });
    } catch (err) {
      postMessage({ kind: "ready", ok: false, error: String(err?.message || err) });
    }
    return;
  }
  if (msg?.kind === "execute") {
    const fn = __handlers.get(msg.handler);
    if (!fn) { postMessage({ kind: "handler-result", callId: msg.callId, ok: false, error: "no handler: " + msg.handler }); return; }
    try {
      const value = await fn(...(msg.args || []));
      postMessage({ kind: "handler-result", callId: msg.callId, ok: true, value });
    } catch (err) {
      postMessage({ kind: "handler-result", callId: msg.callId, ok: false, error: String(err?.message || err) });
    }
  }
};
`;

export function buildWorkerSource(extensionCode: string): string {
  // Extension authors write `async function activate(rexa) {...}` or assign
  // `globalThis.__extensionActivate`. We wrap their code so top-level
  // `function activate` declarations are captured.
  return `${SHIM_SOURCE}\n;var activate;\n;var __extensionActivate;\n${extensionCode}\n;if (typeof activate === "function") { __extensionActivate = activate; }\n`;
}

export interface LoadedExtension {
  extensionId: string;
  worker?: Worker;
  commandHandlers: Map<string, number>; // command -> not used in worker; host re-dispatches
  dispose: () => void;
  executeHandler: (handler: string, args: unknown[]) => Promise<unknown>;
}

export class ExtensionHost {
  private extensions = new Map<string, LoadedExtension>();
  private handlerCalls = new Map<number, PendingCall>();
  private handlerSeq = 0;
  private rpcHandlers = new Map<number, PendingCall>();
  private rpcSeq = 0;

  constructor(private callbacks: HostCallbacks) {}

  get loadedIds(): string[] {
    return [...this.extensions.keys()];
  }

  isLoaded(extensionId: string): boolean {
    return this.extensions.has(extensionId);
  }

  async load(extensionId: string, code: string): Promise<void> {
    if (this.extensions.has(extensionId)) return;
    if (typeof Worker === "undefined") {
      throw new Error("Web Worker sandbox unavailable (SSR/test). Use runInProcess() instead.");
    }
    const source = buildWorkerSource(code);
    const blob = new Blob([source], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const loaded: LoadedExtension = {
      extensionId,
      worker,
      commandHandlers: new Map(),
      dispose: () => {
        worker.terminate();
        URL.revokeObjectURL(url);
      },
      executeHandler: (handler, args) => this.callWorkerHandler(worker, handler, args),
    };
    this.extensions.set(extensionId, loaded);
    const ready = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const onMessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg?.kind === "ready") {
          worker.removeEventListener("message", onMessage as EventListener);
          resolve(msg);
          return;
        }
        this.handleWorkerMessage(extensionId, worker, msg);
      };
      worker.addEventListener("message", onMessage as EventListener);
      worker.addEventListener("error", () => resolve({ ok: false, error: "worker error" }), { once: true });
      // Route all later messages too.
      worker.addEventListener("message", (e) => this.handleWorkerMessage(extensionId, worker, e.data));
      worker.postMessage({ kind: "init", extensionId });
    });
    if (!ready.ok) {
      loaded.dispose();
      this.extensions.delete(extensionId);
      throw new Error(`Extension ${extensionId} failed to activate: ${ready.error}`);
    }
  }

  unload(extensionId: string): void {
    const loaded = this.extensions.get(extensionId);
    if (!loaded) return;
    loaded.dispose();
    this.extensions.delete(extensionId);
  }

  unloadAll(): void {
    for (const id of [...this.extensions.keys()]) this.unload(id);
  }

  /** Host -> worker handler invocation (commands, tree children). */
  invokeWorkerHandler(extensionId: string, handler: string, args: unknown[] = []): Promise<unknown> {
    const loaded = this.extensions.get(extensionId);
    if (!loaded?.worker) return Promise.reject(new Error(`extension not loaded: ${extensionId}`));
    return this.callWorkerHandler(loaded.worker, handler, args);
  }

  private callWorkerHandler(worker: Worker, handler: string, args: unknown[]): Promise<unknown> {
    const callId = ++this.handlerSeq;
    return new Promise((resolve, reject) => {
      this.handlerCalls.set(callId, { resolve, reject });
      worker.postMessage({ kind: "execute", handler, args, callId });
      setTimeout(() => {
        if (this.handlerCalls.has(callId)) {
          this.handlerCalls.delete(callId);
          reject(new Error(`extension handler timed out: ${handler}`));
        }
      }, 30_000);
    });
  }

  private async handleWorkerMessage(extensionId: string, worker: Worker, msg: Record<string, unknown>) {
    if (!msg || typeof msg !== "object") return;
    if (msg.kind === "handler-result") {
      const p = this.handlerCalls.get(msg.callId as number);
      if (p) {
        this.handlerCalls.delete(msg.callId as number);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new Error(String(msg.error)));
      }
      return;
    }
    if (msg.kind === "log") {
      this.callbacks.onLog?.(extensionId, "log", (msg.args as unknown[]) ?? []);
      return;
    }
    if (msg.kind !== "rpc") return;
    const { id, namespace, method, args } = msg as {
      id: number;
      namespace: string;
      method: string;
      args: unknown[];
    };
    try {
      const value = await this.dispatchRpc(extensionId, namespace, method, args ?? []);
      worker.postMessage({ kind: "result", id, ok: true, value });
    } catch (err) {
      worker.postMessage({ kind: "result", id, ok: false, error: String((err as Error)?.message || err) });
    }
  }

  private async dispatchRpc(extensionId: string, namespace: string, method: string, args: unknown[]): Promise<unknown> {
    const cb = this.callbacks;
    switch (`${namespace}.${method}`) {
      case "commands.register":
        cb.commands.register(extensionId, args[0] as string, args[1] as string | undefined, args[2] as string | undefined);
        return true;
      case "commands.execute":
        return cb.commands.execute(args[0] as string, ...(args.slice(1) as unknown[]));
      case "commands.list":
        return cb.commands.list();
      case "window.showMessage":
        return cb.window.showMessage(args[0] as "info" | "warning" | "error", args[1] as string);
      case "window.showInputBox":
        return cb.window.showInputBox(args[0] as string, args[1] as string | undefined);
      case "window.statusBarCreate":
        cb.window.statusBarCreate(extensionId, args[0] as string, args[1] as string, args[2] as never);
        return true;
      case "window.statusBarUpdate":
        cb.window.statusBarUpdate(extensionId, args[0] as string, args[1] as never);
        return true;
      case "window.webviewViewRegister":
        cb.window.webviewViewRegister(extensionId, args[0] as string, args[1] as string);
        return true;
      case "window.sidebarPageRegister":
        cb.window.sidebarPageRegister(extensionId, args[0] as string, args[1] as string);
        return true;
      case "window.webviewPanelOpen":
        cb.window.webviewPanelOpen(extensionId, args[0] as string, args[1] as string | undefined);
        return true;
      case "rail.create":
        cb.rail.create(extensionId, {
          id: args[0] as string,
          title: args[1] as string,
          ...((args[2] as Record<string, string>) ?? {}),
        });
        return true;
      case "tabs.open":
        cb.tabs.open(extensionId, args[0] as string, args[1] as { title?: string } | undefined);
        return true;
      case "tree.registerProvider": {
        cb.tree.registerProvider(extensionId, args[0] as string);
        // Pull initial roots so the React tree can render without waiting.
        const roots = (await this.invokeWorkerHandler(extensionId, `tree:${args[0]}`, [undefined]).catch(() => [])) as RexaTreeItem[];
        cb.tree.setChildren(args[0] as string, undefined, Array.isArray(roots) ? roots : []);
        return true;
      }
      case "workspace.get":
        return cb.workspace.get(args[0] as string | undefined);
      case "workspace.set":
        return cb.workspace.set(args[0] as string, args[1]);
      case "languages.completionsAdd":
        cb.languages.completionsAdd(args[0] as string, args[1] as never);
        return true;
      case "languages.formatterAdd":
        cb.languages.formatterAdd(args[0] as string, extensionId);
        return true;
      case "db.getConnections":
        return cb.db.getConnections();
      case "db.getActiveConnection":
        return cb.db.getActiveConnection();
      case "db.executeQuery": {
        const sql = args[0] as string;
        if (isWriteQuery(sql) && !(cb.resolveCapabilities?.(extensionId) ?? []).includes("query:write")) {
          throw new Error(
            `extension ${extensionId} attempted a write query without the "query:write" capability`,
          );
        }
        return cb.db.executeQuery(args[0] as string, args[1] as unknown[] | undefined);
      }
      case "db.getSchema":
        return cb.db.getSchema();
      case "db.readTable":
        return cb.db.readTable(args[0] as string, args[1] as string, args[2] as number | undefined);
      case "db.getActiveQuery":
        return cb.db.getActiveQuery();
      case "db.setActiveQuery":
        return cb.db.setActiveQuery(args[0] as string);
      case "db.openVisualizer":
        return cb.db.openVisualizer(args[0] as string, args[1]);
      case "ai.registerTool":
        cb.ai.registerTool(extensionId, args[0] as never);
        return true;
      case "env.clipboardWrite":
        return cb.env.clipboardWrite(args[0] as string);
      default:
        throw new Error(`unknown api: ${namespace}.${method}`);
    }
  }

  // -- tree expansion helper used by React tree views -----------------------
  async getTreeChildren(extensionId: string, viewId: string, parentId?: string): Promise<RexaTreeItem[]> {
    const items = (await this.invokeWorkerHandler(extensionId, `tree:${viewId}`, [parentId]).catch(() => [])) as RexaTreeItem[];
    const list = Array.isArray(items) ? items : [];
    this.callbacks.tree.setChildren(viewId, parentId, list);
    return list;
  }
}

/**
 * Test/SSR helper: run extension factory code in-process against callbacks.
 * `factorySource` is the extension `main` JS; we eval it in a tiny sandbox
 * exposing `activate`/`__extensionActivate` and call it with a direct `rexa`
 * implementation built from the same callbacks.
 */
export async function runInProcess(
  extensionId: string,
  factorySource: string,
  callbacks: HostCallbacks,
  opts?: { onApi?: (api: RexaHostApi) => void },
): Promise<{ api: RexaHostApi; deactivate?: () => void }> {
  const treeHandlers = new Map<string, (parentId?: string) => Promise<RexaTreeItem[]>>();
  const commandHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

  const api: RexaHostApi = {
    commands: {
      registerCommand: async (command, title, group) => {
        callbacks.commands.register(extensionId, command, title, group);
      },
      executeCommand: async <T,>(command: string, ...args: unknown[]) => {
        if (commandHandlers.has(command)) return (await commandHandlers.get(command)!(...args)) as T;
        return callbacks.commands.execute<T>(command, ...args);
      },
      getCommands: async () => callbacks.commands.list(),
    },
    window: {
      showInformationMessage: async (m) => {
        await callbacks.window.showMessage("info", m);
      },
      showWarningMessage: async (m) => {
        await callbacks.window.showMessage("warning", m);
      },
      showErrorMessage: async (m) => {
        await callbacks.window.showMessage("error", m);
      },
      showInputBox: (prompt, initial) => callbacks.window.showInputBox(prompt, initial),
      createStatusBarItem: async (id, text, o) => {
        callbacks.window.statusBarCreate(extensionId, id, text, o);
      },
      updateStatusBarItem: async (id, patch) => {
        callbacks.window.statusBarUpdate(extensionId, id, patch);
      },
      registerTreeDataProvider: async (viewId, provider) => {
        callbacks.tree.registerProvider(extensionId, viewId);
        // Worker-style: handler was registered via __registerHandler("tree:<viewId>");
        // object-style: provider { getChildren } passed directly.
        const workerHandler = treeHandlers.get(viewId);
        const getChildren = provider?.getChildren
          ? (parentId?: string) => provider.getChildren(parentId)
          : (parentId?: string) => workerHandler?.(parentId) ?? Promise.resolve([]);
        treeHandlers.set(viewId, getChildren);
        const roots = await getChildren(undefined).catch(() => []);
        callbacks.tree.setChildren(viewId, undefined, roots);
      },
      registerWebviewView: async (viewId, html) => {
        callbacks.window.webviewViewRegister(extensionId, viewId, html);
      },
      registerSidebarPage: async (containerId, html) => {
        callbacks.window.sidebarPageRegister(extensionId, containerId, html);
      },
      openWebviewPanel: async (panelId, html) => {
        callbacks.window.webviewPanelOpen(extensionId, panelId, html);
      },
      openTab: async (viewId, opts) => {
        callbacks.tabs.open(extensionId, viewId, opts);
      },
      createRailItem: async (id, title, o) => {
        callbacks.rail.create(extensionId, { id, title, ...o });
      },
    },
    workspace: {
      getConfiguration: (s) => callbacks.workspace.get(s),
      updateConfiguration: (s, v) => callbacks.workspace.set(s, v),
    },
    languages: {
      registerCompletionItems: async (id, items) => {
        callbacks.languages.completionsAdd(id, items);
      },
      registerFormatter: async (id) => {
        callbacks.languages.formatterAdd(id, extensionId);
      },
    },
    rexaDb: {
      getConnections: () => callbacks.db.getConnections(),
      getActiveConnection: () => callbacks.db.getActiveConnection(),
      executeQuery: <T,>(sql: string, params?: unknown[]) => {
        if (isWriteQuery(sql) && !(callbacks.resolveCapabilities?.(extensionId) ?? []).includes("query:write")) {
          return Promise.reject(
            new Error(`extension ${extensionId} attempted a write query without the "query:write" capability`),
          );
        }
        return callbacks.db.executeQuery<T>(sql, params);
      },
      getSchema: () => callbacks.db.getSchema(),
      readTable: (schema: string, table: string, limit?: number) => callbacks.db.readTable(schema, table, limit),
      getActiveQuery: () => callbacks.db.getActiveQuery(),
      setActiveQuery: (sql) => callbacks.db.setActiveQuery(sql),
      openResultVisualizer: (id, data) => callbacks.db.openVisualizer(id, data),
    },
    ai: {
      registerTool: async (tool) => {
        callbacks.ai.registerTool(extensionId, tool);
      },
    },
    env: { clipboardWrite: (t) => callbacks.env.clipboardWrite(t) },
  };

  // Expose wrapped registration so extension code written for the Worker shim
  // (using __wrapRegister/__wrapTreeProvider) also works in-process.
  (api.commands as unknown as Record<string, unknown>).__wrapRegister = (
    command: string,
    handler: (...a: unknown[]) => Promise<unknown>,
    title?: string,
    group?: string,
  ) => {
    commandHandlers.set(command, handler);
    return api.commands.registerCommand(command, title, group);
  };
  // Worker-shim style: rexa.__registerHandler("command:<id>" | "tree:<viewId>", fn).
  // Stored locally so executeCommand / tree expansion resolve without a Worker.
  ((api as unknown as Record<string, unknown>).__registerHandler as unknown) = (
    name: string,
    fn: (...a: unknown[]) => Promise<unknown>,
  ) => {
    if (name.startsWith("command:")) commandHandlers.set(name.slice("command:".length), fn);
    else if (name.startsWith("tree:"))
      treeHandlers.set(
        name.slice("tree:".length),
        (parentId?: string) => fn(parentId) as Promise<RexaTreeItem[]>,
      );
  };
  ((api.window as unknown as Record<string, unknown>).__wrapTreeProvider as unknown) = (
    viewId: string,
    getChildren: (parentId?: string) => Promise<RexaTreeItem[]>,
  ) => {
    treeHandlers.set(viewId, getChildren);
    return api.window.registerTreeDataProvider(viewId, { getChildren });
  };

  opts?.onApi?.(api);

  const sandbox: Record<string, unknown> = { rexa: api };
  const runner = new Function(
    "rexa",
    `${factorySource}\n;return (typeof __extensionActivate === "function" ? __extensionActivate : (typeof activate === "function" ? activate : null));`,
  );
  const activate = runner.call(sandbox, api) as ((rexa: RexaHostApi) => Promise<void> | void) | null;
  if (!activate) throw new Error("no activate() export found");
  await activate(api);
  return { api };
}
