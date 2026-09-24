import { describe, expect, it, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseComposeFile } from "../src/parser";
import { loadSnapshot, saveSnapshot, SnapshotError } from "../src/snapshot";

function fixture(name: string): string {
  return path.join(__dirname, "fixtures", name);
}

describe("snapshot save/load roundtrip", () => {
  const tmpFile = path.join(os.tmpdir(), `meshmap-test-snapshot-${process.pid}.json`);

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it("saves and reloads an identical graph", () => {
    const graph = parseComposeFile(fixture("basic-compose.yml"));
    saveSnapshot(graph, tmpFile);
    expect(fs.existsSync(tmpFile)).toBe(true);

    const reloaded = loadSnapshot(tmpFile);
    expect(reloaded).toEqual(graph);
  });

  it("writes a tool/schemaVersion envelope", () => {
    const graph = parseComposeFile(fixture("basic-compose.yml"));
    saveSnapshot(graph, tmpFile);
    const raw = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    expect(raw.tool).toBe("meshmap");
    expect(raw.schemaVersion).toBe(1);
    expect(typeof raw.createdAt).toBe("string");
  });

  it("rejects a file that isn't a meshmap snapshot", () => {
    fs.writeFileSync(tmpFile, JSON.stringify({ some: "other json" }), "utf8");
    expect(() => loadSnapshot(tmpFile)).toThrow(SnapshotError);
  });

  it("rejects a missing snapshot file", () => {
    expect(() => loadSnapshot(path.join(os.tmpdir(), "meshmap-does-not-exist.json"))).toThrow(SnapshotError);
  });
});
