import React, { useState, useMemo, useRef } from 'react';
import {
  AppWindow,
  Server,
  FileCheck2,
  Globe,
  Binary,
  Database,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ExternalLink,
  X,
  Lock,
  Network,
} from 'lucide-react';
import { GraphNode, GraphEdge, GraphTier, EvidenceFinding, SeverityLevel } from '../../types';

interface CryptoGraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidenceLookup: Record<string, EvidenceFinding>;
  onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TIER_ORDER: GraphTier[] = [
  'Application',
  'Service',
  'Certificate',
  'Protocol',
  'Algorithm',
  'Data',
];

export const CryptoGraphCanvas: React.FC<CryptoGraphCanvasProps> = ({
  nodes,
  edges,
  evidenceLookup,
  onOpenEvidence,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Zoom and Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Tier Colors & Icons
  const getTierMeta = (tier: GraphTier) => {
    switch (tier) {
      case 'Application':
        return {
          color: 'text-cyan-400',
          bg: 'bg-cyan-950/80',
          border: 'border-cyan-700/70',
          icon: AppWindow,
          ring: 'ring-cyan-500/30',
        };
      case 'Service':
        return {
          color: 'text-blue-400',
          bg: 'bg-blue-950/80',
          border: 'border-blue-700/70',
          icon: Server,
          ring: 'ring-blue-500/30',
        };
      case 'Certificate':
        return {
          color: 'text-amber-400',
          bg: 'bg-amber-950/80',
          border: 'border-amber-700/70',
          icon: FileCheck2,
          ring: 'ring-amber-500/30',
        };
      case 'Protocol':
        return {
          color: 'text-emerald-400',
          bg: 'bg-emerald-950/80',
          border: 'border-emerald-700/70',
          icon: Globe,
          ring: 'ring-emerald-500/30',
        };
      case 'Algorithm':
        return {
          color: 'text-purple-400',
          bg: 'bg-purple-950/80',
          border: 'border-purple-700/70',
          icon: Binary,
          ring: 'ring-purple-500/30',
        };
      case 'Data':
        return {
          color: 'text-rose-400',
          bg: 'bg-rose-950/80',
          border: 'border-rose-700/70',
          icon: Database,
          ring: 'ring-rose-500/30',
        };
    }
  };

  const getSeverityBadge = (sev: SeverityLevel) => {
    switch (sev) {
      case 'Critical':
        return 'text-rose-400 border-rose-500/60 bg-rose-950/70';
      case 'High':
        return 'text-amber-400 border-amber-500/60 bg-amber-950/70';
      case 'Medium':
        return 'text-yellow-400 border-yellow-500/60 bg-yellow-950/70';
      case 'Low':
        return 'text-sky-400 border-sky-500/60 bg-sky-950/70';
      default:
        return 'text-slate-400 border-slate-700 bg-slate-850';
    }
  };

  // Group nodes by tier and compute positions
  const { positionedNodes, nodeMap, canvasHeight } = useMemo(() => {
    const nodeWidth = 230;
    const nodeHeight = 84;
    const colSpacing = 280;
    const rowSpacing = 110;
    const startX = 60;
    const startY = 80;

    const tierGroups: Record<GraphTier, GraphNode[]> = {
      Application: [],
      Service: [],
      Certificate: [],
      Protocol: [],
      Algorithm: [],
      Data: [],
    };

    nodes.forEach((node) => {
      const tier = node.tier;
      if (tierGroups[tier]) {
        tierGroups[tier].push(node);
      }
    });

    let maxRows = 0;
    const posList: PositionedNode[] = [];
    const map = new Map<string, PositionedNode>();

    TIER_ORDER.forEach((tier, colIdx) => {
      const group = tierGroups[tier];
      if (group.length > maxRows) maxRows = group.length;
      group.forEach((node, rowIdx) => {
        const x = startX + colIdx * colSpacing;
        const y = startY + rowIdx * rowSpacing;
        const pNode: PositionedNode = {
          ...node,
          x,
          y,
          width: nodeWidth,
          height: nodeHeight,
        };
        posList.push(pNode);
        map.set(node.id, pNode);
      });
    });

    const cHeight = Math.max(700, startY + maxRows * rowSpacing + 120);

    return {
      positionedNodes: posList,
      nodeMap: map,
      canvasHeight: cHeight,
    };
  }, [nodes]);

  // Compute connected nodes for active highlight
  const activeFocusId = hoveredNodeId || selectedNodeId;
  const connectedIds = useMemo(() => {
    if (!activeFocusId) return null;
    const set = new Set<string>();
    set.add(activeFocusId);

    // Forward walk
    const queue = [activeFocusId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      edges.forEach((e) => {
        if (e.source === curr && !set.has(e.target)) {
          set.add(e.target);
          queue.push(e.target);
        }
      });
    }

    // Backward walk
    const backQueue = [activeFocusId];
    while (backQueue.length > 0) {
      const curr = backQueue.shift()!;
      edges.forEach((e) => {
        if (e.target === curr && !set.has(e.source)) {
          set.add(e.source);
          backQueue.push(e.source);
        }
      });
    }

    return set;
  }, [activeFocusId, edges]);

  // Mouse wheel pan/zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Zoom with Ctrl/Cmd + Scroll
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      setZoom((prev) => Math.min(2.2, Math.max(0.4, prev * zoomFactor)));
    } else {
      // Pan with normal Scroll
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  // Pan interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const resetView = () => {
    setZoom(0.85);
    setPan({ x: 30, y: 30 });
    setSelectedNodeId(null);
  };

  // Selected node entity
  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;

  return (
    <div className="relative w-full h-[720px] rounded-2xl bg-slate-950 border border-slate-800/90 overflow-hidden shadow-2xl flex flex-col">
      {/* Canvas Controls Header */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
        <span className="text-slate-400 font-mono">Zoom: {Math.round(zoom * 100)}%</span>
        <div className="h-3 w-px bg-slate-700" />
        <button
          onClick={() => setZoom((z) => Math.min(2.2, z * 1.15))}
          className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.4, z * 0.85))}
          className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={resetView}
          className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          title="Fit to Screen"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tier Column Headers Floating Strip */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 text-[11px] font-mono">
        <span className="text-slate-500 mr-1">Pipeline Tiers:</span>
        {TIER_ORDER.map((tier, idx) => (
          <React.Fragment key={tier}>
            <span className={getTierMeta(tier).color}>{tier}</span>
            {idx < TIER_ORDER.length - 1 && <span className="text-slate-600">→</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Empty State Overlay when no nodes exist */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-slate-950/95 z-30">
          <div className="w-16 h-16 rounded-2xl bg-cyan-950/50 border border-cyan-800/50 flex items-center justify-center mb-4 text-cyan-400">
            <Network className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-100 mb-1">No Cryptographic Relationships Discovered</h3>
          <p className="text-xs text-slate-400 max-w-md mb-6">
            Upload or scan a repository to automatically construct and inspect the live 6-tier cryptographic lineage from applications to algorithms.
          </p>
          <a
            href="/assets"
            className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-cyan-500/20"
          >
            Go to Asset Inventory &amp; Scans
          </a>
        </div>
      )}

      {/* Interactive SVG Canvas */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`w-full h-full select-none cursor-${isPanning ? 'grabbing' : 'grab'}`}
      >
        <svg
          width="100%"
          height="100%"
          className="w-full h-full"
        >
          <defs>
            {/* Edge arrow markers */}
            <marker
              id="edge-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#475569" />
            </marker>
            <marker
              id="edge-arrow-highlight"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#06b6d4" />
            </marker>
          </defs>

          {/* Transform group for Pan and Zoom */}
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Column Background Dividers */}
            {TIER_ORDER.map((tier, idx) => {
              const colX = 60 + idx * 280;
              return (
                <g key={`col-${tier}`}>
                  <rect
                    x={colX - 20}
                    y={20}
                    width={270}
                    height={canvasHeight - 40}
                    rx="16"
                    fill="rgba(15, 23, 42, 0.4)"
                    stroke="rgba(30, 41, 59, 0.6)"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={colX + 115}
                    y={50}
                    textAnchor="middle"
                    className="text-xs font-mono font-bold tracking-wider uppercase fill-slate-400"
                  >
                    {tier}
                  </text>
                </g>
              );
            })}

            {/* Render Directed Edges */}
            {edges.map((edge) => {
              const srcNode = nodeMap.get(edge.source);
              const tgtNode = nodeMap.get(edge.target);
              if (!srcNode || !tgtNode) return null;

              const isEdgeHighlighted =
                connectedIds && connectedIds.has(edge.source) && connectedIds.has(edge.target);
              const isDimmed = connectedIds && !isEdgeHighlighted;

              const startX = srcNode.x + srcNode.width;
              const startY = srcNode.y + srcNode.height / 2;
              const endX = tgtNode.x;
              const endY = tgtNode.y + tgtNode.height / 2;
              const dx = (endX - startX) * 0.5;

              const pathData = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;

              return (
                <g key={edge.id}>
                  <path
                    d={pathData}
                    fill="none"
                    stroke={isEdgeHighlighted ? '#06b6d4' : '#334155'}
                    strokeWidth={isEdgeHighlighted ? 3 : 1.5}
                    strokeOpacity={isDimmed ? 0.15 : isEdgeHighlighted ? 1 : 0.6}
                    markerEnd={isEdgeHighlighted ? 'url(#edge-arrow-highlight)' : 'url(#edge-arrow)'}
                    className="transition-all duration-200"
                  />
                </g>
              );
            })}

            {/* Render Positioned Nodes */}
            {positionedNodes.map((node) => {
              const tierMeta = getTierMeta(node.tier);
              const Icon = tierMeta.icon;
              const isSelected = selectedNodeId === node.id;
              const isHovered = hoveredNodeId === node.id;
              const isConnected = connectedIds ? connectedIds.has(node.id) : true;
              const isDimmed = connectedIds && !isConnected;

              return (
                <g
                  key={node.id}
                  data-testid={`graph-node-${node.id}`}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNodeId(node.id);
                  }}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  className="cursor-pointer"
                  opacity={isDimmed ? 0.25 : 1}
                >
                  {/* Outer Node Card */}
                  <rect
                    width={node.width}
                    height={node.height}
                    rx="14"
                    fill={isSelected ? '#09152e' : '#0a101f'}
                    stroke={
                      isSelected
                        ? '#06b6d4'
                        : isHovered
                        ? '#38bdf8'
                        : node.severity === 'Critical'
                        ? '#f43f5e'
                        : '#1e293b'
                    }
                    strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1}
                    className="transition-all duration-150"
                  />

                  {/* Icon Box */}
                  <rect
                    x="10"
                    y="10"
                    width="32"
                    height="32"
                    rx="8"
                    fill="#1e293b"
                    className="opacity-70"
                  />
                  <g transform="translate(16, 16)">
                    <Icon className={`w-5 h-5 ${tierMeta.color}`} />
                  </g>

                  {/* Sanitized Node Label (Never exposes raw keys or credentials) */}
                  <text
                    x="50"
                    y="25"
                    className="text-xs font-semibold fill-slate-100 font-sans"
                  >
                    {node.label}
                  </text>

                  {/* Node ID & Owner */}
                  <text
                    x="50"
                    y="39"
                    className="text-[10px] font-mono fill-slate-400"
                  >
                    {node.owner}
                  </text>

                  {/* Severity Badge & PQC Status Pill */}
                  <g transform="translate(10, 52)">
                    <rect
                      width="70"
                      height="18"
                      rx="4"
                      fill="#0f172a"
                      stroke="#334155"
                    />
                    <text
                      x="35"
                      y="13"
                      textAnchor="middle"
                      className={`text-[9px] font-bold uppercase font-mono ${
                        node.severity === 'Critical'
                          ? 'fill-rose-400'
                          : node.severity === 'High'
                          ? 'fill-amber-400'
                          : 'fill-slate-300'
                      }`}
                    >
                      {node.severity}
                    </text>
                  </g>

                  <g transform="translate(86, 52)">
                    <rect
                      width="80"
                      height="18"
                      rx="4"
                      fill="#0f172a"
                      stroke="#334155"
                    />
                    <text
                      x="40"
                      y="13"
                      textAnchor="middle"
                      className="text-[9px] font-medium fill-violet-300 font-mono"
                    >
                      {node.pqc_readiness}
                    </text>
                  </g>

                  {/* Evidence Items count badge */}
                  {node.evidence_items && node.evidence_items.length > 0 && (
                    <g transform={`translate(${node.width - 24}, 8)`}>
                      <circle r="8" fill="#0e7490" />
                      <text
                        textAnchor="middle"
                        dy="3"
                        className="text-[9px] font-bold fill-white font-mono"
                      >
                        {node.evidence_items.length}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Selected Node Details Drawer */}
      {selectedNode && (
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 p-6 overflow-y-auto shadow-2xl z-30 animate-in slide-in-from-right-4 duration-200">
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className="text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-semibold">
                {selectedNode.tier} Tier
              </span>
              <h3 className="text-lg font-bold text-slate-100 mt-1">
                {selectedNode.label}
              </h3>
              <span className="text-xs text-slate-500 font-mono">{selectedNode.id}</span>
            </div>
            <button
              onClick={() => setSelectedNodeId(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Node Metadata Strip */}
          <div className="space-y-2 py-3 border-y border-slate-800 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Severity:</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${getSeverityBadge(selectedNode.severity)}`}>
                {selectedNode.severity}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Owner:</span>
              <span className="text-slate-200 font-medium">{selectedNode.owner}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Environment:</span>
              <span className="text-slate-300 font-mono">{selectedNode.environment}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Exposure:</span>
              <span className="text-cyan-400 font-mono font-medium">{selectedNode.exposure}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">PQC Readiness:</span>
              <span className="text-violet-400 font-mono font-bold">{selectedNode.pqc_readiness}</span>
            </div>
            {selectedNode.algorithm && (
              <div className="flex justify-between">
                <span className="text-slate-400">Algorithm:</span>
                <span className="text-slate-200 font-mono">{selectedNode.algorithm}</span>
              </div>
            )}
          </div>

          {/* Linked Evidence Section */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Linked Cryptographic Evidence</span>
              </h4>
              <span className="text-xs font-mono text-cyan-400 font-bold">
                {(selectedNode.evidence_items || []).length} records
              </span>
            </div>

            {(selectedNode.evidence_items || []).length === 0 ? (
              <p className="text-xs text-slate-500 italic">No direct findings assigned to this entity.</p>
            ) : (
              <div className="space-y-2.5">
                {(selectedNode.evidence_items || []).map((evId) => {
                  const ev = evidenceLookup[evId];
                  return (
                    <div
                      key={evId}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-cyan-400 font-semibold">{evId}</span>
                        {ev && (
                          <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${getSeverityBadge(ev.severity)}`}>
                            {ev.severity}
                          </span>
                        )}
                      </div>
                      {ev?.location && (
                        <div className="text-[11px] font-mono text-slate-400 truncate">
                          {ev.location}:{ev.line_number}
                        </div>
                      )}
                      {ev?.evidence_context && (
                        <pre className="text-[10px] font-mono bg-slate-900 p-1.5 rounded mt-1.5 text-cyan-200 overflow-x-auto truncate">
                          <code>{ev.evidence_context}</code>
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Action to open full evidence drawer */}
            {(selectedNode.evidence_items || []).length > 0 && (
              <button
                onClick={() =>
                  onOpenEvidence(
                    `Graph Evidence: ${selectedNode.label}`,
                    `Showing ${(selectedNode.evidence_items || []).length} evidence items backing ${selectedNode.id}`,
                    selectedNode.evidence_items || []
                  )
                }
                className="w-full mt-4 py-2 px-3 rounded-xl bg-cyan-950/90 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/60 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <span>Inspect in Evidence Drawer</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
