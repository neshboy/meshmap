import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { ComposeParseError, DEFAULT_NETWORK_NAME, parseComposeFile } from "../src/parser";

function fixture(name: string): string {
  return path.join(__dirname, "fixtures", name);
}

describe("parseComposeFile: basic-compose.yml", () => {
  const graph = parseComposeFile(fixture("basic-compose.yml"));

  it("parses both services", () => {
    expect(graph.services.map((s) => s.name)).toEqual(["db", "web"]);
  });

  it("captures images", () => {
    const web = graph.services.find((s) => s.name === "web")!;
    const db = graph.services.find((s) => s.name === "db")!;
    expect(web.image).toBe("nginx:1.27-alpine");
    expect(db.image).toBe("postgres:16");
    expect(web.build).toBeNull();
  });

  it("parses short-syntax port mappings including protocol suffix", () => {
    const web = graph.services.find((s) => s.name === "web")!;
    expect(web.ports).toEqual([
      { host: "8080", container: "80", protocol: "tcp", raw: "8080:80" },
      { host: "8443", container: "443", protocol: "udp", raw: "8443:443/udp" },
    ]);
  });

  it("parses a bare container-port-only mapping as having no fixed host port", () => {
    const db = graph.services.find((s) => s.name === "db")!;
    expect(db.ports).toEqual([{ host: null, container: "5432", protocol: "tcp", raw: "5432" }]);
  });

  it("parses depends_on as a real edge", () => {
    const web = graph.services.find((s) => s.name === "web")!;
    expect(web.dependsOn).toEqual(["db"]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([{ kind: "depends_on", from: "web", to: "db" }])
    );
  });

  it("parses the top-level networks block", () => {
    expect(graph.networks).toEqual([{ name: "backend", external: false, driver: "bridge" }]);
  });

  it("creates network-membership edges for every service on that network", () => {
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { kind: "network", from: "web", to: "backend", network: "backend" },
        { kind: "network", from: "db", to: "backend", network: "backend" },
      ])
    );
  });
});

describe("parseComposeFile: edge-cases-compose.yml", () => {
  const graph = parseComposeFile(fixture("edge-cases-compose.yml"));

  it("parses long-syntax ports (target/published/protocol)", () => {
    const api = graph.services.find((s) => s.name === "api")!;
    expect(api.ports).toEqual([
      { host: "9090", container: "8080", protocol: "tcp", raw: "9090:8080" },
      { host: "9443", container: "8443", protocol: "udp", raw: "9443:8443/udp" },
    ]);
  });

  it("parses map-style depends_on (with a condition) by key", () => {
    const api = graph.services.find((s) => s.name === "api")!;
    expect(api.dependsOn).toEqual(["queue"]);
  });

  it("parses map-style environment by key only, never capturing values", () => {
    const api = graph.services.find((s) => s.name === "api")!;
    expect(api.environmentKeys.sort()).toEqual(["API_KEY", "LOG_LEVEL"]);
    const serialized = JSON.stringify(api);
    expect(serialized).not.toContain("secret-value");
  });

  it("falls back to the implicit default network when a service declares none", () => {
    const sidecar = graph.services.find((s) => s.name === "sidecar")!;
    expect(sidecar.networks).toEqual([DEFAULT_NETWORK_NAME]);
  });

  it("marks externally-managed networks as external", () => {
    const sharedEdge = graph.networks.find((n) => n.name === "shared_edge")!;
    expect(sharedEdge.external).toBe(true);
  });

  it("supports map-style `networks:` on a service (network: {})", () => {
    const queue = graph.services.find((s) => s.name === "queue")!;
    expect(queue.networks).toEqual(["app_net"]);
  });
});

describe("parseComposeFile: error handling", () => {
  it("throws a ComposeParseError when depends_on references an undefined service", () => {
    expect(() => parseComposeFile(fixture("invalid-dependson.yml"))).toThrow(ComposeParseError);
  });

  it("throws a ComposeParseError for a missing file", () => {
    expect(() => parseComposeFile(fixture("does-not-exist.yml"))).toThrow(ComposeParseError);
  });
});
