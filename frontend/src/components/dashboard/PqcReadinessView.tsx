import React from 'react';
import {
 Atom,
 ExternalLink,
} from 'lucide-react';
import { PqcReadinessView as PqcReadinessData } from '../../types';

interface Props {
 data: PqcReadinessData;
 onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const PqcReadinessView: React.FC<Props> = ({
 data,
 onOpenEvidence,
}) => {
 const timeline = data.timeline || data.mosca_timeline || [];

 return (
 <div className="space-y-6">
 {/* Top Banner: PQC Score & NIST Standards Alignment */}
 <div className="glass-card p-6 relative overflow-hidden">
 <div className="absolute right-0 top-0 w-80 h-80 bg-specialized rounded-full blur-3xl pointer-events-none" />
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <div className="flex items-center gap-2 mb-1.5">
 <Atom className="w-5 h-5 text-specialized" />
 <span className="text-xs uppercase font-mono tracking-wider font-semibold text-specialized">
 Post-Quantum Cryptography (PQC) Readiness
 </span>
 </div>
 <h3 className="text-2xl font-bold text-text-brand">
 NIST FIPS 203 / 204 / 205 Migration Horizon
 </h3>
 <p className="text-xs text-text-secondary mt-1 max-w-xl">
 Evaluation under Mosca's Theorem (X + Y &gt; Z). Identification of Shor-vulnerable public key algorithms,
 Grover-impacted symmetric keys, and hybrid PQC transition candidates.
 </p>
 </div>

 <div className="flex items-center gap-4">
 <div className="text-right">
 <span className="text-xs text-text-secondary font-mono block">Overall PQC Readiness</span>
 <span className="text-4xl font-extrabold text-specialized">
 {data.overall_readiness_score}%
 </span>
 </div>
 </div>
 </div>

 {/* NIST Standards Alignment Pills */}
 <div className="mt-6 pt-5 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-3">
 {data.nist_standards_alignment.map((std) => (
 <div
 key={std.standard}
 className="p-3 rounded-xl bg-background/60 border border-border flex items-center justify-between"
 >
 <div>
 <span className="text-xs font-bold text-text-brand block">{std.standard}</span>
 <span className="text-[11px] text-specialized font-mono">{std.target}</span>
 </div>
 <span
 className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
 std.status === 'ADOPTING'
 ? 'bg-surface-2 text-success border border-success'
 : std.status === 'PLANNED'
 ? 'bg-surface-2 text-crypto border border-pqc'
 : 'bg-surface text-text-secondary border border-border-soft'
 }`}
 >
 {std.status}
 </span>
 </div>
 ))}
 </div>
 </div>

 {/* 3 Quantum Risk Sectors (Every number links to evidence) */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 {/* Shor Vulnerable */}
 <div
 onClick={() =>
 onOpenEvidence(
 "Shor's Algorithm Vulnerability Evidence",
 `${data.shor_vulnerable_count} asymmetric algorithms vulnerable to polynomial-time quantum break`,
 data.shor_evidence
 )
 }
 className="glass-card p-5 cursor-pointer hover:border-critical hover:shadow-rose-950/20 hover:shadow-xl transition-all group"
 title="Click to inspect all Shor-vulnerable findings"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-critical uppercase tracking-wider font-mono">
 Shor Algorithm (Catastrophic)
 </span>
 <ExternalLink className="w-3.5 h-3.5 text-text-muted group-hover:text-critical transition-colors" />
 </div>
 <div className="text-3xl font-extrabold text-critical">{data.shor_vulnerable_count}</div>
 <p className="text-xs text-text-secondary mt-1">
 RSA, ECC, ECDSA, DH algorithms requiring ML-KEM or ML-DSA replacement.
 </p>
 <span className="text-[11px] text-critical underline decoration-rose-500/50 mt-3 inline-block font-semibold">
 Inspect {data.shor_vulnerable_count} Evidence Items →
 </span>
 </div>

 {/* Grover Vulnerable */}
 <div
 onClick={() =>
 onOpenEvidence(
 "Grover's Algorithm Impact Evidence",
 `${data.grover_vulnerable_count} symmetric ciphers with degraded quantum security (<256-bit)`,
 data.grover_evidence
 )
 }
 className="glass-card p-5 cursor-pointer hover:border-high hover: hover:shadow-xl transition-all group"
 title="Click to inspect Grover-impacted findings"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-high uppercase tracking-wider font-mono">
 Grover Algorithm (Quadratic)
 </span>
 <ExternalLink className="w-3.5 h-3.5 text-text-muted group-hover:text-high transition-colors" />
 </div>
 <div className="text-3xl font-extrabold text-high">{data.grover_vulnerable_count}</div>
 <p className="text-xs text-text-secondary mt-1">
 AES-128, 3DES, SHA-1 with effective quantum key strength halved.
 </p>
 <span className="text-[11px] text-high underline decoration-amber-500/50 mt-3 inline-block font-semibold">
 Inspect {data.grover_vulnerable_count} Evidence Items →
 </span>
 </div>

 {/* PQC Safe / Hybrid Ready */}
 <div
 onClick={() =>
 onOpenEvidence(
 'PQC-Safe & Hybrid Transitions Evidence',
 `${data.pqc_safe_count} assets resilient against quantum cryptanalysis or running hybrid schemes`,
 data.pqc_evidence
 )
 }
 className="glass-card p-5 cursor-pointer hover:border-success hover: hover:shadow-xl transition-all group"
 title="Click to inspect PQC-safe findings"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-success uppercase tracking-wider font-mono">
 Quantum-Safe / Hybrid
 </span>
 <ExternalLink className="w-3.5 h-3.5 text-text-muted group-hover:text-success transition-colors" />
 </div>
 <div className="text-3xl font-extrabold text-success">{data.pqc_safe_count}</div>
 <p className="text-xs text-text-secondary mt-1">
 AES-256, SHA-384, Kyber-768 hybrid key exchanges deployed in production.
 </p>
 <span className="text-[11px] text-success underline decoration-emerald-500/50 mt-3 inline-block font-semibold">
 Inspect {data.pqc_safe_count} Evidence Items →
 </span>
 </div>
 </div>

 {/* Mosca Timeline Table */}
 <div className="glass-card overflow-hidden">
 <div className="p-5 border-b border-border flex items-center justify-between">
 <div>
 <h4 className="text-sm font-semibold text-text-brand">
 Mosca's Theorem Timeline (X + Y &gt; Z Deficit Analysis)
 </h4>
 <p className="text-xs text-text-secondary">
 X = Data Shelf-life, Y = Migration Time, Z = Time Until Cryptanalytically Relevant Quantum Computer (CRQC).
 </p>
 </div>
 <span className="text-xs font-mono text-text-secondary">
 {timeline.length} Analyzed Horizons
 </span>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs text-text-secondary">
 <thead className="bg-background/70 text-text-secondary uppercase text-[10px] tracking-wider border-b border-border">
 <tr>
 <th className="py-3 px-4">Finding ID / Asset</th>
 <th className="py-3 px-4">Algorithm</th>
 <th className="py-3 px-4">Shelf-Life (X)</th>
 <th className="py-3 px-4">Migration (Y)</th>
 <th className="py-3 px-4">Threat (Z)</th>
 <th className="py-3 px-4">Mosca Margin (Z - X - Y)</th>
 <th className="py-3 px-4">Status</th>
 <th className="py-3 px-4 text-right">Evidence Link</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {timeline.map((row, idx) => {
 const isDeficit = row.margin_years < 0;
 return (
 <tr key={row.finding_id || idx} className="hover:bg-surface-2/50 transition-colors">
 <td className="py-3 px-4">
 <span className="font-mono text-crypto font-semibold block">{row.finding_id}</span>
 <span className="text-[10px] text-text-muted">{row.asset_id}</span>
 </td>
 <td className="py-3 px-4 font-semibold text-text-brand">{row.algorithm}</td>
 <td className="py-3 px-4 font-mono">{row.x_shelf_life_years} yrs</td>
 <td className="py-3 px-4 font-mono">{row.y_migration_years} yrs</td>
 <td className="py-3 px-4 font-mono">{row.z_quantum_threat_years} yrs</td>
 <td className="py-3 px-4 font-mono">
 <span
 className={`px-2 py-0.5 rounded font-bold ${
 isDeficit
 ? 'bg-surface-2 text-critical border border-critical'
 : 'bg-surface-2 text-success border border-success'
 }`}
 >
 {row.margin_years > 0 ? `+${row.margin_years}` : row.margin_years} yrs
 </span>
 </td>
 <td className="py-3 px-4">
 <span
 className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
 row.status === 'CRITICAL_URGENT'
 ? 'bg-surface-2 border-critical text-critical'
 : row.status === 'AT_RISK'
 ? 'bg-surface-2 border-high text-high'
 : row.status === 'WATCH'
 ? 'bg-surface-2 border-medium text-medium'
 : 'bg-surface-2 border-success text-success'
 }`}
 >
 {row.status}
 </span>
 </td>
 <td className="py-3 px-4 text-right">
 <button
 onClick={() =>
 onOpenEvidence(
 `Mosca Timeline Evidence: ${row.algorithm}`,
 `Asset ${row.asset_id} under Mosca margin ${row.margin_years} years`,
 [row.finding_id]
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
 })}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
};
