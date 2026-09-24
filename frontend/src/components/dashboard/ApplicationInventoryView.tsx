import React, { useState, useMemo } from 'react';
import {
 AppWindow,
 Search,
 ExternalLink,
 Server,
 Database,
 Network,
 Users,
 Atom,
} from 'lucide-react';
import { ApplicationInventoryView as ApplicationInventoryData, EvidenceFinding } from '../../types';

interface Props {
 data: ApplicationInventoryData;
 evidenceLookup: Record<string, EvidenceFinding>;
 onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const ApplicationInventoryView: React.FC<Props> = ({
 data,
 evidenceLookup,
 onOpenEvidence,
}) => {
 const [search, setSearch] = useState('');

 const applications = useMemo(() => data?.applications || [], [data?.applications]);

 const filteredApps = useMemo(() => {
 return applications.filter((app) => {
 if (!search) return true;
 const q = search.toLowerCase();
 const name = (app.name || '').toLowerCase();
 const type = (app.type || app.asset_type || '').toLowerCase();
 const owner = (app.owner || '').toLowerCase();
 const sensitivity = (app.sensitivity || app.data_sensitivity || '').toLowerCase();
 return name.includes(q) || type.includes(q) || owner.includes(q) || sensitivity.includes(q);
 });
 }, [applications, search]);

 const getAppIcon = (type?: string) => {
 const t = (type || '').toLowerCase();
 if (t.includes('database')) return <Database className="w-4 h-4 text-success" />;
 if (t.includes('network') || t.includes('endpoint'))
 return <Network className="w-4 h-4 text-specialized" />;
 return <Server className="w-4 h-4 text-crypto" />;
 };

 return (
 <div className="space-y-5">
 {/* Header bar */}
 <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
 <div>
 <div className="flex items-center gap-2">
 <AppWindow className="w-5 h-5 text-crypto" />
 <h3 className="text-lg font-bold text-text-brand">Application Inventory & Cryptographic Exposure</h3>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 Map cryptographic assets to applications, data sensitivity classes, blast radii, and business owners.
 </p>
 </div>

 <div className="flex items-center gap-2">
 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface text-text-secondary border border-border-soft">
 {data?.total_applications ?? applications.length} Applications Tracked
 </span>
 </div>
 </div>

 {/* Search toolbar */}
 <div className="relative max-w-md">
 <Search className="w-4 h-4 absolute left-3 top-2.5 text-text-secondary" />
 <input
 type="text"
 placeholder="Filter applications by name, type, owner..."
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-bg-1/90 border border-border text-text-brand placeholder-slate-500 focus:outline-none focus:border-pqc"
 />
 </div>

 {/* Empty State */}
 {filteredApps.length === 0 ? (
 <div className="glass-card p-12 text-center text-text-secondary space-y-3">
 <AppWindow className="w-10 h-10 text-text-muted mx-auto" />
 <p className="text-sm font-semibold text-text-brand">
 {search ? 'No applications match your filter criteria' : 'No applications tracked for the active scan'}
 </p>
 <p className="text-xs text-text-muted max-w-md mx-auto">
 {search
 ? 'Try adjusting your search terms to locate specific applications.'
 : 'When you scan a repository or archive, discovered applications and their cryptographic blast radii will appear here.'}
 </p>
 </div>
 ) : (
 /* Grid of Applications */
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {filteredApps.map((app) => {
 const appType = app.type || app.asset_type || 'service';
 const appSeverity = app.severity || app.highest_severity || 'Low';
 const appSensitivity = app.sensitivity || app.data_sensitivity || 'Internal';
 const appCriticality = app.criticality || app.business_criticality || 'Tier 2';
 const appName = app.name || app.id;
 const appOwner = app.owner || 'Enterprise Security';

 const appEvidenceIds =
 app.evidence_items && app.evidence_items.length > 0
 ? app.evidence_items
 : Object.values(evidenceLookup)
 .filter((f) => f.asset_id === app.id)
 .map((f) => f.id);

 return (
 <div
 key={app.id}
 className="glass-card p-5 flex flex-col justify-between hover:border-border-soft/90 transition-all group min-w-0"
 >
 <div>
 {/* Header row */}
 <div className="flex items-start justify-between gap-2 mb-2">
 <div className="flex items-center gap-2 min-w-0">
 <div className="shrink-0">{getAppIcon(appType)}</div>
 <div className="min-w-0">
 <h4 className="font-semibold text-text-brand text-sm group-hover:text-crypto transition-colors truncate" title={appName}>
 {appName}
 </h4>
 <span className="text-[10px] font-mono text-text-muted block truncate" title={app.id}>{app.id}</span>
 </div>
 </div>

 <span
 onClick={() =>
 onOpenEvidence(
 `Evidence for ${appName} (${appSeverity})`,
 `Showing ${appEvidenceIds.length} findings linked to this application`,
 appEvidenceIds
 )
 }
 className={`px-2 py-0.5 rounded text-[11px] font-semibold border cursor-pointer hover:underline ${
 appSeverity === 'Critical'
 ? 'bg-surface-2 border-critical text-critical'
 : appSeverity === 'High'
 ? 'bg-surface-2 border-high text-high'
 : appSeverity === 'Medium'
 ? 'bg-surface-2 border-medium text-medium'
 : 'bg-surface-2 border-success text-success'
 }`}
 title="Click to view severity evidence"
 >
 {appSeverity}
 </span>
 </div>

 {/* Metadata tags */}
 <div className="flex flex-wrap gap-1.5 mb-3 text-[11px]">
 <span className="px-2 py-0.5 rounded bg-surface text-text-secondary font-mono">
 {appType}
 </span>
 <span className="px-2 py-0.5 rounded bg-surface text-crypto font-mono">
 {appSensitivity}
 </span>
 <span className="px-2 py-0.5 rounded bg-surface text-text-secondary">
 Priority: {appCriticality}
 </span>
 </div>

 {/* Blast Radius & Risk Horizons */}
 <div className="grid grid-cols-2 gap-2 py-2 mb-3 text-xs border-y border-border bg-background/40 rounded-lg px-2.5">
 <div>
 <span className="text-[10px] text-text-muted block uppercase font-mono">
 Blast Radius
 </span>
 <span className="text-text-brand font-semibold">
 {app.blast_radius ?? 0} Downstream
 </span>
 </div>
 <div>
 <span className="text-[10px] text-text-muted block uppercase font-mono">
 PQC Status
 </span>
 <span
 className={`font-semibold flex items-center gap-1 ${
 app.at_quantum_risk ? 'text-high' : 'text-success'
 }`}
 >
 <Atom className="w-3 h-3" />
 {app.at_quantum_risk ? 'At Threat Horizon' : 'Quantum Safe'}
 </span>
 </div>
 </div>

 <div className="flex items-center gap-1.5 text-xs text-text-secondary mb-3">
 <Users className="w-3.5 h-3.5 text-text-muted" />
 <span>Owner: {appOwner}</span>
 </div>
 </div>

 {/* Action row with clickable evidence button */}
 <div className="pt-3 border-t border-border flex items-center justify-between">
 <button
 onClick={() =>
 onOpenEvidence(
 `Evidence: ${appName}`,
 `All ${appEvidenceIds.length} findings linked to ${app.id}`,
 appEvidenceIds
 )
 }
 className="text-xs text-crypto hover:text-crypto font-semibold inline-flex items-center gap-1 transition-colors"
 >
 <span className="underline decoration-cyan-600/60">
 {appEvidenceIds.length} Crypto Findings
 </span>
 <ExternalLink className="w-3 h-3" />
 </button>

 <button
 onClick={() =>
 onOpenEvidence(
 `Evidence: ${appName}`,
 `All ${appEvidenceIds.length} findings linked to ${app.id}`,
 appEvidenceIds
 )
 }
 className="px-2.5 py-1 rounded bg-surface hover:bg-surface-2 text-text-brand text-xs font-medium border border-border-soft transition-colors"
 >
 Inspect Evidence
 </button>
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 );
};
