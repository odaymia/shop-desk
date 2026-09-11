import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SERVICE_MENU, jobsInCategory, menuCategories, normalizeMenu } from "../src/lib/services.js";
import { STARTER_JOBS } from "../src/lib/starterJobs.js";

test("the menu runs oil change, brakes, tires in red, then the rest in green", () => {
  assert.deepEqual(
    DEFAULT_SERVICE_MENU.slice(0, 3).map((m) => [m.name, m.color]),
    [
      ["Oil change", "red"],
      ["Brakes", "red"],
      ["Tires", "red"],
    ]
  );
  assert.ok(DEFAULT_SERVICE_MENU.slice(3).every((m) => m.color === "green"));
  assert.equal(DEFAULT_SERVICE_MENU[0].oil, true);
});

test("every menu category has at least one starter job, and starter keys are unique", () => {
  const cats = menuCategories(DEFAULT_SERVICE_MENU);
  for (const c of cats) assert.ok(STARTER_JOBS.some((j) => j.category === c), `no starter job for ${c}`);
  const keys = STARTER_JOBS.map((j) => j.starterKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("jobsInCategory matches loosely and skips retired jobs", () => {
  const jobs = {
    a: { id: "a", name: "Front pads", category: "Brakes" },
    b: { id: "b", name: "Rear pads", category: " brakes " },
    c: { id: "c", name: "Old", category: "Brakes", active: false },
    d: { id: "d", name: "Tires", category: "Tires" },
  };
  assert.deepEqual(jobsInCategory(jobs, "Brakes").map((j) => j.id), ["a", "b"]);
  assert.deepEqual(jobsInCategory(jobs, ""), []);
});

test("menu rows normalize: blank names dropped, category defaults to the name, oil keeps no category", () => {
  const rows = normalizeMenu([
    { id: "x", name: " Belts ", color: "purple" },
    { name: "" },
    { id: "oil", name: "Oil change", oil: true, category: "whatever" },
  ]);
  assert.deepEqual(rows[0], { id: "x", name: "Belts", color: "red", oil: false, category: "Belts" });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].category, "");
});
