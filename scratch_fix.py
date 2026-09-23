import re

file_path = 'frontend/src/components/graph/CryptoGraphCanvas.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Move getTierMeta and getSeverityBadge outside the component
def extract_and_move(pattern, code):
    match = re.search(pattern, code, re.DOTALL)
    if match:
        func = match.group(0)
        code = code.replace(func, '')
        return func, code
    return '', code

tier_meta_pattern = r'  const getTierMeta = \(tier: GraphTier\) => \{.*?\n  \};\n'
sev_badge_pattern = r'  const getSeverityBadge = \(sev: SeverityLevel\) => \{.*?\n  \};\n'

tier_func, code = extract_and_move(tier_meta_pattern, code)
sev_func, code = extract_and_move(sev_badge_pattern, code)

# Clean up indentation for the extracted functions
tier_func = '\n'.join([line[2:] if line.startswith('  ') else line for line in tier_func.split('\n')])
sev_func = '\n'.join([line[2:] if line.startswith('  ') else line for line in sev_func.split('\n')])

# Add MemoizedEdge and MemoizedNode before the main component
memo_components = """
const MemoizedEdge = React.memo(({ edge, srcNode, tgtNode, isEdgeHighlighted, isDimmed }: any) => {
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

const MemoizedNode = React.memo(({ node, isSelected, isHovered, isDimmed, onSelect, onHoverStart, onHoverEnd }: any) => {
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
      <rect x="10" y="10" width="32" height="32" rx="8" fill="#1e293b" className="opacity-70" />
      <g transform="translate(16, 16)">
        <Icon className={`w-5 h-5 ${tierMeta.color}`} />
      </g>
      <text x="50" y="25" className="text-xs font-semibold fill-slate-100 font-sans">
        {node.label.length > 24 ? node.label.substring(0, 24) + '...' : node.label}
      </text>
      <text x="50" y="39" className="text-[10px] font-mono fill-slate-400">
        {node.owner.length > 28 ? node.owner.substring(0, 28) + '...' : node.owner}
      </text>
      <g transform="translate(10, 52)">
        <rect width="70" height="18" rx="4" fill="#0f172a" stroke="#334155" />
        <text
          x="35"
          y="13"
          textAnchor="middle"
          className={`text-[9px] font-bold uppercase font-mono ${
            node.severity === 'Critical' ? 'fill-rose-400' : node.severity === 'High' ? 'fill-amber-400' : 'fill-slate-300'
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
"""

insert_idx = code.find('export const CryptoGraphCanvas')
code = code[:insert_idx] + tier_func + '\n' + sev_func + '\n' + memo_components + '\n' + code[insert_idx:]

# 2. Add useCallback hooks in the component
hook_str = """
  const handleSelect = useCallback((id: string) => setSelectedNodeId(id), []);
  const handleHoverStart = useCallback((id: string) => setHoveredNodeId(id), []);
  const handleHoverEnd = useCallback(() => setHoveredNodeId(null), []);
"""
insert_hook_idx = code.find('  const { positionedNodes, nodeMap, canvasHeight } = useMemo(() => {')
code = code[:insert_hook_idx] + hook_str + '\n' + code[insert_hook_idx:]

# 3. Replace Edge map
old_edge_render = r'\{edges\.map\(\(edge\) => \{.*?const pathData = .*?return \(\s*<g key=\{edge\.id\}>\s*<path.*?\/>\s*<\/g>\s*\);\s*\}\)\}'
new_edge_render = """{edges.map((edge) => {
              const srcNode = nodeMap.get(edge.source);
              const tgtNode = nodeMap.get(edge.target);
              if (!srcNode || !tgtNode) return null;
              const isEdgeHighlighted = connectedIds && connectedIds.has(edge.source) && connectedIds.has(edge.target);
              const isDimmed = connectedIds && !isEdgeHighlighted;
              return <MemoizedEdge key={edge.id} edge={edge} srcNode={srcNode} tgtNode={tgtNode} isEdgeHighlighted={isEdgeHighlighted} isDimmed={isDimmed} />;
            })}"""
code = re.sub(old_edge_render, new_edge_render, code, flags=re.DOTALL)

# 4. Replace Node map
old_node_render = r'\{positionedNodes\.map\(\(node\) => \{.*?return \(\s*<g.*?key=\{node\.id\}.*?data-testid={`graph-node-\$\{node\.id\}`}.*?<\/g>\s*\);\s*\}\)\}'
new_node_render = """{positionedNodes.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const isHovered = hoveredNodeId === node.id;
              const isConnected = connectedIds ? connectedIds.has(node.id) : true;
              const isDimmed = connectedIds && !isConnected;

              return (
                <MemoizedNode 
                  key={node.id} 
                  node={node} 
                  isSelected={isSelected} 
                  isHovered={isHovered} 
                  isDimmed={isDimmed} 
                  onSelect={handleSelect} 
                  onHoverStart={handleHoverStart} 
                  onHoverEnd={handleHoverEnd} 
                />
              );
            })}"""
code = re.sub(old_node_render, new_node_render, code, flags=re.DOTALL)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(code)
print('Refactoring complete')
