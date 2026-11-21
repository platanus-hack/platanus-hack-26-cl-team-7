/**
 * Markdown-lite for copilot answers. It covers what the copilot writes:
 * paragraphs, headings, **bold**, `code`, bullet findings and numbered steps.
 * No HTML is produced, so model output can never inject markup.
 */

export type Inline = { t: "text"; v: string } | { t: "b"; v: string } | { t: "code"; v: string };

export interface Finding {
  title: Inline[] | null;
  detail: Inline[];
}

export type Block =
  | { kind: "p"; inl: Inline[] }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: Finding[] }
  | { kind: "ol"; items: Inline[][] };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ t: "text", v: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", v: m[1] });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", v: src.slice(last) });
  return out;
}

/** Splits "**Title.** detail" into a finding with a title line and a detail line. */
export function toFinding(src: string): Finding {
  const m = /^\*\*([^*]+)\*\*\s*(.*)$/s.exec(src.trim());
  if (!m) return { title: null, detail: parseInline(src.trim()) };
  const title = (m[1] ?? "").trim().replace(/[.:]$/, "");
  const rest = (m[2] ?? "").replace(/^([—–:.-]\s*)/, "").trim();
  return { title: parseInline(title), detail: parseInline(rest) };
}

const HEADING = /^#{1,6}\s+(.+)$/;
const BOLD_HEADING = /^\*\*([^*]+)\*\*:?$/;
const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", inl: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    if (list.kind === "ul") blocks.push({ kind: "ul", items: list.items.map(toFinding) });
    else blocks.push({ kind: "ol", items: list.items.map((s) => parseInline(s.trim())) });
    list = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushPara();
      continue;
    }
    const h = HEADING.exec(line) ?? (list === null && para.length === 0 ? BOLD_HEADING.exec(line.trim()) : null);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: "h", text: (h[1] ?? "").trim().replace(/:$/, "") });
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [] };
      list.items.push(((ul ?? ol)?.[1] ?? "").trim());
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      const items: string[] = list.items;
      items[items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

export function inlineToText(inl: Inline[]): string {
  return inl.map((i) => i.v).join("");
}
