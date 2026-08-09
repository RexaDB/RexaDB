import test from "node:test";
import assert from "node:assert/strict";
import { buildLightDashboardContext } from "../../lib/ai/dashboard-context";

test("buildLightDashboardContext normalizes dashboards", () => {
  const dashboards = [
    {
      id: 10,
      name: "Main",
      widgets: [
        { id: 1, title: "Users", widgetType: "metric", query: "select 1", x: 0, y: 40, width: 200, height: 120 },
      ],
    },
  ];

  const result = buildLightDashboardContext(dashboards);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "10");
  assert.equal(result[0].name, "Main");
  assert.equal(result[0].widgets[0].title, "Users");
  assert.equal(result[0].widgets[0].query, "select 1");
});
