import type { ComposeGraph, ServiceNode } from "./types";

/** Pixel geometry for a single box (service or network header) in the rendered diagram. */
export interface BoxLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  services: Map<string, BoxLayout>;
  networks: Map<string, BoxLayout>;
  /** Network each service is considered primarily "inside" (its column). */
  primaryNetwork: Map<string, string>;
}

const MARGIN = 40;
const COLUMN_WIDTH = 280;
const NODE_WIDTH = 220;
const HEADER_HEIGHT = 44;
const ROW_GAP = 22;
const LINE_HEIGHT = 16;
const BASE_NODE_HEIGHT = 36;
const MAX_PORT_LINES = 4;

function serviceLineCount(svc: ServiceNode): number {
  let lines = 0;
  if (svc.image || svc.build) lines += 1;
  lines += Math.min(svc.ports.length, MAX_PORT_LINES);
  if (svc.ports.length > MAX_PORT_LINES) lines += 1; // "+N more" line
  return lines;
}

/**
 * Compute a deterministic, purely-geometric layout: one column per network,
 * each service placed in the column of its first declared network ("primary"),
 * stacked top-to-bottom in alphabetical order (the parser already sorts
 * `graph.services`). This needs no external layout engine and produces stable,
 * reproducible coordinates for the same input every time.
 */
export function computeLayout(graph: ComposeGraph): DiagramLayout {
  const networks = graph.networks.length > 0 ? graph.networks : [];
  const networkColumn = new Map<string, number>();
  networks.forEach((net, i) => networkColumn.set(net.name, i));

  const columns = new Map<number, ServiceNode[]>();
  const primaryNetwork = new Map<string, string>();

  for (const svc of graph.services) {
    const primary = svc.networks[0];
    const idx = networkColumn.get(primary) ?? 0;
    primaryNetwork.set(svc.name, primary);
    if (!columns.has(idx)) columns.set(idx, []);
    columns.get(idx)!.push(svc);
  }

  const servicePos = new Map<string, BoxLayout>();
  const networkPos = new Map<string, BoxLayout>();
  let maxBottom = MARGIN + HEADER_HEIGHT;

  networks.forEach((net, i) => {
    const x = MARGIN + i * COLUMN_WIDTH;
    const y = MARGIN;
    networkPos.set(net.name, { x, y, width: NODE_WIDTH, height: HEADER_HEIGHT });

    let cursorY = y + HEADER_HEIGHT + ROW_GAP;
    const svcs = columns.get(i) ?? [];
    for (const svc of svcs) {
      const height = BASE_NODE_HEIGHT + serviceLineCount(svc) * LINE_HEIGHT;
      servicePos.set(svc.name, { x, y: cursorY, width: NODE_WIDTH, height });
      cursorY += height + ROW_GAP;
    }
    maxBottom = Math.max(maxBottom, cursorY);
  });

  const columnCount = Math.max(networks.length, 1);
  const width = MARGIN * 2 + (columnCount - 1) * COLUMN_WIDTH + NODE_WIDTH;
  const height = maxBottom + MARGIN;

  return { width, height, services: servicePos, networks: networkPos, primaryNetwork };
}

export const LAYOUT_CONSTANTS = {
  MARGIN,
  COLUMN_WIDTH,
  NODE_WIDTH,
  HEADER_HEIGHT,
  ROW_GAP,
  LINE_HEIGHT,
  BASE_NODE_HEIGHT,
  MAX_PORT_LINES,
};
