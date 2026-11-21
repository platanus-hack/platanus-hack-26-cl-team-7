/**
 * What a caught agent proved on the decoy, each proof with its fix.
 * Interface: `<Proofs findings={…} />`. Findings are newest first, as the API sends them.
 */
import type { Finding } from "@sentinel/contracts";
import { FixBlock } from "./FixBlock";
import { PROOF_TITLE, proofDetail } from "./plain";

function Proof({ f }: { f: Finding }) {
  const detail = proofDetail(f);
  return (
    <article className="proof" aria-label={PROOF_TITLE[f.kind]}>
      <div className="proof-what">
        <h4>
          <span className="ml-key ml-key-proof" aria-hidden />
          {PROOF_TITLE[f.kind]}
        </h4>
        <p>{detail.text}</p>
        {detail.request && (
          <pre className="req" aria-label="Request">
            {detail.request}
          </pre>
        )}
      </div>
      <FixBlock finding={f} />
    </article>
  );
}

export function Proofs({ findings }: { findings: Finding[] }) {
  return (
    <section className="j-sect" aria-labelledby="proved-h">
      <h3 id="proved-h">What it proved</h3>
      {findings.length === 0 ? (
        <p className="fog">Nothing so far. A proof shows here when one of its requests works on the decoy.</p>
      ) : (
        findings.map((f) => <Proof key={f.findingId} f={f} />)
      )}
    </section>
  );
}
