import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
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
 blastRadiusProjections?: Array<{id: string, status: string, margin?: number}> | null;
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

const getTierMeta = (tier: GraphTier) => {
 switch (tier) {
 case 'Application':
 return {
 color: 'text-crypto',
 bg: 'bg-surface-2',
 border: 'border-border-soft',
 icon: AppWindow,
 ring: 'ring-1 ring-border',
 };
 case 'Service':
 return {
 color: 'text-brand-light',
 bg: 'bg-surface-2',
 border: 'border-brand',
 icon: Server,
 ring: 'ring-1 ring-border',
 };
 case 'Certificate':
 return {
 color: 'text-high',
 bg: 'bg-surface-2',
 border: 'border-high',
 icon: FileCheck2,
 ring: 'ring-1 ring-border',
 };
 case 'Protocol':
 return {
 color: 'text-success',
 bg: 'bg-surface-2',
 border: 'border-success',
 icon: Globe,
 ring: 'ring-1 ring-border',
 };
 case 'Algorithm':
 return {
 color: 'text-specialized',
 bg: 'bg-surface-2',
 border: 'border-specialized',
 icon: Binary,
 ring: 'ring-1 ring-border',
 };
 case 'Data':
 return {
 color: 'text-critical',
 bg: 'bg-surface-2',
 border: 'border-critical',
 icon: Database,
 ring: 'ring-1 ring-border',
 };
 }
};

const getSeverityBadge = (sev: SeverityLevel) => {
 switch (sev) {
 case 'Critical':
 return 'text-critical border-critical bg-surface-2';
 case 'High':
 return 'text-high border-high bg-surface-2';
 case 'Medium':
 return 'text-medium border-border bg-surface-2';
 case 'Low':
 return 'text-info border-border bg-surface-2';
 default:
 return 'text-text-secondary border-border-soft bg-surface-2';
 }
};


const MemoizedEdge = React.memo(({ srcNode, tgtNode, isEdgeHighlighted, isDimmed }: any) => {
 if (!srcNode || !tgtNode) return null;
 const startX = srcNode.x + srcNode.width;
 const startY = srcNode.y + srcNode.height / 2;
 const endX = tgtNode.x;
 const endY = tgtNode.y + tgtNode.height / 2;
 const dx = (endX - startX) * 0.5;
 const pathData = `M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`;
 return (
 <g>
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
});

const MemoizedNode = React.memo(({ node, isSelected, isHovered, isDimmed, onSelect, onHoverStart, onHoverEnd, blastStatus }: any) => {
 const tierMeta = getTierMeta(node.tier);
 const Icon = tierMeta.icon;
 return (
 <g
 data-testid={`graph-node-${node.id}`}
 transform={`translate(${node.x}, ${node.y})`}
 onClick={(e) => {
 e.stopPropagation();
 onSelect(node.id);
 }}
 onMouseEnter={() => onHoverStart(node.id)}
 onMouseLeave={() => onHoverEnd()}
 className="cursor-pointer"
 opacity={isDimmed ? 0.25 : 1}
 >
 <rect
 width={node.width}
 height={node.height}
 rx="14"
 fill={isSelected ? '#09152e' : blastStatus === 'AFFECTED' ? '#4c0519' : blastStatus === 'SAFE' ? '#022c22' : '#0a101f'}
 stroke={
 isSelected
 ? '#06b6d4'
 : isHovered
 ? '#38bdf8'
 : blastStatus === 'AFFECTED'
 ? '#f43f5e'
 : blastStatus === 'SAFE'
 ? '#10b981'
 : node.severity === 'Critical'
 ? '#f43f5e'
 : '#1e293b'
 }
 strokeWidth={isSelected ? 2.5 : isHovered ? 2 : blastStatus === 'AFFECTED' ? 2 : 1}
 className={`transition-all duration-150 ${blastStatus === 'AFFECTED' ? 'animate-pulse' : ''}`}
 />
 <rect x="10" y="10" width="32" height="32" rx="8" fill="#1e293b" className="opacity-70" />
 <g transform="translate(16, 16)">
 <Icon className={`w-5 h-5 ${tierMeta.color}`} />
 </g>
 <text x="50" y="25" className="text-xs font-semibold fill-text-primary font-sans">
 {node.label.length > 24 ? node.label.substring(0, 24) + '...' : node.label}
 </text>
 <text x="50" y="39" className="text-[10px] font-mono fill-text-muted">
 {node.owner.length > 28 ? node.owner.substring(0, 28) + '...' : node.owner}
 </text>
 <g transform="translate(10, 52)">
 <rect width="70" height="18" rx="4" fill="#0f172a" stroke="#334155" />
 <text
 x="35"
 y="13"
 textAnchor="middle"
 className={`text-[9px] font-bold uppercase font-mono ${
 node.severity === 'Critical' ? 'fill-critical' : node.severity === 'High' ? 'fill-high' : 'fill-text-secondary'
 }`}
 >
 {node.severity}
 </text>
 </g>
 <g transform="translate(86, 52)">
 <rect width="80" height="18" rx="4" fill="#0f172a" stroke="#334155" />
 <text x="40" y="13" textAnchor="middle" className="text-[9px] font-medium fill-violet-300 font-mono">
 {node.pqc_readiness}
 </text>
 </g>
 {node.evidence_items && node.evidence_items.length > 0 && (
 <g transform={`translate(${node.width - 24}, 8)`}>
 <circle r="8" fill="#0e7490" />
 <text textAnchor="middle" dy="3" className="text-[9px] font-bold fill-white font-mono">
 {node.evidence_items.length}
 </text>
 </g>
 )}
 </g>
 );
});

export const CryptoGraphCanvas: React.FC<CryptoGraphCanvasProps> = ({
 nodes,
 edges,
 evidenceLookup,
 blastRadiusProjections,
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

 // DOM Refs for high-performance direct manipulation (bypassing React re-renders)
 const transformGroupRef = useRef<SVGGElement>(null);
 const panRef = useRef(pan);
 const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);

 // Keep panRef synced with any external pan state changes (like resetView)
 useEffect(() => {
 panRef.current = pan;
 if (transformGroupRef.current) {
 transformGroupRef.current.setAttribute('transform', `translate(${pan.x}, ${pan.y}) scale(${zoom})`);
 }
 }, [pan, zoom]);

 // Tier Colors & Icons


 // Group nodes by tier and compute positions

 const handleSelect = useCallback((id: string) => setSelectedNodeId(id), []);
 const handleHoverStart = useCallback((id: string) => setHoveredNodeId(id), []);
 const handleHoverEnd = useCallback(() => setHoveredNodeId(null), []);

 const { positionedNodes, nodeMap, canvasHeight, tierBounds, totalGraphWidth } = useMemo(() => {
 const nodeWidth = 230;
 const nodeHeight = 84;
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

 let currentX = startX;
 const maxNodesPerSubColumn = 12; // Wrap after 12 nodes vertically
 const subColSpacing = 30; // Gap between sub-columns within the same tier
 const tierSpacing = 160; // Gap between different tiers
 const bounds: Record<string, { x: number; width: number }> = {};

 TIER_ORDER.forEach((tier) => {
 const group = tierGroups[tier];
 const numSubColumns = Math.max(1, Math.ceil(group.length / maxNodesPerSubColumn));
 
 const rowsInThisTier = Math.min(group.length, maxNodesPerSubColumn);
 if (rowsInThisTier > maxRows) maxRows = rowsInThisTier;

 const tierStartX = currentX;

 group.forEach((node, index) => {
 const subCol = Math.floor(index / maxNodesPerSubColumn);
 const row = index % maxNodesPerSubColumn;
 
 const x = currentX + subCol * (nodeWidth + subColSpacing);
 const y = startY + row * rowSpacing;
 
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

 // Advance X to the end of this tier, then add tierSpacing
 const thisTierWidth = numSubColumns * nodeWidth + (numSubColumns > 1 ? (numSubColumns - 1) * subColSpacing : 0);
 bounds[tier] = { x: tierStartX, width: thisTierWidth };
 currentX += thisTierWidth + tierSpacing;
 });

 const cHeight = Math.max(700, startY + maxRows * rowSpacing + 120);

 return {
 positionedNodes: posList,
 nodeMap: map,
 canvasHeight: cHeight,
 tierBounds: bounds,
 totalGraphWidth: currentX,
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
 setZoom((prev) => Math.min(2.2, Math.max(0.02, prev * zoomFactor)));
 } else {
 // Pan with normal Scroll
 const newX = panRef.current.x - e.deltaX;
 const newY = panRef.current.y - e.deltaY;
 panRef.current = { x: newX, y: newY };
 
 if (transformGroupRef.current) {
 transformGroupRef.current.setAttribute('transform', `translate(${newX}, ${newY}) scale(${zoom})`);
 }

 if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
 wheelTimeoutRef.current = setTimeout(() => {
 setPan(panRef.current);
 }, 150);
 }
 };

 // Pan interaction
 const handleMouseDown = (e: React.MouseEvent) => {
 if (e.button === 0) {
 setIsPanning(true);
 setDragStart({ x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y });
 }
 };

 const handleMouseMove = (e: React.MouseEvent) => {
 if (isPanning) {
 const newX = e.clientX - dragStart.x;
 const newY = e.clientY - dragStart.y;
 panRef.current = { x: newX, y: newY };
 
 if (transformGroupRef.current) {
 transformGroupRef.current.setAttribute('transform', `translate(${newX}, ${newY}) scale(${zoom})`);
 }
 }
 };

 const handleMouseUp = () => {
 if (isPanning) {
 setIsPanning(false);
 setPan(panRef.current); // Sync state on drop
 }
 };

 const resetView = useCallback(() => {
 if (containerRef.current) {
 const { width, height } = containerRef.current.getBoundingClientRect();
 const graphWidth = totalGraphWidth || (TIER_ORDER.length * 280 + 100);
 const graphHeight = canvasHeight;
 const scaleX = width / graphWidth;
 const scaleY = height / graphHeight;
 const newZoom = Math.min(scaleX, scaleY, 1) * 0.95;
 
 setZoom(Math.max(0.02, newZoom));
 setPan({ 
 x: (width - graphWidth * newZoom) / 2, 
 y: Math.max(20, (height - graphHeight * newZoom) / 2) 
 });
 setSelectedNodeId(null);
 } else {
 setZoom(0.85);
 setPan({ x: 30, y: 30 });
 setSelectedNodeId(null);
 }
 }, [canvasHeight]);

 useEffect(() => {
 // Automatically fit to screen when nodes load or change
 if (nodes.length > 0) {
 resetView();
 }
 }, [nodes.length, resetView]);

 // Selected node entity
 const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;

 return (
 <div className="relative w-full h-[720px] rounded-2xl bg-background border border-border overflow-hidden shadow-md flex flex-col">
 {/* Canvas Controls Header */}
 <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-bg-1/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-border text-xs">
 <span className="text-text-secondary font-mono">Zoom: {Math.round(zoom * 100)}%</span>
 <div className="h-3 w-px bg-surface-2" />
 <button
 onClick={() => setZoom((z) => Math.min(2.2, z * 1.15))}
 className="p-1 rounded text-text-secondary hover:text-text-brand hover:bg-surface transition-colors"
 title="Zoom In"
 >
 <ZoomIn className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={() => setZoom((z) => Math.max(0.02, z * 0.85))}
 className="p-1 rounded text-text-secondary hover:text-text-brand hover:bg-surface transition-colors"
 title="Zoom Out"
 >
 <ZoomOut className="w-3.5 h-3.5" />
 </button>
 <button
 onClick={resetView}
 className="p-1 rounded text-text-secondary hover:text-text-brand hover:bg-surface transition-colors"
 title="Fit to Screen"
 >
 <Maximize2 className="w-3.5 h-3.5" />
 </button>
 </div>

 {/* Tier Column Headers Floating Strip */}
 <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-bg-1/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-border text-[11px] font-mono">
 <span className="text-text-muted mr-1">Pipeline Tiers:</span>
 {TIER_ORDER.map((tier, idx) => (
 <React.Fragment key={tier}>
 <span className={getTierMeta(tier).color}>{tier}</span>
 {idx < TIER_ORDER.length - 1 && <span className="text-text-muted">→</span>}
 </React.Fragment>
 ))}
 </div>

 {/* Empty State Overlay when no nodes exist */}
 {nodes.length === 0 && (
 <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-background/95 z-30">
 <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border-soft flex items-center justify-center mb-4 text-crypto">
 <Network className="w-8 h-8" />
 </div>
 <h3 className="text-lg font-bold text-text-brand mb-1">No Cryptographic Relationships Discovered</h3>
 <p className="text-xs text-text-secondary max-w-md mb-6">
 Upload or scan a repository to automatically construct and inspect the live 6-tier cryptographic lineage from applications to algorithms.
 </p>
 <a
 href="/assets"
 className="px-4 py-2 rounded-xl bg-pqc hover:bg-crypto text-text-muted font-bold text-xs transition-colors "
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
 <g ref={transformGroupRef} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
 {/* Column Background Dividers */}
 {TIER_ORDER.map((tier) => {
 const bounds = tierBounds[tier];
 if (!bounds) return null;
 
 return (
 <g key={`col-${tier}`}>
 <rect
 x={bounds.x - 20}
 y={20}
 width={bounds.width + 40}
 height={canvasHeight - 40}
 rx="16"
 fill="rgba(15, 23, 42, 0.4)"
 stroke="rgba(30, 41, 59, 0.6)"
 strokeDasharray="4 4"
 />
 <text
 x={bounds.x + bounds.width / 2}
 y={50}
 textAnchor="middle"
 className="text-xs font-mono font-bold tracking-wider uppercase fill-text-muted"
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
 const isEdgeHighlighted = connectedIds && connectedIds.has(edge.source) && connectedIds.has(edge.target);
 const isDimmed = connectedIds && !isEdgeHighlighted;
 return <MemoizedEdge key={edge.id} edge={edge} srcNode={srcNode} tgtNode={tgtNode} isEdgeHighlighted={isEdgeHighlighted} isDimmed={isDimmed} />;
 })}

 {/* Render Positioned Nodes */}
 {positionedNodes.map((node) => {
 const isSelected = selectedNodeId === node.id;
 const isHovered = hoveredNodeId === node.id;
 const isConnected = connectedIds ? connectedIds.has(node.id) : true;
 const isDimmed = connectedIds && !isConnected;

 let blastStatus = null;
 if (blastRadiusProjections) {
 const p = blastRadiusProjections.find(proj => proj.id === node.id);
 if (p) blastStatus = p.status;
 }

 return (
 <MemoizedNode 
 key={node.id} 
 node={node} 
 isSelected={isSelected} 
 isHovered={isHovered} 
 isDimmed={isDimmed} 
 blastStatus={blastStatus}
 onSelect={handleSelect} 
 onHoverStart={handleHoverStart} 
 onHoverEnd={handleHoverEnd} 
 />
 );
 })}
 </g>
 </svg>
 </div>

 {/* Selected Node Details Drawer */}
 {selectedNode && (
 <div className="absolute right-0 top-0 bottom-0 w-96 bg-bg-1/95 backdrop-blur-xl border-l border-border p-6 overflow-y-auto shadow-md z-30 animate-in slide-in-from-right-4 duration-200">
 <div className="flex items-start justify-between mb-4">
 <div>
 <span className="text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded bg-surface text-crypto font-semibold">
 {selectedNode.tier} Tier
 </span>
 <h3 className="text-lg font-bold text-text-brand mt-1">
 {selectedNode.label}
 </h3>
 <span className="text-xs text-text-muted font-mono">{selectedNode.id}</span>
 </div>
 <button
 onClick={() => setSelectedNodeId(null)}
 className="p-1 rounded-lg text-text-secondary hover:text-text-brand hover:bg-surface transition-colors"
 >
 <X className="w-5 h-5" />
 </button>
 </div>

 {/* Node Metadata Strip */}
 <div className="space-y-2 py-3 border-y border-border text-xs">
 <div className="flex justify-between">
 <span className="text-text-secondary">Severity:</span>
 <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${getSeverityBadge(selectedNode.severity)}`}>
 {selectedNode.severity}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-text-secondary">Owner:</span>
 <span className="text-text-brand font-medium">{selectedNode.owner}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-text-secondary">Environment:</span>
 <span className="text-text-secondary font-mono">{selectedNode.environment}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-text-secondary">Exposure:</span>
 <span className="text-crypto font-mono font-medium">{selectedNode.exposure}</span>
 </div>
 <div className="flex justify-between">
 <span className="text-text-secondary">PQC Readiness:</span>
 <span className="text-specialized font-mono font-bold">{selectedNode.pqc_readiness}</span>
 </div>
 {selectedNode.algorithm && (
 <div className="flex justify-between">
 <span className="text-text-secondary">Algorithm:</span>
 <span className="text-text-brand font-mono">{selectedNode.algorithm}</span>
 </div>
 )}
 </div>

 {/* Linked Evidence Section */}
 <div className="mt-5">
 <div className="flex items-center justify-between mb-3">
 <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
 <Lock className="w-3.5 h-3.5 text-crypto" />
 <span>Linked Cryptographic Evidence</span>
 </h4>
 <span className="text-xs font-mono text-crypto font-bold">
 {(selectedNode.evidence_items || []).length} records
 </span>
 </div>

 {(selectedNode.evidence_items || []).length === 0 ? (
 <p className="text-xs text-text-muted italic">No direct findings assigned to this entity.</p>
 ) : (
 <div className="space-y-2.5">
 {(selectedNode.evidence_items || []).map((evId) => {
 const ev = evidenceLookup[evId];
 return (
 <div
 key={evId}
 className="p-3 rounded-xl bg-background/80 border border-border text-xs hover:border-border-soft transition-colors"
 >
 <div className="flex items-center justify-between mb-1">
 <span className="font-mono text-crypto font-semibold">{evId}</span>
 {ev && (
 <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${getSeverityBadge(ev.severity)}`}>
 {ev.severity}
 </span>
 )}
 </div>
 {ev?.location && (
 <div className="text-[11px] font-mono text-text-secondary truncate">
 {ev.location}:{ev.line_number}
 </div>
 )}
 {ev?.evidence_context && (
 <pre className="text-[10px] font-mono bg-bg-1 p-1.5 rounded mt-1.5 text-crypto overflow-x-auto truncate">
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
 className="w-full mt-4 py-2 px-3 rounded-xl bg-surface-2 hover:bg-surface-2 text-crypto border border-border-soft font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
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
