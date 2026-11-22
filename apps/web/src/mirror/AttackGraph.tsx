/**
 * The attack path of one caught agent as a small graph (React Flow): agent -> Centinela -> fake copy,
 * with the path to the real shop blocked. Interface: `<AttackGraph track moment shot decoys story? />`.
 * A lab agent passes `story`: agent -> Centinela -> the service, with the proof held back.
 * Each time `shot` changes, up to 5 requests travel to the fake copy and back (Motion), coloured by
 * what the agent got. Strings from the track render as text only.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import {
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  getBezierPath,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { animate } from "motion";
import { LockSimple, Robot, ShieldCheck, Storefront } from "@phosphor-icons/react";
import type { Track } from "@sentinel/contracts";
import type { GraphStory } from "../experiments/labTrack";
import { cn } from "../ui";
import { agentName, disguises, numEs, type Moment, type MomentKind } from "./moments";
import "@xyflow/react/dist/style.css";

export const KIND_COLOR: Record<MomentKind, string> = { fooled: "var(--c-ok)", win: "var(--c-danger)", none: "var(--color-mid)" };

const HOP = 0.4; // seconds for one edge
const NODE_W = 168; // .ag-node width
const DOT = 44; // .ag-dot size
const STAGGER = 0.08;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------ nodes ------------------------------ */

type CardData = { icon: "agent" | "sentinel" | "decoy" | "real" | "service" | "proof"; title: string; sub: string; mono?: boolean; shot?: number };
type CardNode = Node<CardData, "card">;

const ICONS = { agent: Robot, sentinel: ShieldCheck, decoy: Storefront, real: LockSimple, service: Storefront, proof: LockSimple };

const CardNodeView = memo(function CardNodeView({ data }: NodeProps<CardNode>) {
  const Icon = ICONS[data.icon];
  const box = useRef<HTMLSpanElement>(null);
  // The fake copy lights up when the requests reach it.
  useEffect(() => {
    if (data.icon !== "decoy" || !data.shot || !box.current || reducedMotion()) return;
    const a = animate(
      box.current,
      { boxShadow: ["0 0 0 0 rgba(34,197,94,0)", "0 0 0 6px rgba(34,197,94,0.22)", "0 0 0 0 rgba(34,197,94,0)"] },
      { duration: 0.7, delay: 2 * HOP - 0.1 },
    );
    return () => a.stop();
  }, [data.icon, data.shot]);
  return (
    <div className={cn("ag-node", `ag-${data.icon}`)}>
      {data.icon !== "agent" && <Handle type="target" position={Position.Left} isConnectable={false} style={{ top: DOT / 2, left: (NODE_W - DOT) / 2 }} />}
      <span ref={box} className="ag-dot">
        <Icon size={20} weight="duotone" aria-hidden />
      </span>
      <span className={cn("ag-t", data.mono && "mono")}>{data.title}</span>
      <span className="ag-s">{data.sub}</span>
      {(data.icon === "agent" || data.icon === "sentinel") && (
        <Handle type="source" position={Position.Right} isConnectable={false} style={{ top: DOT / 2, left: (NODE_W + DOT) / 2 }} />
      )}
    </div>
  );
});

/* ------------------------------ edges ------------------------------ */

type PacketData = { hop: 0 | 1; shot: number; count: number; back: string };
type PacketEdgeT = Edge<PacketData, "packet">;

/** An edge that carries requests: hop 0 is agent -> Sentinel, hop 1 is Sentinel -> fake copy. */
function PacketEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style }: EdgeProps<PacketEdgeT>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const line = useRef<SVGPathElement>(null);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const { hop = 0, shot = 0, count = 0, back = "var(--color-text)" } = data ?? {};
  // Only a new shot plays; a refetch that grows the shown moment does not replay it.
  const trip = useRef({ count, back });
  trip.current = { count, back };
  useEffect(() => {
    const { count, back } = trip.current;
    const p = line.current;
    if (!shot || !p || reducedMotion()) return;
    const n = Math.min(5, count);
    const len = p.getTotalLength();
    const total = 4 * HOP + n * STAGGER;
    const place = (v: number) =>
      dots.current.forEach((d, j) => {
        if (!d) return;
        const u = v * total - j * STAGGER; // seconds into this request's trip
        // Out: hop 0 then hop 1. Back: hop 1 then hop 0.
        const outStart = hop * HOP;
        const backStart = (3 - hop) * HOP;
        let t = -1;
        let going = true;
        if (j < n && u >= outStart && u <= outStart + HOP) t = (u - outStart) / HOP;
        else if (j < n && u >= backStart && u <= backStart + HOP) [t, going] = [1 - (u - backStart) / HOP, false];
        if (t < 0) return d.setAttribute("opacity", "0");
        const pt = p.getPointAtLength(t * len);
        d.setAttribute("cx", String(pt.x));
        d.setAttribute("cy", String(pt.y));
        d.setAttribute("fill", going ? "var(--color-text)" : back);
        d.setAttribute("opacity", "1");
      });
    const a = animate(0, 1, { duration: total, ease: "linear", onUpdate: place, onComplete: () => place(2) });
    return () => {
      a.stop();
      place(2);
    };
  }, [shot, hop]);
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      <path ref={line} d={path} fill="none" stroke="none" />
      {Array.from({ length: 5 }, (_, j) => (
        <circle
          key={j}
          ref={(el) => {
            dots.current[j] = el;
          }}
          r={4.5}
          opacity={0}
        />
      ))}
    </>
  );
}

/** The path Sentinel keeps closed: to the real shop. */
function BlockedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <BaseEdge id={id} path={path} style={{ stroke: "var(--c-danger)", strokeOpacity: 0.45, strokeDasharray: "3 5", strokeWidth: 1.25 }} />;
}

const FIT = { padding: 0.08 };

/** Fits the graph again when its box changes size (window, sidebar overlay); pan and zoom are off. */
function FitOnResize() {
  const { fitView } = useReactFlow();
  const el = useStore((s) => s.domNode);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => void fitView(FIT));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, fitView]);
  return null;
}

const nodeTypes = { card: CardNodeView };
const edgeTypes = { packet: PacketEdge, blocked: BlockedEdge };

/** The caught-agent story: Centinela sends the agent to a fake copy and keeps it off the real shop. */
function mirrorStory(track: Track, decoys: number): GraphStory {
  return {
    label: "Ruta del ataque: el agente pasa por Centinela a la copia falsa; la tienda real está bloqueada.",
    agent: { title: agentName(track.userAgent), sub: disguises(track) || "Agente atrapado" },
    sentinel: { title: "Centinela", sub: "lo desvió" },
    top: { icon: "decoy", title: "Copia falsa", sub: `${numEs(decoys)} respuestas falsas` },
    bottom: { icon: "real", title: "Tienda real", sub: "0 visitas desde la captura" },
  };
}

export function AttackGraph({ track, moment, shot, decoys, story }: { track: Track; moment: Moment | undefined; shot: number; decoys: number; story?: GraphStory }) {
  const s = story ?? mirrorStory(track, decoys);
  const nodes = useMemo<CardNode[]>(
    () => [
      { id: "agent", type: "card", position: { x: 0, y: 60 }, data: { icon: "agent", ...s.agent } },
      { id: "sentinel", type: "card", position: { x: 250, y: 60 }, data: { icon: "sentinel", ...s.sentinel } },
      { id: "decoy", type: "card", position: { x: 500, y: 0 }, data: { ...s.top, shot } },
      { id: "real", type: "card", position: { x: 500, y: 125 }, data: s.bottom },
    ],
    // The story is rebuilt each render; its words are what can change.
    [s.agent.title, s.agent.sub, s.sentinel.sub, s.top.icon, s.top.title, s.top.sub, s.bottom.icon, s.bottom.title, s.bottom.sub, shot],
  );
  const back = moment ? KIND_COLOR[moment.kind] : "var(--color-text)";
  const count = moment?.count ?? 0;
  const edges = useMemo<Edge[]>(
    () => [
      { id: "e-in", source: "agent", target: "sentinel", type: "packet", data: { hop: 0, shot, count, back }, style: { stroke: "var(--color-iron)", strokeWidth: 1.5 } },
      { id: "e-decoy", source: "sentinel", target: "decoy", type: "packet", animated: !reducedMotion(), data: { hop: 1, shot, count, back }, style: { stroke: "var(--c-ok)", strokeOpacity: 0.6, strokeWidth: 1.5 } },
      { id: "e-real", source: "sentinel", target: "real", type: "blocked" },
    ],
    [shot, count, back],
  );
  return (
    <div className="ag" role="img" aria-label={s.label}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="dark"
        fitView
        fitViewOptions={FIT}
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <FitOnResize />
      </ReactFlow>
    </div>
  );
}
