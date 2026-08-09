import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDashboardWidgetsFromBlock,
  mergeDashboardWidgetsFromBlock,
  countDashboardBlockWidgets,
} from "../../lib/ai/dashboard-plan";

test("buildDashboardWidgetsFromBlock derives queries", () => {
  const input = {
    widgets: [
      { widget_type: "table", table_name: "users", config_json: { limit: 5 } },
      { widget_type: "metric", table_name: "orders", config_json: { metric: "SUM(total)" } },
    ],
  };

  const widgets = buildDashboardWidgetsFromBlock(input);
  assert.equal(widgets.length, 2);
  assert.equal(widgets[0].widgetType, "table");
  assert.equal(widgets[0].query, "SELECT * FROM users LIMIT 5;");
  assert.equal(widgets[1].query, "SELECT SUM(total) AS value FROM orders;");
});

test("mergeDashboardWidgetsFromBlock preserves existing positions unless explicit", () => {
  const existing = [
    { id: "keep", title: "Users", widgetType: "metric", x: 80, y: 120, width: 240, height: 160 },
  ];
  const input = {
    widgets: [
      { widget_type: "metric", title: "Users" },
      { widget_type: "metric", title: "Revenue", x: 400, y: 200, w: 8, h: 6 },
    ],
  };

  const merged = mergeDashboardWidgetsFromBlock(existing, input);
  const users = merged.find((w: any) => w.title === "Users");
  const revenue = merged.find((w: any) => w.title === "Revenue");

  assert.equal(users?.x, 80);
  assert.equal(users?.y, 120);
  assert.ok(revenue?.x === 400 && revenue?.y === 200);
  assert.equal(revenue?.width, 8 * 40);
  assert.equal(revenue?.height, 6 * 40);
});

test("countDashboardBlockWidgets counts widgets", () => {
  assert.equal(countDashboardBlockWidgets({ widgets: [{}, {}] }), 2);
  assert.equal(countDashboardBlockWidgets({ charts: [{}, {}] }), 2);
});
