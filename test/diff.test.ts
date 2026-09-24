import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { parseComposeFile } from "../src/parser";
import { diffGraphs, formatDiff } from "../src/diff";

function fixture(name: string): string {
  return path.join(__dirname, "fixtures", name);
}

describe("diffGraphs", () => {
  const before = parseComposeFile(fixture("base-compose.yml"));
  // drifted-compose.yml = base-compose.yml + a new "metrics" service + db's port
  // changed from a random host port ("5432") to a fixed one ("5433:5432").
  const after = parseComposeFile(fixture("drifted-compose.yml"));
  const diff = diffGraphs(before, after);

  it("flags drift as present", () => {
    expect(diff.hasChanges).toBe(true);
  });

  it("detects the added service", () => {
    expect(diff.servicesAdded).toEqual(["metrics"]);
    expect(diff.servicesRemoved).toEqual([]);
  });

  it("detects the changed port mapping on the db service", () => {
    const dbChange = diff.servicesChanged.find((c) => c.name === "db");
    expect(dbChange).toBeDefined();
    expect(dbChange!.portsRemoved).toEqual(["*:5432/tcp"]);
    expect(dbChange!.portsAdded).toEqual(["5433:5432/tcp"]);
  });

  it("does not flag unrelated services as changed", () => {
    const names = diff.servicesChanged.map((c) => c.name);
    expect(names).not.toContain("nginx");
    expect(names).not.toContain("cache");
  });

  it("formats a non-empty human-readable report", () => {
    const text = formatDiff(diff);
    expect(text).toContain("+ service added: metrics");
    expect(text).toContain("service changed: db");
    expect(text).toContain("5433:5432");
  });

  it("reports no drift when a graph is diffed against itself", () => {
    const identical = diffGraphs(before, before);
    expect(identical.hasChanges).toBe(false);
    expect(formatDiff(identical)).toBe("No drift detected: current compose file matches the snapshot.");
  });
});
