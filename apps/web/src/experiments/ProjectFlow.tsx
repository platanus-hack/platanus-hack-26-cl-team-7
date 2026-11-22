import type { FixtureResult } from "@sentinel/contracts";

type Lane = {
  id: "A" | "B";
  title: string;
  observation: string;
  result: string;
  visibleEvidence: boolean;
};

function describe(fixture: FixtureResult, arm: Lane["id"]): Lane {
  const wire = fixture[arm];
  const observation = arm === "A" ? `Respuesta HTTP ${wire.status}`
    : wire.detected ? `Señal detectada · HTTP ${wire.status}` : `Sin señal de detección · HTTP ${wire.status}`;
  return {
    id: arm,
    title: arm === "A" ? "Directo al servicio" : "A través de Reaper",
    observation,
    result: wire.evidence ? "La evidencia llegó" : "La evidencia no llegó",
    visibleEvidence: wire.evidence,
  };
}

export function ProjectFlow({ fixture, recorded }: {
  fixture?: FixtureResult;
  recorded?: { A: { yes: number; total: number }; B: { yes: number; total: number } };
}) {
  if (!fixture && !recorded) return null;
  const lanes = fixture ? (["A", "B"] as const).map((arm) => describe(fixture, arm))
    : (["A", "B"] as const).map((arm): Lane => ({
      id: arm,
      title: arm === "A" ? "Directo al servicio" : "A través de Reaper",
      observation: "Resumen grabado",
      result: `${recorded![arm].yes}/${recorded![arm].total} con evidencia visible`,
      visibleEvidence: recorded![arm].yes > 0,
    }));

  return <figure className="xp-flow" aria-label="Recorrido comparado de las solicitudes en los brazos A y B">
    <div className="xp-flow-node xp-flow-origin"><strong>{fixture ? "Solicitud de prueba" : "Pruebas grabadas"}</strong><small>Misma entrada en A y B</small></div>
    <span className="xp-flow-fork" aria-hidden="true" />
    <ol className="xp-flow-lanes">
      {lanes.map(({ id, title, observation, result, visibleEvidence }) => <li key={id}>
        <div className="xp-flow-node"><strong><b>{id}</b> {title}</strong><small>{observation}</small></div>
        <span className="xp-flow-edge" aria-hidden="true" />
        <div className="xp-flow-node xp-flow-result" data-visible={visibleEvidence} data-arm={id}>
          <strong>{result}</strong><small>Observado por el cliente</small>
        </div>
      </li>)}
    </ol>
    {fixture && <figcaption>
      {fixture.actual.executed ? "El reintento quedó contenido. El servicio registró cero solicitudes."
        : fixture.actual.contained ? "Se instaló una regla. La contención del reintento no quedó confirmada."
          : "Este caso no instaló una regla de contención."}
    </figcaption>}
  </figure>;
}
