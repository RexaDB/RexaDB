import { describe, expect, test } from "bun:test";
import {
  confirmSettingsBaseline,
  mergePreservingEdits,
} from "@/lib/studio/settings-baseline";

const DEFAULTS = { a: 1, openConnectionsInNewWindow: false, theme: "auto" };

describe("mergePreservingEdits", () => {
  test("untouched fields follow the server", () => {
    const merged = mergePreservingEdits(
      { ...DEFAULTS },
      { ...DEFAULTS },
      { a: 2, openConnectionsInNewWindow: false, theme: "auto" },
    );
    expect(merged.a).toBe(2);
  });

  test("local edits survive incoming loads", () => {
    const merged = mergePreservingEdits(
      { ...DEFAULTS, theme: "dark" },
      { ...DEFAULTS },
      { ...DEFAULTS },
    );
    expect(merged.theme).toBe("dark");
  });
});

describe("sparse loads + cloud updates (stale-settings regression)", () => {
  test("untouched defaults are not dirty after a sparse load, later cloud update applies", () => {
    let confirmed: Record<string, unknown> = { ...DEFAULTS };
    // Sparse load {} — nothing dirty, state stays defaults.
    let merged: Record<string, unknown> = mergePreservingEdits(
      { ...DEFAULTS },
      confirmed,
      {},
    );
    expect(merged).toEqual({});
    confirmed = confirmSettingsBaseline(confirmed, {});
    expect(confirmed).toEqual(DEFAULTS);
    // Later cloud update flips a defaulted field — must apply, not be
    // preserved-over as a phantom local edit.
    const update = { ...DEFAULTS, openConnectionsInNewWindow: true };
    merged = mergePreservingEdits(
      { ...DEFAULTS },
      confirmed,
      update,
    );
    expect(merged.openConnectionsInNewWindow).toBe(true);
    confirmed = confirmSettingsBaseline(confirmed, update);
    expect(confirmed.openConnectionsInNewWindow).toBe(true);
  });
});

describe("failed-save recovery (discarded-edit regression)", () => {
  test("unsaved edit survives two failed retries without confirming", () => {
    const server: Record<string, unknown> = { ...DEFAULTS };
    const confirmed: Record<string, unknown> = { ...server };
    const edited = { ...DEFAULTS, theme: "dark" };
    // First failure wake: recovery fetch returns stale server state.
    // Applied WITHOUT confirming (confirmServerState: false).
    let merged = mergePreservingEdits(edited, confirmed, server);
    expect(merged.theme).toBe("dark");
    // confirmed unchanged -> edit still dirty.
    expect(confirmed).toEqual(server);
    // Retry fails too: second recovery fetch must STILL preserve the edit
    // (previously appliedRef had been poisoned and it was discarded here).
    merged = mergePreservingEdits(edited, confirmed, server);
    expect(merged.theme).toBe("dark");
  });

  test("successful save confirms and clears dirtiness", () => {
    const server: Record<string, unknown> = { ...DEFAULTS };
    const edited: Record<string, unknown> = { ...DEFAULTS, theme: "dark" };
    // Save succeeds with the edit; broadcast echo confirms the payload.
    const merged = mergePreservingEdits(edited, server, edited);
    expect(merged.theme).toBe("dark");
    const confirmed = confirmSettingsBaseline(server, edited);
    // Afterwards the same state is clean — no phantom retry.
    const again = mergePreservingEdits(edited, confirmed, edited);
    expect(again).toEqual(edited);
  });
});
