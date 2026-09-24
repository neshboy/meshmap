import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { parseComposeFile } from "../src/parser";
import { renderHtml, renderSvg } from "../src/render";
import { checkWellFormed } from "./html-well-formed";

function fixture(name: string): string {
  return path.join(__dirname, "fixtures", name);
}

describe("renderSvg", () => {
  const graph = parseComposeFile(fixture("basic-compose.yml"));
  const svg = renderSvg(graph);

  it("produces a single well-formed <svg> root", () => {
    const result = checkWellFormed(svg);
    expect(result.ok).toBe(true);
    expect(svg.trim().startsWith("<svg")).toBe(true);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("includes every service name as visible text", () => {
    expect(svg).toContain(">web<");
    expect(svg).toContain(">db<");
  });

  it("includes the network name", () => {
    expect(svg).toContain(">backend<");
  });

  it("includes port mapping labels", () => {
    expect(svg).toContain("8080");
    expect(svg).toContain("80");
  });

  it("draws a depends_on edge with an arrowhead marker", () => {
    expect(svg).toContain("marker-end");
    expect(svg).toContain("edge-depends");
  });

  it("draws network-membership edges for both services", () => {
    const membershipEdges = svg.match(/edge-network/g) ?? [];
    expect(membershipEdges.length).toBeGreaterThanOrEqual(2);
  });
});

describe("renderHtml", () => {
  const graph = parseComposeFile(fixture("base-compose.yml"));
  const html = renderHtml(graph);

  it("is a well-formed standalone HTML document", () => {
    const result = checkWellFormed(html);
    expect(result.ok).toBe(true);
  });

  it("starts with a doctype and has a title", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>");
  });

  it("embeds a real <svg> diagram, not a placeholder image", () => {
    expect(html).toContain("<svg");
    expect(html).not.toContain("<img");
  });

  it("contains every service name from the compose file", () => {
    for (const name of ["nginx", "web", "worker", "db", "cache"]) {
      expect(html).toContain(`>${name}<`);
    }
  });

  it("contains both network names", () => {
    expect(html).toContain(">frontend<");
    expect(html).toContain(">backend<");
  });

  it("reports service/network counts in the page metadata", () => {
    expect(html).toContain("5 service(s), 2 network(s)");
  });
});
