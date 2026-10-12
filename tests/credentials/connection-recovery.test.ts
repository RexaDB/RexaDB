import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.createSourceFile("connection-manager.tsx", readFileSync(new URL("../../components/connections/connection-manager.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function recoveryHandler(bindings: Record<string, unknown>) {
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "handleCredentialRecovery") initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(initializer).toBeDefined();
  const compiled = ts.transpileModule(`const handler = ${initializer!.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}\nreturn handler;`)(...Object.values(bindings));
}

function fixture(browser: boolean) {
  const connection = { id: 1, name: "Saved PostgreSQL", credentialRef: "existing-reference", password: null };
  let dialog = { open: true, recoveryConnection: connection };
  let mode: string | null = null;
  let copied: unknown = null;
  let edited: unknown = null;
  const formRequestRef = { current: 0 };
  const handle = recoveryHandler({
    connectionFailureDialog: dialog,
    setConnectionFailureDialog: (update: (current: typeof dialog) => typeof dialog) => { dialog = update(dialog); },
    isDesktopKeychainConnectionUnavailable: () => browser,
    setCredentialStorageMode: (value: string) => { mode = value; },
    formRequestRef,
    populateFormFromConnection: (value: unknown, duplicate: boolean) => { copied = { value, duplicate }; },
    handleEdit: (value: unknown) => { edited = value; },
  });
  return { handle, connection, formRequestRef, get dialog() { return dialog; }, get mode() { return mode; }, get copied() { return copied; }, get edited() { return edited; } };
}

test("browser recovery opens a vault-backed copy without changing the original credentials", () => {
  const recovery = fixture(true);
  recovery.handle();
  expect(recovery.dialog.open).toBe(false);
  expect(recovery.mode).toBe("vault");
  expect(recovery.copied).toEqual({ value: recovery.connection, duplicate: true });
  expect(recovery.edited).toBeNull();
  expect(recovery.connection.credentialRef).toBe("existing-reference");
  expect(recovery.formRequestRef.current).toBe(1);
});

test("desktop recovery edits credentials without changing storage mode", () => {
  const recovery = fixture(false);
  recovery.handle();
  expect(recovery.dialog.open).toBe(false);
  expect(recovery.mode).toBeNull();
  expect(recovery.copied).toBeNull();
  expect(recovery.edited).toBe(recovery.connection);
});
