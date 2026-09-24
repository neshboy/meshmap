/**
 * Core domain model for Meshmap: the graph derived from a docker-compose file.
 *
 * This is intentionally decoupled from the raw YAML shape (see parser.ts) so
 * that rendering, snapshotting, and diffing all operate on a small, stable
 * representation instead of the (much messier) compose schema.
 */

/** A single published/exposed port mapping on a service. */
export interface PortMapping {
  /** Port (and optional address) as seen on the host, e.g. "8080" or "127.0.0.1:8080". */
  host: string | null;
  /** Port inside the container, e.g. "80". */
  container: string;
  /** Protocol, defaults to "tcp" when not specified in the compose file. */
  protocol: "tcp" | "udp";
  /** The raw string exactly as it appeared in the compose file, for display. */
  raw: string;
}

/** A single service ("container") parsed out of the `services:` block. */
export interface ServiceNode {
  /** The service's key in the compose file, e.g. "web", "db". */
  name: string;
  /** Image reference, if the service uses `image:`. */
  image: string | null;
  /** Build context/dockerfile, if the service uses `build:`. */
  build: string | null;
  /** Names of networks this service is attached to. */
  networks: string[];
  /** Other service names this service declares a `depends_on` relationship to. */
  dependsOn: string[];
  /** Port mappings declared under `ports:`. */
  ports: PortMapping[];
  /** Names of environment variables declared under `environment:` (values are never captured). */
  environmentKeys: string[];
}

/** A named network from the top-level `networks:` block, or one implied by service usage. */
export interface NetworkNode {
  name: string;
  /** True if the network is declared with `external: true`. */
  external: boolean;
  /** The compose-declared driver, e.g. "bridge", "overlay". Null if unspecified/implicit. */
  driver: string | null;
}

export type EdgeKind = "depends_on" | "network";

/** An edge between two services (via depends_on) or a service and a network (via membership). */
export interface GraphEdge {
  kind: EdgeKind;
  from: string;
  to: string;
  /** For "network" edges, the network name the relationship runs through. */
  network?: string;
}

/** The full graph derived from one or more parsed docker-compose files. */
export interface ComposeGraph {
  /** Schema version of this JSON shape, used by snapshot/diff to detect incompatible snapshots. */
  version: 1;
  services: ServiceNode[];
  networks: NetworkNode[];
  edges: GraphEdge[];
  /** Source file path(s) this graph was parsed from, for display purposes only. */
  sources: string[];
}
