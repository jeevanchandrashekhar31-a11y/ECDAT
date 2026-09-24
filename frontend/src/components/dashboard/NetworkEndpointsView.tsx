import React from 'react';
import {
 Globe,
 Lock,
 Unlock,
 ExternalLink,
 Zap,
 Radio,
} from 'lucide-react';
import { NetworkEndpointsView as NetworkEndpointsData } from '../../types';

interface Props {
 data: NetworkEndpointsData;
 onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const NetworkEndpointsView: React.FC<Props> = ({
 data,
 onOpenEvidence,
}) => {
 return (
 <div className="space-y-6">
 {/* Header bar */}
 <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
 <div>
 <div className="flex items-center gap-2">
 <Globe className="w-5 h-5 text-crypto" />
 <h3 className="text-lg font-bold text-text-brand">Network Endpoint Cryptography & TLS Posture</h3>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 Active TLS ingress scans, negotiated cipher suites, Forward Secrecy (PFS), and Post-Quantum hybrid key exchange support.
 </p>
 </div>

 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface text-text-secondary border border-border-soft">
 {data.total_endpoints} Endpoints Monitored
 </span>
 </div>

 {/* Endpoints Grid */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {data.endpoints.map((ep) => {
 const isWeakTls = ep.tls_version.includes('1.0') || ep.tls_version.includes('1.1');
 const relatedEvidenceIds = [ep.evidence_finding_id].filter(Boolean);

 return (
 <div
 key={ep.id}
 className="glass-card p-5 flex flex-col justify-between hover:border-border-soft transition-all group min-w-0"
 >
 <div>
 {/* Header row */}
 <div className="flex items-start justify-between gap-2 mb-3">
 <div className="flex items-center gap-2 min-w-0">
 <div className="p-2 rounded-lg bg-surface text-crypto shrink-0">
 <Radio className="w-4 h-4" />
 </div>
 <div className="min-w-0">
 <h4 className="font-bold text-text-brand text-sm group-hover:text-crypto transition-colors truncate" title={`${ep.host}:${ep.port}`}>
 {ep.host}:{ep.port}
 </h4>
 <span className="text-[10px] font-mono text-text-muted block truncate" title={ep.protocol}>{ep.protocol}</span>
 </div>
 </div>

 <span
 className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
 isWeakTls
 ? 'bg-surface-2 border-critical text-critical'
 : 'bg-surface-2 border-success text-success'
 }`}
 >
 {ep.tls_version}
 </span>
 </div>

 {/* Cipher suite stats */}
 <div className="grid grid-cols-2 gap-2 my-3 p-2.5 rounded-lg bg-background/50 border border-border text-xs font-mono">
 <div>
 <span className="text-[10px] text-text-muted block uppercase">Cipher Suites</span>
 <span className="text-text-brand font-bold">{ep.cipher_suites_count} offered</span>
 </div>
 <div>
 <span className="text-[10px] text-text-muted block uppercase">Weak Ciphers</span>
 <button
 onClick={() => {
 if (ep.weak_ciphers_detected > 0) {
 onOpenEvidence(
 `Weak Ciphers: ${ep.host}`,
 `${ep.weak_ciphers_detected} insecure cipher suites negotiated on port ${ep.port}`,
 relatedEvidenceIds
 );
 }
 }}
 className={`font-bold ${
 ep.weak_ciphers_detected > 0
 ? 'text-critical underline cursor-pointer'
 : 'text-success cursor-default'
 }`}
 >
 {ep.weak_ciphers_detected} detected
 </button>
 </div>
 </div>

 {/* PFS & Hybrid PQC capability tags */}
 <div className="space-y-2 mb-3 text-xs">
 <div className="flex items-center justify-between">
 <span className="text-text-secondary">Forward Secrecy (PFS):</span>
 <span
 className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
 ep.pfs_supported
 ? 'bg-surface-2 text-success border border-success'
 : 'bg-surface-2 text-critical border border-critical'
 }`}
 >
 {ep.pfs_supported ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
 {ep.pfs_supported ? 'PFS Enforced' : 'No PFS'}
 </span>
 </div>

 <div className="flex items-center justify-between">
 <span className="text-text-secondary">Post-Quantum Hybrid:</span>
 <span
 className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
 ep.hybrid_supported
 ? 'bg-surface-2 text-specialized border border-specialized'
 : 'bg-surface text-text-secondary border border-border-soft'
 }`}
 >
 <Zap className="w-2.5 h-2.5" />
 {ep.hybrid_supported ? 'X25519Kyber768' : 'Classical Only'}
 </span>
 </div>
 </div>

 {ep.cert_fingerprint && (
 <div className="text-[10px] font-mono text-text-muted truncate mb-2">
 Cert: {ep.cert_fingerprint.slice(0, 24)}...
 </div>
 )}
 </div>

 {/* Action */}
 <div className="pt-3 border-t border-border flex items-center justify-between">
 <span className="text-[11px] text-text-secondary">
 {ep.weak_ciphers_detected > 0 ? 'Requires remediation' : 'Baseline compliant'}
 </span>

 <button
 onClick={() =>
 onOpenEvidence(
 `Network Endpoint Evidence: ${ep.host}`,
 `Network discovery findings for TLS endpoint ${ep.host}:${ep.port}`,
 relatedEvidenceIds
 )
 }
 className="px-2.5 py-1 rounded bg-surface hover:bg-surface-2 text-crypto hover:text-crypto text-xs font-medium border border-border-soft inline-flex items-center gap-1 transition-colors"
 >
 <span>Evidence</span>
 <ExternalLink className="w-3 h-3" />
 </button>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 );
};
