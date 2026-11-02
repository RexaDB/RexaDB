import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { SchemaData } from "@/lib/studio/sql-input-types";

const schemaData: SchemaData = {
  "public.users": {
    schema: "public",
    name: "users",
    columns: [{ name: "id", type: "int" }],
  },
};

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let SqlQueryInput: typeof import("@/components/studio/sql-query-input").SqlQueryInput;
let cleanups: Array<() => void> = [];

before(async () => {
  GlobalRegistrator.register();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  react = await import("react");
  ({ createRoot } = await import("react-dom/client"));
  ({ SqlQueryInput } = await import("@/components/studio/sql-query-input"));
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
});

after(async () => {
  await GlobalRegistrator.unregister();
});

async function renderInput(initialQuery: string) {
  const calls = { run: 0, runSelected: 0, globalKeydowns: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  // Stands in for the window-level keybindings in use-studio.ts.
  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") calls.globalKeydowns += 1;
  };
  window.addEventListener("keydown", onWindowKeyDown);

  function Harness() {
    const [query, setQuery] = react.useState(initialQuery);
    return react.createElement(SqlQueryInput, {
      query,
      fontSize: 13,
      schemaData,
      onChange: setQuery,
      onRun: () => {
        calls.run += 1;
      },
      onRunSelected: () => {
        calls.runSelected += 1;
      },
      onSaveSnippet: () => {},
      onSelectionChange: () => {},
    });
  }

  await react.act(async () => root.render(react.createElement(Harness)));
  cleanups.push(() => {
    window.removeEventListener("keydown", onWindowKeyDown);
    react.act(() => root.unmount());
    container.remove();
  });

  const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
  textarea.focus();

  const press = (type: "keydown" | "keyup", init: KeyboardEventInit) =>
    react.act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
      );
    });
  const openSuggestions = () =>
    react.act(async () => {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  const type = (value: string) =>
    react.act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(textarea),
        "value",
      )!.set!;
      setValue.call(textarea, value);
      textarea.setSelectionRange(value.length, value.length);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  const suggestionCount = () => container.querySelectorAll("button").length;

  return { calls, textarea, press, openSuggestions, type, suggestionCount };
}

for (const [name, modifier] of [
  ["Cmd", { metaKey: true }],
  ["Ctrl", { ctrlKey: true }],
] as const) {
  test(`${name}+Enter with a selection runs only the selection, once`, async () => {
    const { calls, textarea, press } = await renderInput("SELECT 1; SELECT 2;");
    textarea.setSelectionRange(0, 8);

    await press("keydown", { key: "Enter", ...modifier });

    assert.deepEqual(calls, { run: 0, runSelected: 1, globalKeydowns: 0 });
  });

  test(`${name}+Enter without a selection runs the query once`, async () => {
    const { calls, textarea, press } = await renderInput("SELECT 1;");
    textarea.setSelectionRange(0, 0);

    await press("keydown", { key: "Enter", ...modifier });

    assert.deepEqual(calls, { run: 1, runSelected: 0, globalKeydowns: 0 });
  });

  test(`${name}+Shift+Enter never reaches the window commit keybinding`, async () => {
    const { calls, textarea, press } = await renderInput("SELECT 1;");
    textarea.setSelectionRange(0, 8);

    await press("keydown", { key: "Enter", shiftKey: true, ...modifier });

    assert.deepEqual(calls, { run: 0, runSelected: 1, globalKeydowns: 0 });
  });
}

test("Escape keeps suggestions closed through keyup until the user types", async () => {
  const { press, openSuggestions, type, suggestionCount } =
    await renderInput("SELECT * FROM us");

  await openSuggestions();
  assert.ok(suggestionCount() > 0, "suggestions should open");

  await press("keydown", { key: "Escape" });
  assert.equal(suggestionCount(), 0);

  await press("keyup", { key: "Escape" });
  assert.equal(suggestionCount(), 0, "keyup must not reopen suggestions");

  await type("SELECT * FROM use");
  assert.ok(suggestionCount() > 0, "typing should bring suggestions back");
});

test("clicking after Escape brings suggestions back", async () => {
  const { press, openSuggestions, suggestionCount } =
    await renderInput("SELECT * FROM us");

  await openSuggestions();
  await press("keydown", { key: "Escape" });
  await press("keyup", { key: "Escape" });

  await openSuggestions();
  assert.ok(suggestionCount() > 0);
});
