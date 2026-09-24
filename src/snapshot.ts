import * as fs from "node:fs";
import type { ComposeGraph } from "./types";

/** On-disk shape of a `meshmap snapshot` output file. */
export interface SnapshotFile {
  tool: "meshmap";
  schemaVersion: 1;
  createdAt: string;
  graph: ComposeGraph;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

export function toSnapshotFile(graph: ComposeGraph): SnapshotFile {
  return {
    tool: "meshmap",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    graph,
  };
}

export function saveSnapshot(graph: ComposeGraph, filePath: string): void {
  const snapshot = toSnapshotFile(graph);
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export function loadSnapshot(filePath: string): ComposeGraph {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(`Could not read snapshot ${filePath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SnapshotError(`Snapshot ${filePath} is not valid JSON: ${message}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).tool !== "meshmap" ||
    !(parsed as Record<string, unknown>).graph
  ) {
    throw new SnapshotError(`${filePath} does not look like a meshmap snapshot file.`);
  }

  const file = parsed as SnapshotFile;
  if (file.schemaVersion !== 1) {
    throw new SnapshotError(
      `${filePath} was created by an incompatible meshmap schema version (${String(file.schemaVersion)}).`
    );
  }

  return file.graph;
}
