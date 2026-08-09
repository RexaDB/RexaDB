import test from "node:test";
import assert from "node:assert/strict";
import { snapToDashboardGrid, snapDashboardPosition, snapDashboardSize } from "../../lib/studio/dashboard-utils";

// DASHBOARD_GRID_SIZE is 40 and min size 160 in types/studio-types.

test("dashboard grid snapping", () => {
  assert.equal(snapToDashboardGrid(41), 40);
  assert.equal(snapDashboardPosition(-5), 0);
  assert.equal(snapDashboardSize(10), 160);
});
