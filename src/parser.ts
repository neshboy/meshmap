import * as fs from "node:fs";
import * as YAML from "yaml";
import type {
  ComposeGraph,
  GraphEdge,
  NetworkNode,
  PortMapping,
  ServiceNode,
} from "./types";

/** Name used for the implicit network compose creates when a service declares no `networks:`. */
export const DEFAULT_NETWORK_NAME = "default";

export class ComposeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeParseError";
  }
}

/** Loose shape of the parts of the docker-compose schema Meshmap understands. */
interface RawCompose {
  services?: Record<string, RawService | null> | null;
  networks?: Record<string, RawNetwork | null> | null;
}

interface RawService {
  image?: string;
  build?: string | Record<string, unknown>;
  ports?: Array<string | number | RawLongPort> | null;
  networks?: string[] | Record<string, unknown> | null;
  depends_on?: string[] | Record<string, unknown> | null;
  environment?: string[] | Record<string, unknown> | null;
}

interface RawLongPort {
  target?: string | number;
  published?: string | number;
  protocol?: string;
}

interface RawNetwork {
  driver?: string;
  external?: boolean | { name?: string };
}

/** Parse a single port entry (short or long syntax) into a normalized PortMapping. */
export function parsePortEntry(entry: string | number | RawLongPort): PortMapping {
  if (typeof entry === "object" && entry !== null) {
    const target = entry.target !== undefined ? String(entry.target) : "";
    const published = entry.published !== undefined ? String(entry.published) : null;
    const protocol = entry.protocol === "udp" ? "udp" : "tcp";
    const raw = published ? `${published}:${target}${protocol === "udp" ? "/udp" : ""}` : target;
    return { host: published, container: target, protocol, raw };
  }

  const raw = String(entry);
  let body = raw;
  let protocol: "tcp" | "udp" = "tcp";
  const protoMatch = /\/(tcp|udp)$/i.exec(body);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase() as "tcp" | "udp";
    body = body.slice(0, protoMatch.index);
  }

  const parts = body.split(":");
  if (parts.length === 1) {
    return { host: null, container: parts[0], protocol, raw };
  }
  if (parts.length === 2) {
    return { host: parts[0], container: parts[1], protocol, raw };
  }
  // HOST_IP:HOST_PORT:CONTAINER_PORT
  const container = parts[parts.length - 1];
  const host = parts.slice(0, parts.length - 1).join(":");
  return { host, container, protocol, raw };
}

function namesFromNetworksField(field: RawService["networks"]): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field.map(String);
  return Object.keys(field);
}

function namesFromDependsOn(field: RawService["depends_on"]): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field.map(String);
  return Object.keys(field);
}

function keysFromEnvironment(field: RawService["environment"]): string[] {
  if (!field) return [];
  if (Array.isArray(field)) {
    return field.map((entry) => String(entry).split("=")[0]);
  }
  return Object.keys(field);
}

function buildToString(build: RawService["build"]): string | null {
  if (build === undefined || build === null) return null;
  if (typeof build === "string") return build;
  if (typeof build === "object") {
    const context = (build as Record<string, unknown>).context;
    return context ? String(context) : JSON.stringify(build);
  }
  return String(build);
}

/** Parse raw YAML text (already read from disk) into a ComposeGraph. `source` is used only for labeling. */
export function parseComposeYaml(yamlText: string, source: string): ComposeGraph {
  let doc: unknown;
  try {
    doc = YAML.parse(yamlText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ComposeParseError(`Failed to parse YAML in ${source}: ${message}`);
  }

  if (doc === null || typeof doc !== "object") {
    throw new ComposeParseError(`${source} does not contain a valid docker-compose document.`);
  }

  const raw = doc as RawCompose;
  const rawServices = raw.services ?? {};
  const rawNetworks = raw.networks ?? {};

  if (typeof rawServices !== "object" || Array.isArray(rawServices)) {
    throw new ComposeParseError(`${source}: "services" must be a map of service name to definition.`);
  }

  const services: ServiceNode[] = [];
  const usedNetworkNames = new Set<string>();

  for (const [name, def] of Object.entries(rawServices)) {
    const service = def ?? {};
    const declaredNetworks = namesFromNetworksField(service.networks);
    const networks = declaredNetworks.length > 0 ? declaredNetworks : [DEFAULT_NETWORK_NAME];
    networks.forEach((n) => usedNetworkNames.add(n));

    const ports = (service.ports ?? []).map((p) => parsePortEntry(p));

    services.push({
      name,
      image: service.image ?? null,
      build: buildToString(service.build),
      networks,
      dependsOn: namesFromDependsOn(service.depends_on),
      ports,
      environmentKeys: keysFromEnvironment(service.environment),
    });
  }

  const serviceNames = new Set(services.map((s) => s.name));

  // Validate depends_on references point at real services (common authoring mistake).
  for (const service of services) {
    for (const dep of service.dependsOn) {
      if (!serviceNames.has(dep)) {
        throw new ComposeParseError(
          `${source}: service "${service.name}" declares depends_on "${dep}", which is not defined under services.`
        );
      }
    }
  }

  const networks: NetworkNode[] = [];
  const declaredNetworkNames = new Set(Object.keys(rawNetworks ?? {}));
  for (const netName of new Set([...usedNetworkNames, ...declaredNetworkNames])) {
    const def = (rawNetworks ?? {})[netName];
    const external = Boolean(def && typeof def === "object" && def.external);
    const driver = def && typeof def === "object" && def.driver ? def.driver : null;
    networks.push({ name: netName, external, driver });
  }
  networks.sort((a, b) => a.name.localeCompare(b.name));

  const edges: GraphEdge[] = [];
  for (const service of services) {
    for (const dep of service.dependsOn) {
      edges.push({ kind: "depends_on", from: service.name, to: dep });
    }
    for (const net of service.networks) {
      edges.push({ kind: "network", from: service.name, to: net, network: net });
    }
  }

  services.sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: 1,
    services,
    networks,
    edges,
    sources: [source],
  };
}

/** Read a docker-compose file from disk and parse it into a ComposeGraph. */
export function parseComposeFile(filePath: string): ComposeGraph {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ComposeParseError(`Could not read ${filePath}: ${message}`);
  }
  return parseComposeYaml(text, filePath);
}
