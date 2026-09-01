import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeStudioSettingsPreservingSecrets,
  normalizeSettingsSyncPayload,
  stripSecretsFromStudioSettings,
} from "../../../lib/supabase/settings-sync";

test("stripSecretsFromStudioSettings removes agentApiKey", () => {
  const stripped = stripSecretsFromStudioSettings({
    vimMode: true,
    agentApiKey: "sk-secret",
    agentModel: "gpt-4",
  });

  assert.equal(stripped.vimMode, true);
  assert.equal(stripped.agentModel, "gpt-4");
  assert.equal("agentApiKey" in stripped, false);
});

test("mergeStudioSettingsPreservingSecrets keeps local API key", () => {
  const merged = mergeStudioSettingsPreservingSecrets(
    { vimMode: false, agentApiKey: "should-not-win" },
    { vimMode: true, agentApiKey: "local-secret" },
  );

  assert.equal(merged.vimMode, false);
  assert.equal(merged.agentApiKey, "local-secret");
});

test("normalizeSettingsSyncPayload accepts versioned blobs", () => {
  const payload = normalizeSettingsSyncPayload({
    version: 1,
    studioSettings: { sleekLayout: true, agentApiKey: "nope" },
    appTheme: { appThemeId: "zinc-dark-white", customAppThemes: "[]" },
    keybindings: { "mod+s": { action: "save" } },
  });

  assert.ok(payload);
  assert.equal(payload?.version, 1);
  assert.equal(payload?.studioSettings?.sleekLayout, true);
  assert.equal("agentApiKey" in (payload?.studioSettings || {}), false);
  assert.equal(payload?.appTheme?.appThemeId, "zinc-dark-white");
  assert.ok(payload?.keybindings);
});
