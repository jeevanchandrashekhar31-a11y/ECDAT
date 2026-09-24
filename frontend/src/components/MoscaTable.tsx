import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, AlertTriangle, Clock, ShieldCheck, ExternalLink } from 'lucide-react';
import { MoscaTableRow, MoscaStatus } from '../types';

interface MoscaTableProps {
 rows: MoscaTableRow[];
 scanId?: string;
 limit?: number;
}

export const MoscaStatusBadge: React.FC<{ status: MoscaStatus }> = ({ status }) => {
 switch (status) {
 case 'CRITICAL_URGENT':
 return (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-critical/15 text-critical border border-critical">
 <ShieldAlert size={12} className="text-critical" />
 Critical Urgent
 </span>
 );
 case 'AT_RISK':
 return (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-high/15 text-high border border-high">
 <AlertTriangle size={12} className="text-high" />
 At Risk
 </span>
 );
 case 'WATCH':
 return (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-pqc/15 text-crypto border border-pqc/30">
 <Clock size={12} className="text-crypto" />
 Watch
 </span>
 );
 case 'SAFE':
 default:
 return (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-success/15 text-success border border-success">
 <ShieldCheck size={12} className="text-success" />
 Safe
 </span>
 );
 }
};

export const MoscaTable: React.FC<MoscaTableProps> = ({ rows, scanId, limit }) => {
 const displayRows = limit ? rows.slice(0, limit) : rows;

 if (displayRows.length === 0) {
 return (
 <div className="p-8 text-center text-text-secondary">
 <ShieldCheck size={36} className="mx-auto text-success/60 mb-2" />
 <p className="text-sm">No quantum threat calculations recorded for this dataset.</p>
 </div>
 );
 }

 return (
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs">
 <thead className="bg-bg-1/90 text-text-secondary uppercase tracking-wider text-[11px] border-b border-border">
 <tr>
 <th className="py-3 px-4">Asset / Target</th>
 <th className="py-3 px-3">Algorithm</th>
 <th className="py-3 px-2 text-center" title="Shelf-life requirement (years)">
 X (Shelf)
 </th>
 <th className="py-3 px-2 text-center" title="Migration transition duration (years)">
 Y (Migr)
 </th>
 <th className="py-3 px-2 text-center" title="Estimated quantum threat horizon (years)">
 Z (Threat)
 </th>
 <th className="py-3 px-3 text-center" title="X + Y total transition burden">
 X + Y
 </th>
 <th className="py-3 px-3 text-center" title="Quantum threat margin: (X + Y) - Z (>0 deficit, <=0 buffer)">
 Margin
 </th>
 <th className="py-3 px-3">Mosca Status</th>
 <th className="py-3 px-2 text-right">Action</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border text-text-brand font-mono">
 {displayRows.map((row, idx) => {
 const isDeficit = row.mosca_margin_years > 0;
 return (
 <tr key={`${row.asset_id}-${idx}`} className="hover:bg-surface transition-colors">
 <td
 className="py-3 px-4 font-sans font-medium text-text-brand max-w-[220px] truncate"
 title={row.asset_id}
 >
 {row.asset_id}
 </td>
 <td className="py-3 px-3">
 <span className="px-2 py-0.5 rounded bg-surface text-crypto text-xs">{row.algorithm}</span>
 </td>
 <td className="py-3 px-2 text-center text-text-secondary">{row.X_shelf_life_years}y</td>
 <td className="py-3 px-2 text-center text-text-secondary">{row.Y_migration_years}y</td>
 <td className="py-3 px-2 text-center text-text-secondary">{row.Z_quantum_threat_years}y</td>
 <td className="py-3 px-3 text-center font-bold text-text-brand">{row.mosca_sum_years}y</td>
 <td className={`py-3 px-3 text-center font-bold ${isDeficit ? 'text-critical' : 'text-success'}`}>
 {row.mosca_margin_years > 0 ? `+${row.mosca_margin_years}y` : `${row.mosca_margin_years}y`}
 </td>
 <td className="py-3 px-3 font-sans">
 <MoscaStatusBadge status={row.mosca_status} />
 </td>
 <td className="py-3 px-2 text-right font-sans">
 <Link
 to={`/assets/${encodeURIComponent(row.asset_id)}${scanId ? `?scanId=${scanId}` : ''}`}
 className="inline-flex items-center gap-1 text-crypto hover:text-crypto hover:underline text-xs"
 >
 <span>Inspect</span>
 <ExternalLink size={12} />
 </Link>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 );
};
