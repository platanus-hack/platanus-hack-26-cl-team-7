import type { CaseFile, EvidenceId, Hypothesis, RequestRow } from "@sentinel/contracts";
import { byTime } from "./sources.ts";

/** Resolves an evidence ID to its row. Must return null for another IP's row and for rows outside the window. */
export type EvidenceLookup = (id: EvidenceId) => RequestRow | null;

type Resolved = Map<string, RequestRow>;
const oldestFirst = (rows: Resolved): RequestRow[] => [...rows.values()].sort(byTime);

/** Keeps the IDs that resolve and records their rows. */
function resolveIds(ids: EvidenceId[], lookup: EvidenceLookup, rows: Resolved): EvidenceId[] {
  return ids.filter((id) => {
    const row = lookup(id);
    if (row) rows.set(row.id, row);
    return row !== null;
  });
}

/** Keeps the items that still cite at least one resolved ID. */
function resolveAll<T extends { evidence: EvidenceId[] }>(items: T[], lookup: EvidenceLookup, rows: Resolved): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const evidence = resolveIds(item.evidence, lookup, rows);
    if (evidence.length > 0) kept.push({ ...item, evidence });
  }
  return kept;
}

/**
 * Drops evidence IDs that do not resolve, then facts left with none. The model cannot cite what the stores do not hold.
 * `exploitEvidence` goes through the same lookup and is emptied unless the verdict is exploited; its rows join `rows`.
 */
export function checkCaseFile(caseFile: CaseFile, lookup: EvidenceLookup): { caseFile: CaseFile; removedFacts: number; rows: RequestRow[] } {
  const rows: Resolved = new Map();
  const facts = resolveAll(caseFile.facts, lookup, rows);
  const exploitEvidence = caseFile.verdict === "exploited" ? resolveIds([...new Set(caseFile.exploitEvidence)], lookup, rows) : [];
  return { caseFile: { ...caseFile, facts, exploitEvidence }, removedFacts: caseFile.facts.length - facts.length, rows: oldestFirst(rows) };
}

/** Same check for the conflicts an engineer lists when it disagrees with a refusal reason. */
export function checkConflicts(hypothesis: Hypothesis, lookup: EvidenceLookup): { hypothesis: Hypothesis; removedConflicts: number; rows: RequestRow[] } {
  const rows: Resolved = new Map();
  const conflicts = resolveAll(hypothesis.conflicts, lookup, rows);
  return { hypothesis: { ...hypothesis, conflicts }, removedConflicts: hypothesis.conflicts.length - conflicts.length, rows: oldestFirst(rows) };
}
