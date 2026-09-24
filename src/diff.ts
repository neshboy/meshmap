import type { ComposeGraph, PortMapping, ServiceNode } from "./types";

export interface ServiceChange {
  name: string;
  image?: { before: string | null; after: string | null };
  build?: { before: string | null; after: string | null };
  portsAdded: string[];
  portsRemoved: string[];
  networksAdded: string[];
  networksRemoved: string[];
  dependsOnAdded: string[];
  dependsOnRemoved: string[];
}

export interface GraphDiff {
  servicesAdded: string[];
  servicesRemoved: string[];
  servicesChanged: ServiceChange[];
  networksAdded: string[];
  networksRemoved: string[];
  hasChanges: boolean;
}

function portKey(p: PortMapping): string {
  return `${p.host ?? "*"}:${p.container}/${p.protocol}`;
}

function setDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((x) => !beforeSet.has(x)).sort();
  const removed = before.filter((x) => !afterSet.has(x)).sort();
  return { added, removed };
}

function diffService(before: ServiceNode, after: ServiceNode): ServiceChange | null {
  const change: ServiceChange = {
    name: before.name,
    portsAdded: [],
    portsRemoved: [],
    networksAdded: [],
    networksRemoved: [],
    dependsOnAdded: [],
    dependsOnRemoved: [],
  };
  let changed = false;

  if (before.image !== after.image) {
    change.image = { before: before.image, after: after.image };
    changed = true;
  }
  if (before.build !== after.build) {
    change.build = { before: before.build, after: after.build };
    changed = true;
  }

  const portDiff = setDiff(before.ports.map(portKey), after.ports.map(portKey));
  if (portDiff.added.length || portDiff.removed.length) {
    change.portsAdded = portDiff.added;
    change.portsRemoved = portDiff.removed;
    changed = true;
  }

  const netDiff = setDiff(before.networks, after.networks);
  if (netDiff.added.length || netDiff.removed.length) {
    change.networksAdded = netDiff.added;
    change.networksRemoved = netDiff.removed;
    changed = true;
  }

  const depDiff = setDiff(before.dependsOn, after.dependsOn);
  if (depDiff.added.length || depDiff.removed.length) {
    change.dependsOnAdded = depDiff.added;
    change.dependsOnRemoved = depDiff.removed;
    changed = true;
  }

  return changed ? change : null;
}

/** Compute a structural diff between two ComposeGraphs (typically: a saved snapshot vs. a fresh parse). */
export function diffGraphs(before: ComposeGraph, after: ComposeGraph): GraphDiff {
  const beforeByName = new Map(before.services.map((s) => [s.name, s]));
  const afterByName = new Map(after.services.map((s) => [s.name, s]));

  const servicesAdded = after.services.filter((s) => !beforeByName.has(s.name)).map((s) => s.name).sort();
  const servicesRemoved = before.services.filter((s) => !afterByName.has(s.name)).map((s) => s.name).sort();

  const servicesChanged: ServiceChange[] = [];
  for (const [name, beforeSvc] of beforeByName) {
    const afterSvc = afterByName.get(name);
    if (!afterSvc) continue;
    const change = diffService(beforeSvc, afterSvc);
    if (change) servicesChanged.push(change);
  }
  servicesChanged.sort((a, b) => a.name.localeCompare(b.name));

  const networkDiff = setDiff(
    before.networks.map((n) => n.name),
    after.networks.map((n) => n.name)
  );

  const hasChanges =
    servicesAdded.length > 0 ||
    servicesRemoved.length > 0 ||
    servicesChanged.length > 0 ||
    networkDiff.added.length > 0 ||
    networkDiff.removed.length > 0;

  return {
    servicesAdded,
    servicesRemoved,
    servicesChanged,
    networksAdded: networkDiff.added,
    networksRemoved: networkDiff.removed,
    hasChanges,
  };
}

/** Render a GraphDiff as a human-readable, git-diff-style report for the CLI. */
export function formatDiff(diff: GraphDiff): string {
  if (!diff.hasChanges) {
    return "No drift detected: current compose file matches the snapshot.";
  }

  const lines: string[] = [];

  for (const name of diff.servicesAdded) lines.push(`+ service added: ${name}`);
  for (const name of diff.servicesRemoved) lines.push(`- service removed: ${name}`);
  for (const name of diff.networksAdded) lines.push(`+ network added: ${name}`);
  for (const name of diff.networksRemoved) lines.push(`- network removed: ${name}`);

  for (const change of diff.servicesChanged) {
    lines.push(`~ service changed: ${change.name}`);
    if (change.image) lines.push(`    image: ${change.image.before ?? "(none)"} -> ${change.image.after ?? "(none)"}`);
    if (change.build) lines.push(`    build: ${change.build.before ?? "(none)"} -> ${change.build.after ?? "(none)"}`);
    for (const p of change.portsAdded) lines.push(`    + port ${p}`);
    for (const p of change.portsRemoved) lines.push(`    - port ${p}`);
    for (const n of change.networksAdded) lines.push(`    + network ${n}`);
    for (const n of change.networksRemoved) lines.push(`    - network ${n}`);
    for (const d of change.dependsOnAdded) lines.push(`    + depends_on ${d}`);
    for (const d of change.dependsOnRemoved) lines.push(`    - depends_on ${d}`);
  }

  return lines.join("\n");
}
