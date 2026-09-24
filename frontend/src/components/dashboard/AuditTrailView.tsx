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
 <History className="w-5 h-5 text-crypto" />
 <h3 className="text-lg font-bold text-text-brand">Immutable Audit Trail & Compliance Events</h3>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 Cryptographically sealed audit records capturing CBOM ingestion, policy evaluations, and administrative interventions with automated secret scrubbing.
 </p>
 </div>

 <div className="flex items-center gap-2">
 <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-2 border border-success text-success">
 <Lock className="w-3 h-3" />
 Tamper-Resistant Log Stream
 </span>
 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface text-text-secondary border border-border-soft">
 {data.total_events} Events Recorded
 </span>
 </div>
 </div>

 {/* Search */}
 <div className="relative max-w-sm">
 <Search className="w-4 h-4 absolute left-3 top-2.5 text-text-secondary" />
 <input
 type="text"
 placeholder="Filter audit events by actor, type, action..."
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-bg-1/90 border border-border text-text-brand placeholder-slate-500 focus:outline-none focus:border-pqc"
 />
 </div>

 {/* Events Table / Timeline */}
 <div className="glass-card overflow-hidden">
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs text-text-secondary">
 <thead className="bg-background/70 text-text-secondary uppercase text-[10px] tracking-wider border-b border-border">
 <tr>
 <th className="py-3 px-4">Event Type</th>
 <th className="py-3 px-4">Actor</th>
 <th className="py-3 px-4">Action & Resource</th>
 <th className="py-3 px-4">Status</th>
 <th className="py-3 px-4">Timestamp (UTC)</th>
 <th className="py-3 px-4">Sanitized Details</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border font-mono">
 {filteredEvents.length === 0 ? (
 <tr>
 <td colSpan={6} className="py-8 text-center text-text-muted italic font-sans text-xs">
 No audit records recorded yet. Live cryptographic audit events will appear here as scans, policy updates, and administrative actions are logged.
 </td>
 </tr>
 ) : (
 filteredEvents.map((evt) => {
 const isSuccess = evt.status === 'SUCCESS';

 return (
 <tr key={evt.id} className="hover:bg-surface-2/50 transition-colors">
 <td className="py-3 px-4">
 <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-surface-2 text-crypto border border-pqc">
 {evt.event_type}
 </span>
 </td>
 <td className="py-3 px-4 text-text-brand">
 <div className="flex items-center gap-1">
 <User className="w-3 h-3 text-text-secondary" />
 <span>{evt.actor}</span>
 </div>
 </td>
 <td className="py-3 px-4 text-text-secondary">
 <span className="text-specialized font-bold">{evt.action}</span>
 {evt.table_name && (
 <span className="text-text-secondary ml-1.5">on {evt.table_name}</span>
 )}
 </td>
 <td className="py-3 px-4">
 <span
 className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
 isSuccess
 ? 'bg-surface-2 text-success border border-success'
 : 'bg-surface-2 text-critical border border-critical'
 }`}
 >
 {isSuccess ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
 {evt.status}
 </span>
 </td>
 <td className="py-3 px-4 text-text-secondary text-[11px]">
 {new Date(evt.created_at).toISOString().replace('T', ' ').slice(0, 19)}
 </td>
 <td className="py-3 px-4 text-[11px] text-text-secondary">
 {evt.details ? (
 <span className="truncate max-w-xs block text-text-secondary">
 {JSON.stringify(evt.details)}
 </span>
 ) : (
 '—'
 )}
 </td>
 </tr>
 );
 }))}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
};
