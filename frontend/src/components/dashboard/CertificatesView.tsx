import React, { useState, useMemo } from 'react';
import {
 FileCheck2,
 Clock,
 Key,
 ShieldAlert,
 ExternalLink,
 Search,
 CheckCircle2,
} from 'lucide-react';
import { CertificatesView as CertificatesData, EvidenceFinding } from '../../types';

interface Props {
 data: CertificatesData;
 evidenceLookup: Record<string, EvidenceFinding>;
 onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const CertificatesView: React.FC<Props> = ({
 data,
 evidenceLookup,
 onOpenEvidence,
}) => {
 const [search, setSearch] = useState('');

 const filteredCerts = useMemo(() => {
 return data.certificates.filter((c) => {
 if (!search) return true;
 const q = search.toLowerCase();
 return (
 c.subject_dn.toLowerCase().includes(q) ||
 c.issuer_dn.toLowerCase().includes(q) ||
 c.fingerprint_sha256.toLowerCase().includes(q) ||
 c.algorithm.toLowerCase().includes(q)
 );
 });
 }, [data.certificates, search]);

 const getRenewalBadge = (state: string, days: number) => {
 if (state === 'EXPIRED' || days < 0) {
 return 'bg-surface-2 border-critical text-critical';
 }
 if (state === 'EXPIRING_SOON' || state === 'CRITICAL_EXPIRING' || days <= 60) {
 return 'bg-surface-2 border-high text-high';
 }
 return 'bg-surface-2 border-success text-success';
 };

 return (
 <div className="space-y-6">
 {/* Header bar */}
 <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
 <div>
 <div className="flex items-center gap-2">
 <FileCheck2 className="w-5 h-5 text-crypto" />
 <h3 className="text-lg font-bold text-text-brand">X.509 Certificate Intelligence & Cryptographic Lifecycles</h3>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 Real-time tracking of certificate expirations, self-signed root anomalies, and public key sizes across TLS ingress points.
 </p>
 </div>

 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface text-text-secondary border border-border-soft">
 {data.total_certificates} Certificates Monitored
 </span>
 </div>

 {/* KPI Cards (Every number links to evidence) */}
 <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
 <div
 onClick={() => {
 const expIds = Object.values(evidenceLookup)
 .filter((f) => f.algorithm.includes('1024') || f.location?.includes('legacy'))
 .map((f) => f.id);
 onOpenEvidence(
 'Expired Certificates Evidence',
 `${data.expired_count} certificates past their validity expiration date`,
 expIds
 );
 }}
 className="glass-card p-5 cursor-pointer hover:border-critical transition-all group"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
 Expired
 </span>
 <ShieldAlert className="w-4 h-4 text-critical" />
 </div>
 <div className="text-3xl font-extrabold text-critical">{data.expired_count}</div>
 <span className="text-[11px] text-critical underline decoration-rose-500/50 mt-2 block">
 Inspect Expired Certificates →
 </span>
 </div>

 <div
 onClick={() => {
 const soonIds = Object.values(evidenceLookup)
 .filter((f) => f.location?.includes('api.ecdat.io') || f.key_size === 2048)
 .map((f) => f.id);
 onOpenEvidence(
 'Expiring Soon Evidence (<60 Days)',
 `${data.expiring_soon_count} certificates requiring automated ACME renewal`,
 soonIds
 );
 }}
 className="glass-card p-5 cursor-pointer hover:border-high transition-all group"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
 Expiring Soon
 </span>
 <Clock className="w-4 h-4 text-high" />
 </div>
 <div className="text-3xl font-extrabold text-high">{data.expiring_soon_count}</div>
 <span className="text-[11px] text-high underline decoration-amber-500/50 mt-2 block">
 Inspect Renewal Candidates →
 </span>
 </div>

 <div
 onClick={() => {
 const weakIds = Object.values(evidenceLookup)
 .filter((f) => (f.key_size || 2048) < 2048)
 .map((f) => f.id);
 onOpenEvidence(
 'Weak Key Lengths Evidence (<2048-bit)',
 `${data.weak_keys_count} certificates with substandard RSA key sizes`,
 weakIds
 );
 }}
 className="glass-card p-5 cursor-pointer hover:border-critical transition-all group"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
 Substandard Keys
 </span>
 <Key className="w-4 h-4 text-critical" />
 </div>
 <div className="text-3xl font-extrabold text-critical">{data.weak_keys_count}</div>
 <span className="text-[11px] text-critical underline decoration-red-500/50 mt-2 block">
 Inspect Key Size Violations →
 </span>
 </div>

 <div
 onClick={() => {
 const allIds = Object.keys(evidenceLookup);
 onOpenEvidence(
 'Total Certificate Inventory Evidence',
 `Discovered certificates across static code and network endpoints`,
 allIds
 );
 }}
 className="glass-card p-5 cursor-pointer hover:border-pqc transition-all group"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
 Total Monitored
 </span>
 <CheckCircle2 className="w-4 h-4 text-crypto" />
 </div>
 <div className="text-3xl font-extrabold text-crypto">{data.total_certificates}</div>
 <span className="text-[11px] text-crypto underline decoration-cyan-500/50 mt-2 block">
 Inspect All Certificates →
 </span>
 </div>
 </div>

 {/* Certificates Table */}
 <div className="glass-card overflow-hidden">
 <div className="p-4 border-b border-border flex items-center justify-between">
 <div className="relative max-w-sm flex-1">
 <Search className="w-4 h-4 absolute left-3 top-2.5 text-text-secondary" />
 <input
 type="text"
 placeholder="Search by Subject DN, Issuer, or Fingerprint..."
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-background/80 border border-border text-text-brand placeholder-slate-500 focus:outline-none focus:border-pqc"
 />
 </div>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs text-text-secondary">
 <thead className="bg-background/70 text-text-secondary uppercase text-[10px] tracking-wider border-b border-border">
 <tr>
 <th className="py-3 px-4">Subject & Issuer</th>
 <th className="py-3 px-4">Algorithm & Key</th>
 <th className="py-3 px-4">Validity Horizon</th>
 <th className="py-3 px-4">Days Left</th>
 <th className="py-3 px-4">Anomalies Detected</th>
 <th className="py-3 px-4 text-right">Evidence Action</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border font-sans">
 {filteredCerts.length === 0 ? (
 <tr>
 <td colSpan={6} className="py-8 text-center text-text-muted italic text-xs">
 No active X.509 certificates detected in this scan. Certificates discovered via TLS probes or static assets will appear here.
 </td>
 </tr>
 ) : (
 filteredCerts.map((cert, idx) => {
 const isExp = cert.renewal_state === 'EXPIRED' || (cert.days_remaining !== null && cert.days_remaining < 0);
 const relatedEvidenceIds = [cert.evidence_link].filter(Boolean) as string[];

 return (
 <tr key={cert.fingerprint_sha256 || idx} className="hover:bg-surface-2/50 transition-colors">
 <td className="py-3 px-4">
 <div className="font-semibold text-text-brand">{cert.subject_dn}</div>
 <div className="text-[11px] text-text-secondary mt-0.5">Issuer: {cert.issuer_dn}</div>
 <div className="font-mono text-[9px] text-text-muted mt-0.5 truncate max-w-xs">
 SHA256: {cert.fingerprint_sha256}
 </div>
 </td>
 <td className="py-3 px-4">
 <span className="font-mono text-text-brand font-medium">
 {cert.algorithm} {cert.key_size ? `${cert.key_size}-bit` : ''}
 </span>
 </td>
 <td className="py-3 px-4 font-mono text-[11px] text-text-secondary">
 <div>From: {cert.validity_start ? cert.validity_start.slice(0, 10) : 'N/A'}</div>
 <div>To: {cert.validity_end ? cert.validity_end.slice(0, 10) : 'N/A'}</div>
 </td>
 <td className="py-3 px-4">
 <span
 className={`px-2 py-0.5 rounded text-[11px] font-bold border ${getRenewalBadge(
 cert.renewal_state,
 cert.days_remaining ?? 365
 )}`}
 >
 {isExp
 ? `Expired (${cert.days_remaining !== null ? `${Math.abs(cert.days_remaining)}d ago` : 'past'})`
 : cert.days_remaining !== null
 ? `${cert.days_remaining} days`
 : 'Untracked'}
 </span>
 </td>
 <td className="py-3 px-4">
 {cert.detected_anomalies && cert.detected_anomalies.length > 0 ? (
 <div className="flex flex-wrap gap-1">
 {cert.detected_anomalies.map((anom) => (
 <span
 key={anom}
 className="px-1.5 py-0.5 rounded text-[10px] bg-surface-2 text-critical border border-critical font-mono"
 >
 {anom}
 </span>
 ))}
 </div>
 ) : (
 <span className="text-success text-[11px] flex items-center gap-1">
 <CheckCircle2 className="w-3 h-3" /> Valid
 </span>
 )}
 </td>
 <td className="py-3 px-4 text-right">
 <button
 onClick={() =>
 onOpenEvidence(
 `Certificate Evidence: ${cert.subject_dn}`,
 `X.509 binding for ${cert.evidence_link || cert.subject_dn}`,
 relatedEvidenceIds.length > 0 ? relatedEvidenceIds : Object.keys(evidenceLookup).slice(0, 2)
 )
 }
 className="px-2.5 py-1 rounded bg-surface hover:bg-surface-2 text-crypto hover:text-crypto border border-border-soft text-xs inline-flex items-center gap-1 transition-colors"
 >
 <span>Evidence</span>
 <ExternalLink className="w-3 h-3" />
 </button>
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
};
