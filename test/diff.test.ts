import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { parseComposeFile } from "../src/parser";
import { diffGraphs, formatDiff } from "../src/diff";
import type { ComposeGraph } from "../src/types";

function fixture(name: string): string {
  return path.join(__dirname, "fixtures", name);
}

/** Minimal ComposeGraph builder for synthetic before/after pairs, defaulting fields callers don't care about. */
function graph(overrides: Partial<ComposeGraph>): ComposeGraph {
  return {
    version: 1,
    services: [],
    networks: [],
    edges: [],
    sources: ["synthetic"],
    ...overrides,
  };
}

function service(overrides: Partial<ComposeGraph["services"][number]>) {
  return {
    name: "svc",
    image: null,
    build: null,
    networks: [],
    dependsOn: [],
    ports: [],
    environmentKeys: [],
    ...overrides,
  };
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

describe("diffGraphs: environment variable drift", () => {
  it("flags a service as changed when environment keys are added, removed, or renamed", () => {
    const before = graph({
      services: [service({ name: "web", environmentKeys: ["DATABASE_URL"] })],
    });
    const after = graph({
      services: [service({ name: "web", environmentKeys: ["DATABASE_URL", "SECRET_TOKEN"] })],
    });

    const diff = diffGraphs(before, after);
    expect(diff.hasChanges).toBe(true);

    const webChange = diff.servicesChanged.find((c) => c.name === "web");
    expect(webChange).toBeDefined();
    expect(webChange!.environmentKeysAdded).toEqual(["SECRET_TOKEN"]);
    expect(webChange!.environmentKeysRemoved).toEqual([]);
    expect(formatDiff(diff)).toContain("+ environment SECRET_TOKEN");
  });

  it("reports a removed environment key", () => {
    const before = graph({
      services: [service({ name: "web", environmentKeys: ["DATABASE_URL", "OLD_FLAG"] })],
    });
    const after = graph({
      services: [service({ name: "web", environmentKeys: ["DATABASE_URL"] })],
    });

    const diff = diffGraphs(before, after);
    const webChange = diff.servicesChanged.find((c) => c.name === "web");
    expect(webChange!.environmentKeysRemoved).toEqual(["OLD_FLAG"]);
    expect(formatDiff(diff)).toContain("- environment OLD_FLAG");
  });
});

describe("diffGraphs: network config drift", () => {
  it("flags a network that keeps its name but changes driver/external", () => {
    const before = graph({
      networks: [{ name: "backend", external: false, driver: "bridge" }],
    });
    const after = graph({
      networks: [{ name: "backend", external: true, driver: null }],
    });

    const diff = diffGraphs(before, after);
    expect(diff.hasChanges).toBe(true);
    expect(diff.networksAdded).toEqual([]);
    expect(diff.networksRemoved).toEqual([]);

    const netChange = diff.networksChanged.find((c) => c.name === "backend");
    expect(netChange).toBeDefined();
    expect(netChange!.external).toEqual({ before: false, after: true });
    expect(netChange!.driver).toEqual({ before: "bridge", after: null });

    const text = formatDiff(diff);
    expect(text).toContain("~ network changed: backend");
    expect(text).toContain("external: false -> true");
  });

  it("does not flag a network with unchanged driver/external", () => {
    const before = graph({
      networks: [{ name: "backend", external: false, driver: "bridge" }],
    });
    const after = graph({
      networks: [{ name: "backend", external: false, driver: "bridge" }],
    });

    const diff = diffGraphs(before, after);
    expect(diff.hasChanges).toBe(false);
    expect(diff.networksChanged).toEqual([]);
  });
});
