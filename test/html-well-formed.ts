/**
 * Minimal structural well-formedness checker for the XML/HTML-ish markup
 * Meshmap generates. It walks every tag with a stack and verifies open/close
 * tags nest correctly, without pulling in a full DOM/XML parser dependency.
 * Void/self-closing tags (ending in "/>", or known HTML void elements) are
 * not pushed onto the stack.
 */
const VOID_ELEMENTS = new Set(["meta", "br", "img", "input", "hr", "link"]);
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^<>]*?)(\/?)>/g;

export interface WellFormedResult {
  ok: boolean;
  error?: string;
}

export function checkWellFormed(markup: string): WellFormedResult {
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;

  while ((match = TAG_RE.exec(markup)) !== null) {
    const [, closingSlash, tagName, , selfClosingSlash] = match;

    if (tagName.toLowerCase() === "!doctype") continue;

    if (closingSlash === "/") {
      const top = stack.pop();
      if (top !== tagName) {
        return {
          ok: false,
          error: `Mismatched closing tag </${tagName}> at index ${match.index}; expected </${top ?? "(empty stack)"}>`,
        };
      }
      continue;
    }

    if (selfClosingSlash === "/" || VOID_ELEMENTS.has(tagName.toLowerCase())) {
      continue;
    }

    stack.push(tagName);
  }

  if (stack.length > 0) {
    return { ok: false, error: `Unclosed tag(s): ${stack.join(", ")}` };
  }
  return { ok: true };
}
