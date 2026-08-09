import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardRef } from "../../lib/ai/dashboard-refs";

test("buildDashboardRef slugifies and appends id", () => {
  assert.equal(buildDashboardRef("Sales Dashboard", "ABC1234"), "dashboard.sales-dashboard-abc123");
  assert.equal(buildDashboardRef("", ""), "dashboard.dashboard");
});
