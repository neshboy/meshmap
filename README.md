# Meshmap

Meshmap is a small, read-only CLI for self-hosters and homelab operators. It
parses the `docker-compose.yml` file(s) you already have, draws a live
network topology diagram from them (services, networks, port mappings,
`depends_on`), and can snapshot that topology so a later run can flag drift.

It never talks to a container runtime to produce the diagram — everything
comes from statically reading and parsing your compose YAML. See
[Limitations](#limitations) for exactly what that does and doesn't cover, and
for the one optional feature (`--live`) that *does* talk to Docker.

## Install / quick start

```bash
git clone <this repo>
cd meshmap
npm install
npm run build
npm link   # makes the `meshmap` command available globally, or use `node dist/cli.js`
```

```bash
# Render a topology diagram from a compose file
meshmap render ./docker-compose.yml -o topology.html
open topology.html   # or just double-click it — it's a standalone HTML file

# Save a snapshot of the current topology
meshmap snapshot ./docker-compose.yml -o snapshot.json

# Later, check whether the compose file has drifted from that snapshot
meshmap diff ./docker-compose.yml --against snapshot.json
```

`meshmap diff` exits with status code `1` when drift is detected and `0`
when the compose file still matches the snapshot, so it's safe to wire into
a cron job or CI check.

## Example

[`examples/docker-compose.yml`](examples/docker-compose.yml) is a
representative multi-service app:

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    ports: ["80:80", "443:443"]
    depends_on: [web]
    networks: [frontend]

  web:
    build: { context: ./web, dockerfile: Dockerfile }
    ports: ["127.0.0.1:8000:8000"]
    depends_on: [db, cache]
    networks: [frontend, backend]

  worker:
    build: { context: ./web, dockerfile: Dockerfile.worker }
    depends_on: [db, cache]
    networks: [backend]

  db:
    image: postgres:16
    ports: ["5432"]
    networks: [backend]

  cache:
    image: redis:7-alpine
    networks: [backend]

networks:
  frontend: { driver: bridge }
  backend: { driver: bridge }
```

Running `meshmap render examples/docker-compose.yml -o topology.html`
produces a standalone HTML page with an embedded SVG diagram. In words, what
you'll see:

- **Two columns**, one per network, each with a dark-blue header pill labeled
  `frontend` and `backend`.
- Under the `frontend` column: light-blue boxes for **nginx** (showing
  `port 80→80`, `port 443→443`) and **web** (showing its build context and
  `port 127.0.0.1:8000→8000`).
- Under the `backend` column, top to bottom (services are laid out
  alphabetically within each network column): boxes for **cache**, **db**
  (`port 5432 (random host port)` — no fixed host port was declared), and
  **worker**.
- A dashed light-blue line from **web** up to the `backend` header, in
  addition to its solid line to `frontend` — because `web` belongs to both
  networks.
- Solid red arrows from **nginx → web**, **web → db**, **web → cache**,
  **worker → db**, and **worker → cache**, one per `depends_on` entry.
- A small `env: 3` badge in the corner of **web** noting it declares three
  environment variables (names only — Meshmap never renders values).
- A legend at the bottom explaining the line styles.

Every box, line, and label is real `<rect>`/`<line>`/`<text>` SVG generated
directly from the parsed compose file — there's no placeholder image and no
headless browser involved.

### Live cross-check (optional)

```bash
meshmap render ./docker-compose.yml -o topology.html --live --project myapp
```

adds a small green/red dot to each service and network box, and prints a
console report, based on querying the real Docker daemon (`docker network
ls`, `docker ps`) and matching Docker Compose v2's default naming
conventions (`<project>-<service>-<n>` for containers, `<project>_<network>`
for networks). See [Limitations](#limitations) — this was tested against a
real running compose stack, but the naming-convention matching is inherently
best-effort.

## Commands

| Command | What it does |
|---|---|
| `meshmap render <compose file> -o <html file>` | Parse the compose file and write a standalone HTML+SVG topology diagram. |
| `meshmap snapshot <compose file> -o <json file>` | Parse the compose file and save the resulting graph as JSON. |
| `meshmap diff <compose file> --against <snapshot.json>` | Re-parse the compose file and print additions/removals/changes vs. the snapshot. Exits `1` if drift was found. |

Common flags:
- `render --live [--project <name>]` — also cross-check against a running Docker daemon (see above).
- `diff --json` — print the diff as JSON instead of a text report.

## What it parses

From each service under `services:`:
- `image` or `build` (context/dockerfile)
- `ports` — both short syntax (`"8080:80"`, `"8080:80/udp"`, `"5432"`,
  `"127.0.0.1:8001:8001"`) and long syntax (`target`/`published`/`protocol`
  objects)
- `networks` — list form and map form; a service with no `networks:` key is
  treated as attached to the implicit `default` network Compose creates
- `depends_on` — list form and map form (with `condition:`); Meshmap
  validates that every referenced service actually exists
- `environment` — **only variable names are recorded, never values**, list
  or map form

From the top-level `networks:` block: name, `driver`, and whether it's
marked `external: true`.

## Development

```bash
npm install
npm run build       # compile TypeScript -> dist/
npm test            # run the vitest suite
npm run dev -- render examples/docker-compose.yml -o topology.html   # run from source via tsx
```

Tests live in `test/*.test.ts` against hand-written fixtures in
`test/fixtures/`, covering: parsing of services/ports/networks/depends_on
(including long-syntax ports, map-style `depends_on`/`environment`/`networks`,
external networks, and the implicit default network), SVG/HTML output
structure (well-formed tags, expected service/network names present), and
diff output for a fixture pair with a deliberately introduced service
addition and port change. `--live` is unit-tested with an injected fake
Docker runner (so the suite never needs a real daemon), and was additionally
smoke-tested by hand against a real running `docker compose` stack during
development.

## Limitations

- **Static analysis only, by default.** Meshmap reads and parses your
  compose YAML; it does not monitor live traffic, and (outside of `--live`)
  it does not query Docker, so it does not know which services are actually
  running, healthy, or reachable — only what the file declares.
- **`--live` is best-effort.** It matches Docker's *default* Compose v2
  naming conventions. It will not correctly detect services that use a
  `container_name:` override, networks created with an explicit `name:`
  override, Compose v1's legacy underscore-separated container names, or
  services scaled to multiple replicas beyond noticing that some instance
  exists. It was manually verified against a real running compose stack, but
  is not something to rely on for anything security-sensitive.
- **Single compose file per run.** Multi-file `docker-compose.yml` +
  override merging (`-f a.yml -f b.yml`) is not implemented.
- **No `.env` / variable interpolation.** `${VAR}` substitutions in the
  compose file are not resolved; they show up in the diagram verbatim.
- **Default-network heuristic.** A service with no `networks:` key is
  treated as being on a synthetic `default` network. Real Compose's actual
  behavior around the implicit default network has a couple of edge cases
  (e.g. `networks: {default: null}` at the top level) that this
  simplification doesn't special-case.
- **Layout is deterministic but simple.** Nodes are grouped into columns by
  "first declared network" and stacked top-to-bottom; it is not a
  force-directed or crossing-minimizing layout, so large graphs with many
  cross-network dependencies may have overlapping edge lines.

## License

MIT © 2026 Meshmap contributors — see [LICENSE](LICENSE).
