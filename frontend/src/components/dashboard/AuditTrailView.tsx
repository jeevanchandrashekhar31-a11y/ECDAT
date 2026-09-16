import React, { useState } from 'react';
import {
  History,
  CheckCircle2,
  XCircle,
  User,
  Search,
  Lock,
} from 'lucide-react';
import { AuditTrailView as AuditTrailData } from '../../types';

interface Props {
  data: AuditTrailData;
}

export const AuditTrailView: React.FC<Props> = ({
  data,
}) => {
  const [search, setSearch] = useState('');

  const filteredEvents = data.events.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.event_type.toLowerCase().includes(q) ||
      e.actor.toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      (e.table_name && e.table_name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-bold text-slate-100">Immutable Audit Trail & Compliance Events</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Cryptographically sealed audit records capturing CBOM ingestion, policy evaluations, and administrative interventions with automated secret scrubbing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
            <Lock className="w-3 h-3" />
            Tamper-Resistant Log Stream
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
            {data.total_events} Events Recorded
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
        <input
          type="text"
          placeholder="Filter audit events by actor, type, action..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-slate-900/90 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
        />
      </div>

      {/* Events Table / Timeline */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/70 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Event Type</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action & Resource</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Timestamp (UTC)</th>
                <th className="py-3 px-4">Sanitized Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredEvents.map((evt) => {
                const isSuccess = evt.status === 'SUCCESS';

                return (
                  <tr key={evt.id} className="hover:bg-slate-850/50 transition-colors">
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                        {evt.event_type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-200">
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{evt.actor}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      <span className="text-violet-400 font-bold">{evt.action}</span>
                      {evt.table_name && (
                        <span className="text-slate-400 ml-1.5">on {evt.table_name}</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          isSuccess
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {isSuccess ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {evt.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px]">
                      {new Date(evt.created_at).toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-3 px-4 text-[11px] text-slate-400">
                      {evt.details ? (
                        <span className="truncate max-w-xs block text-slate-400">
                          {JSON.stringify(evt.details)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
