import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_PROJECT_STATUSES,
  parseProjectRef,
  registerActiveSupabaseProjects,
  type RegisterActiveProjectsDeps,
} from "../../../lib/supabase-mgmt/register";
import type { Project } from "supabase-client-sdk";

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: overrides.ref ?? "id",
    ref: "ref-abc",
    name: "Test Project",
    status: "ACTIVE",
    organization_id: "org-1",
    region: "us-east-1",
    created_at: "2024-01-01T00:00:00.000Z",
    inserted_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDeps(
  projects: Project[],
): { deps: RegisterActiveProjectsDeps; created: any[] } {
  const created: any[] = [];
  return {
    deps: {
      listProjects: async () => projects,
      createConnection: async (payload) => {
        created.push(payload);
        return { success: true };
      },
    },
    created,
  };
}

test("parseProjectRef extracts ref from mgmt connection string", () => {
  assert.equal(
    parseProjectRef("supabase-mgmt://abcd1234?token=xyz"),
    "abcd1234",
  );
  assert.equal(parseProjectRef("supabase-mgmt://abcd1234"), "abcd1234");
  assert.equal(
    parseProjectRef("postgresql://user:pass@host:5432/db"),
    null,
  );
  assert.equal(parseProjectRef(""), null);
});

test("ACTIVE_PROJECT_STATUSES matches contract", () => {
  assert.deepEqual([...ACTIVE_PROJECT_STATUSES], [
    "ACTIVE",
    "ACTIVE_HEALTHY",
    "COMING_UP",
  ]);
});

test("registerActiveSupabaseProjects imports all active projects", async () => {
  const { deps, created } = makeDeps([
    makeProject({ ref: "aaa", name: "Alpha" }),
    makeProject({ ref: "bbb", name: "Beta", status: "ACTIVE_HEALTHY" }),
  ]);
  const result = await registerActiveSupabaseProjects(
    "token",
    [],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 2,
    alreadyRegistered: 0,
    skippedLimit: 0,
    failed: 0,
  });
  assert.equal(created.length, 2);
  assert.equal(created[0].name, "Alpha");
  assert.equal(created[0].connectionType, "supabase-mgmt");
  assert.equal(
    created[0].connectionString,
    "supabase-mgmt://aaa?token=token",
  );
});

test("registerActiveSupabaseProjects filters out non-active statuses", async () => {
  const { deps, created } = makeDeps([
    makeProject({ ref: "aaa", status: "ACTIVE" }),
    makeProject({ ref: "bbb", status: "PAUSED" }),
    makeProject({ ref: "ccc", status: "COMING_UP" }),
    makeProject({ ref: "ddd", status: "INACTIVE" }),
  ]);
  const result = await registerActiveSupabaseProjects(
    "token",
    [],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 2,
    alreadyRegistered: 0,
    skippedLimit: 0,
    failed: 0,
  });
  assert.deepEqual(
    created.map((c) => c.connectionString),
    ["supabase-mgmt://aaa?token=token", "supabase-mgmt://ccc?token=token"],
  );
});

test("registerActiveSupabaseProjects dedupes by ref", async () => {
  const { deps, created } = makeDeps([
    makeProject({ ref: "aaa" }),
    makeProject({ ref: "bbb" }),
  ]);
  const result = await registerActiveSupabaseProjects(
    "token",
    ["supabase-mgmt://aaa?token=old"],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 1,
    alreadyRegistered: 1,
    skippedLimit: 0,
    failed: 0,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].connectionString, "supabase-mgmt://bbb?token=token");
});

test("registerActiveSupabaseProjects caps at maxConnections", async () => {
  const { deps, created } = makeDeps([
    makeProject({ ref: "aaa" }),
    makeProject({ ref: "bbb" }),
    makeProject({ ref: "ccc" }),
    makeProject({ ref: "ddd" }),
  ]);
  const result = await registerActiveSupabaseProjects(
    "token",
    [],
    2,
    deps,
  );
  assert.deepEqual(result, {
    imported: 2,
    alreadyRegistered: 0,
    skippedLimit: 2,
    failed: 0,
  });
  assert.equal(created.length, 2);
});

test("registerActiveSupabaseProjects counts per-project failures", async () => {
  let calls = 0;
  const deps: RegisterActiveProjectsDeps = {
    listProjects: async () => [
      makeProject({ ref: "aaa" }),
      makeProject({ ref: "bbb" }),
      makeProject({ ref: "ccc" }),
    ],
    createConnection: async (payload) => {
      calls += 1;
      if (payload.name === "Test Project" && calls % 2 === 1) {
        throw new Error("boom");
      }
      return { success: false };
    },
  };
  const result = await registerActiveSupabaseProjects(
    "token",
    [],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 0,
    alreadyRegistered: 0,
    skippedLimit: 0,
    failed: 3,
  });
});

test("registerActiveSupabaseProjects never throws on list error", async () => {
  const deps: RegisterActiveProjectsDeps = {
    listProjects: async () => {
      throw new Error("network down");
    },
    createConnection: async () => ({ success: true }),
  };
  const result = await registerActiveSupabaseProjects(
    "token",
    [],
    null,
    deps,
  );
  assert.deepEqual(result, {
    imported: 0,
    alreadyRegistered: 0,
    skippedLimit: 0,
    failed: 1,
  });
});

test("registerActiveSupabaseProjects handles empty inputs", async () => {
  const { deps, created } = makeDeps([]);
  const result = await registerActiveSupabaseProjects("token", [], null, deps);
  assert.deepEqual(result, {
    imported: 0,
    alreadyRegistered: 0,
    skippedLimit: 0,
    failed: 0,
  });
  assert.equal(created.length, 0);
});
