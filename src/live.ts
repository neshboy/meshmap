import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type { ComposeGraph } from "./types";

/**
 * `--live` cross-checks a parsed compose file against what Docker actually
 * reports is running, using the naming conventions Docker Compose v2 uses by
 * default:
 *   - containers are named "<project>-<service>-<index>"
 *   - the implicit/custom networks it creates are named "<project>_<network>"
 *   - external networks are expected to exist under their literal name
 *
 * This is inherently best-effort: it does not know about `container_name:`
 * overrides, scaled replicas beyond spotting *any* matching index, or
 * Compose v1's legacy "_" container separator. See README "Limitations".
 */

export interface DockerRunner {
  isAvailable(): boolean;
  listNetworkNames(): string[];
  listContainers(): Array<{ name: string; state: string }>;
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8", windowsHide: true });
}

/** Real DockerRunner backed by shelling out to the `docker` CLI on PATH. */
export const realDockerRunner: DockerRunner = {
  isAvailable(): boolean {
    try {
      run("docker", ["info", "--format", "{{.ServerVersion}}"]);
      return true;
    } catch {
      return false;
    }
  },
  listNetworkNames(): string[] {
    return run("docker", ["network", "ls", "--format", "{{.Name}}"])
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  },
  listContainers(): Array<{ name: string; state: string }> {
    return run("docker", ["ps", "-a", "--format", "{{.Names}}|{{.State}}"])
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, state] = line.split("|");
        return { name: name ?? "", state: state ?? "" };
      });
  },
};

/** Compose project names are lowercased and restricted to [a-z0-9_-]. */
export function sanitizeProjectName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "");
}

/** Default Compose project name: the sanitized basename of the compose file's directory. */
export function inferProjectName(composeFilePath: string): string {
  const dir = path.dirname(path.resolve(composeFilePath));
  return sanitizeProjectName(path.basename(dir));
}

export interface LiveNetworkStatus {
  name: string;
  expectedDockerName: string;
  found: boolean;
}

export interface LiveServiceStatus {
  name: string;
  expectedContainerPrefix: string;
  found: boolean;
  containerName?: string;
  state?: string;
}

export interface LiveReport {
  available: boolean;
  error?: string;
  project: string;
  networks: LiveNetworkStatus[];
  services: LiveServiceStatus[];
}

export function checkLive(
  graph: ComposeGraph,
  project: string,
  runner: DockerRunner = realDockerRunner
): LiveReport {
  if (!runner.isAvailable()) {
    return {
      available: false,
      error: "Docker CLI/daemon not available on this machine.",
      project,
      networks: [],
      services: [],
    };
  }

  try {
    const dockerNetworks = runner.listNetworkNames();
    const containers = runner.listContainers();

    const networks: LiveNetworkStatus[] = graph.networks.map((net) => {
      const expectedDockerName = net.external ? net.name : `${project}_${net.name}`;
      return { name: net.name, expectedDockerName, found: dockerNetworks.includes(expectedDockerName) };
    });

    const services: LiveServiceStatus[] = graph.services.map((svc) => {
      const expectedContainerPrefix = `${project}-${svc.name}-`;
      const match = containers.find((c) => c.name.startsWith(expectedContainerPrefix));
      return {
        name: svc.name,
        expectedContainerPrefix,
        found: Boolean(match),
        containerName: match?.name,
        state: match?.state,
      };
    });

    return { available: true, project, networks, services };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, error: `Docker query failed: ${message}`, project, networks: [], services: [] };
  }
}

/** Render a LiveReport as human-readable lines for the CLI. */
export function formatLiveReport(report: LiveReport): string {
  if (!report.available) {
    return `Live check skipped: ${report.error ?? "Docker unavailable."}`;
  }
  const lines = [`Live check against Docker (project "${report.project}"):`];
  for (const n of report.networks) {
    lines.push(`  network ${n.name}: ${n.found ? `OK (${n.expectedDockerName})` : `NOT FOUND (expected ${n.expectedDockerName})`}`);
  }
  for (const s of report.services) {
    lines.push(
      s.found
        ? `  service ${s.name}: running as ${s.containerName} (${s.state})`
        : `  service ${s.name}: NOT RUNNING (expected container prefix ${s.expectedContainerPrefix})`
    );
  }
  return lines.join("\n");
}
