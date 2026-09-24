import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { parseComposeFile } from "../src/parser";
import { checkLive, formatLiveReport, inferProjectName, sanitizeProjectName } from "../src/live";
import type { DockerRunner } from "../src/live";

function fixture(name: string): string {
  return path.join(__dirname, "fixtures", name);
}

// Fake DockerRunner so this test suite never shells out to a real Docker
// daemon (Meshmap's automated tests must be deterministic and CI-safe even
// though --live was also manually smoke-tested against a real running
// docker-compose stack; see README "Limitations").
function fakeRunner(overrides: Partial<DockerRunner> = {}): DockerRunner {
  return {
    isAvailable: () => true,
    listNetworkNames: () => ["myapp_backend", "bridge", "host", "none"],
    listContainers: () => [
      { name: "myapp-web-1", state: "running" },
      { name: "myapp-db-1", state: "running" },
    ],
    ...overrides,
  };
}

describe("checkLive", () => {
  const graph = parseComposeFile(fixture("basic-compose.yml")); // services: web, db; network: backend

  it("matches running containers using the <project>-<service>-<n> naming convention", () => {
    const report = checkLive(graph, "myapp", fakeRunner());
    expect(report.available).toBe(true);
    const web = report.services.find((s) => s.name === "web")!;
    const db = report.services.find((s) => s.name === "db")!;
    expect(web.found).toBe(true);
    expect(web.containerName).toBe("myapp-web-1");
    expect(db.found).toBe(true);
  });

  it("matches the compose-created network using the <project>_<network> convention", () => {
    const report = checkLive(graph, "myapp", fakeRunner());
    const backend = report.networks.find((n) => n.name === "backend")!;
    expect(backend.expectedDockerName).toBe("myapp_backend");
    expect(backend.found).toBe(true);
  });

  it("flags a service as not-found when no matching container is running", () => {
    const report = checkLive(
      graph,
      "otherproject",
      fakeRunner({ listContainers: () => [{ name: "otherproject-web-1", state: "running" }] })
    );
    const db = report.services.find((s) => s.name === "db")!;
    expect(db.found).toBe(false);
    const web = report.services.find((s) => s.name === "web")!;
    expect(web.found).toBe(true);
  });

  it("reports unavailable when Docker isn't reachable", () => {
    const report = checkLive(graph, "myapp", fakeRunner({ isAvailable: () => false }));
    expect(report.available).toBe(false);
    expect(report.error).toBeTruthy();
    expect(formatLiveReport(report)).toContain("Live check skipped");
  });

  it("formats an available report with per-node OK/NOT FOUND lines", () => {
    const report = checkLive(graph, "myapp", fakeRunner());
    const text = formatLiveReport(report);
    expect(text).toContain("network backend: OK");
    expect(text).toContain("service web: running as myapp-web-1");
  });
});

describe("project name helpers", () => {
  it("sanitizes to lowercase [a-z0-9_-] only", () => {
    expect(sanitizeProjectName("My Cool App!")).toBe("mycoolapp");
  });

  it("infers a project name from the compose file's directory", () => {
    const inferred = inferProjectName(fixture("basic-compose.yml"));
    expect(inferred).toBe(sanitizeProjectName(path.basename(path.dirname(fixture("basic-compose.yml")))));
  });
});
