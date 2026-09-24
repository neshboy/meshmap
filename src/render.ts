import type { ComposeGraph, ServiceNode } from "./types";
import { computeLayout, LAYOUT_CONSTANTS } from "./layout";
import type { LiveReport } from "./live";

export interface RenderOptions {
  /** Optional live-check result (see live.ts) used to badge nodes as running/not-found. */
  live?: LiveReport;
}

/** Escape text for safe inclusion inside SVG/HTML markup. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function portLabel(p: { host: string | null; container: string; protocol: string }): string {
  const proto = p.protocol === "udp" ? "/udp" : "";
  return p.host ? `${p.host}→${p.container}${proto}` : `${p.container}${proto} (random host port)`;
}

function renderLiveDot(x: number, y: number, found: boolean | null): string {
  if (found === null) return "";
  const fill = found ? "#2ecc71" : "#e74c3c";
  const title = found ? "confirmed running via docker" : "not found running via docker";
  return `<circle cx="${x}" cy="${y}" r="5" class="live-dot" fill="${fill}"><title>${escapeXml(title)}</title></circle>`;
}

function renderServiceBox(
  svc: ServiceNode,
  box: { x: number; y: number; width: number; height: number },
  liveFound: boolean | null
): string {
  const { x, y, width, height } = box;
  const lines: string[] = [];
  if (svc.image) lines.push(`img: ${svc.image}`);
  else if (svc.build) lines.push(`build: ${svc.build}`);

  const shown = svc.ports.slice(0, LAYOUT_CONSTANTS.MAX_PORT_LINES);
  for (const p of shown) lines.push(`port ${portLabel(p)}`);
  if (svc.ports.length > LAYOUT_CONSTANTS.MAX_PORT_LINES) {
    lines.push(`+${svc.ports.length - shown.length} more port(s)`);
  }

  const titleY = y + 22;
  const detailStartY = titleY + 20;

  const detailText = lines
    .map(
      (line, i) =>
        `<text x="${x + 12}" y="${detailStartY + i * LAYOUT_CONSTANTS.LINE_HEIGHT}" class="detail">${escapeXml(
          line
        )}</text>`
    )
    .join("\n    ");

  const envBadge =
    svc.environmentKeys.length > 0
      ? `<text x="${x + width - 10}" y="${y + height - 8}" class="badge" text-anchor="end">env: ${
          svc.environmentKeys.length
        }</text>`
      : "";

  return `
  <g class="node service-node" data-service="${escapeXml(svc.name)}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" class="service-box" />
    <text x="${x + 12}" y="${titleY}" class="title">${escapeXml(svc.name)}</text>
    ${detailText}
    ${envBadge}
    ${renderLiveDot(x + width - 10, y + 12, liveFound)}
  </g>`;
}

function renderNetworkHeader(
  name: string,
  external: boolean,
  box: { x: number; y: number; width: number; height: number },
  liveFound: boolean | null
): string {
  const { x, y, width, height } = box;
  const label = external ? `${name} (external)` : name;
  return `
  <g class="node network-node">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" class="network-box" />
    <text x="${x + width / 2}" y="${y + height / 2 + 5}" class="network-title" text-anchor="middle">${escapeXml(
      label
    )}</text>
    ${renderLiveDot(x + width - 10, y + 10, liveFound)}
  </g>`;
}

function centerOf(box: { x: number; y: number; width: number; height: number }): { cx: number; cy: number } {
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Render a ComposeGraph into a standalone SVG markup string (no XML prolog, embeddable in HTML). */
export function renderSvg(graph: ComposeGraph, options: RenderOptions = {}): string {
  const layout = computeLayout(graph);
  const parts: string[] = [];

  const liveNetworkFound = new Map<string, boolean>();
  const liveServiceFound = new Map<string, boolean>();
  if (options.live?.available) {
    for (const n of options.live.networks) liveNetworkFound.set(n.name, n.found);
    for (const s of options.live.services) liveServiceFound.set(s.name, s.found);
  }

  // Network headers first (so they sit visually "behind" edges drawn later).
  for (const net of graph.networks) {
    const box = layout.networks.get(net.name);
    const liveFound = options.live?.available ? liveNetworkFound.get(net.name) ?? false : null;
    if (box) parts.push(renderNetworkHeader(net.name, net.external, box, liveFound));
  }

  // Service boxes.
  for (const svc of graph.services) {
    const box = layout.services.get(svc.name);
    const liveFound = options.live?.available ? liveServiceFound.get(svc.name) ?? false : null;
    if (box) parts.push(renderServiceBox(svc, box, liveFound));
  }

  // Edges: shared-network membership (service -> network header).
  const edgeLines: string[] = [];
  for (const svc of graph.services) {
    const from = layout.services.get(svc.name);
    if (!from) continue;
    for (const netName of svc.networks) {
      const to = layout.networks.get(netName);
      if (!to) continue;
      const a = centerOf(from);
      const b = { cx: to.x + to.width / 2, cy: to.y + to.height };
      const isPrimary = layout.primaryNetwork.get(svc.name) === netName;
      edgeLines.push(
        `<line x1="${a.cx}" y1="${from.y}" x2="${b.cx}" y2="${b.cy}" class="${
          isPrimary ? "edge-network-primary" : "edge-network"
        }" />`
      );
    }
  }

  // Edges: depends_on (service -> service), drawn with an arrowhead.
  for (const svc of graph.services) {
    const from = layout.services.get(svc.name);
    if (!from) continue;
    for (const dep of svc.dependsOn) {
      const to = layout.services.get(dep);
      if (!to) continue;
      const a = centerOf(from);
      const b = centerOf(to);
      edgeLines.push(
        `<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" class="edge-depends" marker-end="url(#arrow)" />`
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" font-family="Segoe UI, Helvetica, Arial, sans-serif">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#c0392b" />
    </marker>
  </defs>
  <style>
    .service-box { fill: #eef4fb; stroke: #2f6fb0; stroke-width: 1.5; }
    .network-box { fill: #2f6fb0; stroke: #1c4a78; stroke-width: 1; }
    .title { font-size: 14px; font-weight: 600; fill: #14314f; }
    .detail { font-size: 11px; fill: #3c556f; }
    .badge { font-size: 10px; fill: #6b7f93; }
    .network-title { font-size: 13px; font-weight: 600; fill: #ffffff; }
    .edge-network { stroke: #9db8d1; stroke-width: 1.25; stroke-dasharray: 4 3; fill: none; }
    .edge-network-primary { stroke: #6f95bd; stroke-width: 1.5; fill: none; }
    .edge-depends { stroke: #c0392b; stroke-width: 1.75; fill: none; }
    .live-dot { stroke: #ffffff; stroke-width: 1; }
  </style>
  <g class="edges">
    ${edgeLines.join("\n    ")}
  </g>
  <g class="nodes">
    ${parts.join("\n  ")}
  </g>
</svg>`;

  return svg;
}

/** Render a full standalone HTML document (embedded SVG diagram + legend) for a ComposeGraph. */
export function renderHtml(graph: ComposeGraph, options: RenderOptions = {}): string {
  const svg = renderSvg(graph, options);
  const sourceLabel = graph.sources.map(escapeXml).join(", ") || "docker-compose.yml";
  const generatedAt = new Date().toISOString();
  const liveNote = options.live
    ? options.live.available
      ? `<span><span class="dot dot-ok"></span> confirmed running (docker project "${escapeXml(
          options.live.project
        )}")</span><span><span class="dot dot-missing"></span> not found running</span>`
      : `<span class="count">live check skipped: ${escapeXml(options.live.error ?? "docker unavailable")}</span>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Meshmap - ${sourceLabel}</title>
<style>
  body { font-family: Segoe UI, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; background: #f7f9fb; color: #14314f; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #6b7f93; margin-bottom: 20px; }
  .diagram-wrap { background: #ffffff; border: 1px solid #d7e2ec; border-radius: 8px; padding: 16px; overflow: auto; }
  .legend { margin-top: 16px; font-size: 12px; color: #3c556f; display: flex; gap: 20px; flex-wrap: wrap; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { display: inline-block; width: 18px; height: 3px; }
  .swatch.network { background: #6f95bd; }
  .swatch.depends { background: #c0392b; }
  .count { color: #6b7f93; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; }
  .dot-ok { background: #2ecc71; }
  .dot-missing { background: #e74c3c; }
</style>
</head>
<body>
  <h1>Meshmap topology</h1>
  <div class="meta">Source: ${sourceLabel} &middot; Generated ${generatedAt} &middot;
    <span class="count">${graph.services.length} service(s), ${graph.networks.length} network(s)</span>
  </div>
  <div class="diagram-wrap">
    ${svg}
  </div>
  <div class="legend">
    <span><span class="swatch network"></span> shared network membership</span>
    <span><span class="swatch depends"></span> depends_on</span>
    ${liveNote}
  </div>
</body>
</html>
`;
}
