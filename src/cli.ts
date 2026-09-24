#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { parseComposeFile, ComposeParseError } from "./parser";
import { renderHtml } from "./render";
import { saveSnapshot, loadSnapshot, SnapshotError } from "./snapshot";
import { diffGraphs, formatDiff } from "./diff";
import { checkLive, formatLiveReport, inferProjectName, sanitizeProjectName } from "./live";
import type { ComposeGraph } from "./types";
import type { LiveReport } from "./live";

const program = new Command();

program
  .name("meshmap")
  .description("Read-only network topology diagrams and drift detection for docker-compose files.")
  .version("0.1.0");

function fail(message: string): never {
  console.error(`meshmap: ${message}`);
  process.exit(1);
}

function parseOrExit(composePath: string): ComposeGraph {
  try {
    return parseComposeFile(composePath);
  } catch (err) {
    if (err instanceof ComposeParseError) fail(err.message);
    throw err;
  }
}

function maybeLiveCheck(
  composePath: string,
  graph: ComposeGraph,
  live: boolean,
  projectOpt: string | undefined
): LiveReport | undefined {
  if (!live) return undefined;
  const project = projectOpt ? sanitizeProjectName(projectOpt) : inferProjectName(composePath);
  const report = checkLive(graph, project);
  console.log(formatLiveReport(report));
  return report;
}

program
  .command("render")
  .description("Render a docker-compose file's topology as a standalone HTML+SVG diagram.")
  .argument("<composeFile>", "path to docker-compose.yml")
  .option("-o, --output <file>", "output HTML file path", "topology.html")
  .option("--live", "cross-check the diagram against real Docker state (requires docker CLI/daemon)", false)
  .option("--project <name>", "Compose project name to use for --live matching (defaults to the compose file's directory name)")
  .action((composeFile: string, opts: { output: string; live: boolean; project?: string }) => {
    const graph = parseOrExit(composeFile);
    const live = maybeLiveCheck(composeFile, graph, opts.live, opts.project);
    const html = renderHtml(graph, { live });
    fs.writeFileSync(path.resolve(opts.output), html, "utf8");
    console.log(
      `meshmap: wrote ${graph.services.length} service(s) across ${graph.networks.length} network(s) to ${opts.output}`
    );
  });

program
  .command("snapshot")
  .description("Save the current parsed topology as a JSON snapshot for later drift detection.")
  .argument("<composeFile>", "path to docker-compose.yml")
  .option("-o, --output <file>", "output snapshot JSON file path", "snapshot.json")
  .action((composeFile: string, opts: { output: string }) => {
    const graph = parseOrExit(composeFile);
    saveSnapshot(graph, path.resolve(opts.output));
    console.log(`meshmap: saved snapshot of ${graph.services.length} service(s) to ${opts.output}`);
  });

program
  .command("diff")
  .description("Diff the current docker-compose file against a previously saved snapshot.")
  .argument("<composeFile>", "path to docker-compose.yml")
  .requiredOption("--against <snapshotFile>", "snapshot JSON file to diff against (from `meshmap snapshot`)")
  .option("--json", "output the diff as JSON instead of human-readable text", false)
  .action((composeFile: string, opts: { against: string; json: boolean }) => {
    let before: ComposeGraph;
    try {
      before = loadSnapshot(path.resolve(opts.against));
    } catch (err) {
      if (err instanceof SnapshotError) fail(err.message);
      throw err;
    }
    const after = parseOrExit(composeFile);
    const diff = diffGraphs(before, after);

    if (opts.json) {
      console.log(JSON.stringify(diff, null, 2));
    } else {
      console.log(formatDiff(diff));
    }

    process.exitCode = diff.hasChanges ? 1 : 0;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
