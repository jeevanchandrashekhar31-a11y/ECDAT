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
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
          <ShieldAlert size={12} className="text-rose-400" />
          Critical Urgent
        </span>
      );
    case 'AT_RISK':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
          <AlertTriangle size={12} className="text-amber-400" />
          At Risk
        </span>
      );
    case 'WATCH':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
          <Clock size={12} className="text-cyan-400" />
          Watch
        </span>
      );
    case 'SAFE':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <ShieldCheck size={12} className="text-emerald-400" />
          Safe
        </span>
      );
  }
};

export const MoscaTable: React.FC<MoscaTableProps> = ({ rows, scanId, limit }) => {
  const displayRows = limit ? rows.slice(0, limit) : rows;

  if (displayRows.length === 0) {
    return (
      <div className="p-8 text-center text-slate-400">
        <ShieldCheck size={36} className="mx-auto text-emerald-400/60 mb-2" />
        <p className="text-sm">No quantum threat calculations recorded for this dataset.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
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
            <th className="py-3 px-3 text-center" title="Quantum security margin: Z - (X + Y)">
              Margin
            </th>
            <th className="py-3 px-3">Mosca Status</th>
            <th className="py-3 px-2 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 text-slate-200 font-mono">
          {displayRows.map((row, idx) => {
            const isNegative = row.mosca_margin_years < 0;
            return (
              <tr key={`${row.asset_id}-${idx}`} className="hover:bg-slate-800/40 transition-colors">
                <td
                  className="py-3 px-4 font-sans font-medium text-slate-100 max-w-[220px] truncate"
                  title={row.asset_id}
                >
                  {row.asset_id}
                </td>
                <td className="py-3 px-3">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 text-xs">{row.algorithm}</span>
                </td>
                <td className="py-3 px-2 text-center text-slate-300">{row.X_shelf_life_years}y</td>
                <td className="py-3 px-2 text-center text-slate-300">{row.Y_migration_years}y</td>
                <td className="py-3 px-2 text-center text-slate-300">{row.Z_quantum_threat_years}y</td>
                <td className="py-3 px-3 text-center font-bold text-slate-100">{row.mosca_sum_years}y</td>
                <td className={`py-3 px-3 text-center font-bold ${isNegative ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {row.mosca_margin_years > 0 ? `+${row.mosca_margin_years}y` : `${row.mosca_margin_years}y`}
                </td>
                <td className="py-3 px-3 font-sans">
                  <MoscaStatusBadge status={row.mosca_status} />
                </td>
                <td className="py-3 px-2 text-right font-sans">
                  <Link
                    to={`/assets/${encodeURIComponent(row.asset_id)}${scanId ? `?scanId=${scanId}` : ''}`}
                    className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline text-xs"
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
