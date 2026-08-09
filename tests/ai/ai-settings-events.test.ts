import test from "node:test";
import assert from "node:assert/strict";
import {
  GLOBAL_AI_SETTINGS_UPDATED_EVENT,
  emitGlobalAiSettingsUpdated,
  subscribeGlobalAiSettingsUpdated,
} from "../../lib/ai/ai-settings-events";

test("ai settings events emit and subscribe", () => {
  const originalWindow = (globalThis as any).window;
  const originalCustomEvent = (globalThis as any).CustomEvent;

  class SimpleCustomEvent<T> extends Event {
    detail?: T;
    constructor(type: string, init?: { detail?: T }) {
      super(type);
      this.detail = init?.detail;
    }
  }

  const windowTarget = new EventTarget();
  (globalThis as any).window = windowTarget;
  if (!originalCustomEvent) {
    (globalThis as any).CustomEvent = SimpleCustomEvent;
  }

  let received = false;
  const unsubscribe = subscribeGlobalAiSettingsUpdated(() => {
    received = true;
  });

  emitGlobalAiSettingsUpdated();
  assert.equal(received, true);

  unsubscribe();
  received = false;
  emitGlobalAiSettingsUpdated();
  assert.equal(received, false);

  if (originalWindow === undefined) {
    delete (globalThis as any).window;
  } else {
    (globalThis as any).window = originalWindow;
  }
  if (!originalCustomEvent) {
    delete (globalThis as any).CustomEvent;
  } else {
    (globalThis as any).CustomEvent = originalCustomEvent;
  }

  assert.equal(GLOBAL_AI_SETTINGS_UPDATED_EVENT, "studio:ai-settings-updated");
});
