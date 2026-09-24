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
        <div className="absolute right-0 top-0 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Atom className="w-5 h-5 text-violet-400" />
              <span className="text-xs uppercase font-mono tracking-wider font-semibold text-violet-300">
                Post-Quantum Cryptography (PQC) Readiness
              </span>
            </div>
            <h3 className="text-2xl font-bold text-slate-100">
              NIST FIPS 203 / 204 / 205 Migration Horizon
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Evaluation under Mosca's Theorem (X + Y &gt; Z). Identification of Shor-vulnerable public key algorithms,
              Grover-impacted symmetric keys, and hybrid PQC transition candidates.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-xs text-slate-400 font-mono block">Overall PQC Readiness</span>
              <span className="text-4xl font-extrabold text-violet-400">
                {data.overall_readiness_score}%
              </span>
            </div>
          </div>
        </div>

        {/* NIST Standards Alignment Pills */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {data.nist_standards_alignment.map((std) => (
            <div
              key={std.standard}
              className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between"
            >
              <div>
                <span className="text-xs font-bold text-slate-200 block">{std.standard}</span>
                <span className="text-[11px] text-violet-400 font-mono">{std.target}</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                  std.status === 'ADOPTING'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : std.status === 'PLANNED'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
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
          className="glass-card p-5 cursor-pointer hover:border-rose-600/70 hover:shadow-rose-950/20 hover:shadow-xl transition-all group"
          title="Click to inspect all Shor-vulnerable findings"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider font-mono">
              Shor Algorithm (Catastrophic)
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-rose-400 transition-colors" />
          </div>
          <div className="text-3xl font-extrabold text-rose-300">{data.shor_vulnerable_count}</div>
          <p className="text-xs text-slate-400 mt-1">
            RSA, ECC, ECDSA, DH algorithms requiring ML-KEM or ML-DSA replacement.
          </p>
          <span className="text-[11px] text-rose-400 underline decoration-rose-500/50 mt-3 inline-block font-semibold">
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
          className="glass-card p-5 cursor-pointer hover:border-amber-600/70 hover:shadow-amber-950/20 hover:shadow-xl transition-all group"
          title="Click to inspect Grover-impacted findings"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider font-mono">
              Grover Algorithm (Quadratic)
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-amber-400 transition-colors" />
          </div>
          <div className="text-3xl font-extrabold text-amber-300">{data.grover_vulnerable_count}</div>
          <p className="text-xs text-slate-400 mt-1">
            AES-128, 3DES, SHA-1 with effective quantum key strength halved.
          </p>
          <span className="text-[11px] text-amber-400 underline decoration-amber-500/50 mt-3 inline-block font-semibold">
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
          className="glass-card p-5 cursor-pointer hover:border-emerald-600/70 hover:shadow-emerald-950/20 hover:shadow-xl transition-all group"
          title="Click to inspect PQC-safe findings"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider font-mono">
              Quantum-Safe / Hybrid
            </span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 transition-colors" />
          </div>
          <div className="text-3xl font-extrabold text-emerald-300">{data.pqc_safe_count}</div>
          <p className="text-xs text-slate-400 mt-1">
            AES-256, SHA-384, Kyber-768 hybrid key exchanges deployed in production.
          </p>
          <span className="text-[11px] text-emerald-400 underline decoration-emerald-500/50 mt-3 inline-block font-semibold">
            Inspect {data.pqc_safe_count} Evidence Items →
          </span>
        </div>
      </div>

      {/* Mosca Timeline Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-200">
              Mosca's Theorem Timeline (X + Y &gt; Z Deficit Analysis)
            </h4>
            <p className="text-xs text-slate-400">
              X = Data Shelf-life, Y = Migration Time, Z = Time Until Cryptanalytically Relevant Quantum Computer (CRQC).
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {timeline.length} Analyzed Horizons
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/70 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
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
            <tbody className="divide-y divide-slate-800/60">
              {timeline.map((row, idx) => {
                const isDeficit = row.margin_years < 0;
                return (
                  <tr key={row.finding_id || idx} className="hover:bg-slate-850/50 transition-colors">
                    <td className="py-3 px-4">
                      <span className="font-mono text-cyan-400 font-semibold block">{row.finding_id}</span>
                      <span className="text-[10px] text-slate-500">{row.asset_id}</span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-200">{row.algorithm}</td>
                    <td className="py-3 px-4 font-mono">{row.x_shelf_life_years} yrs</td>
                    <td className="py-3 px-4 font-mono">{row.y_migration_years} yrs</td>
                    <td className="py-3 px-4 font-mono">{row.z_quantum_threat_years} yrs</td>
                    <td className="py-3 px-4 font-mono">
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          isDeficit
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}
                      >
                        {row.margin_years > 0 ? `+${row.margin_years}` : row.margin_years} yrs
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          row.status === 'CRITICAL_URGENT'
                            ? 'bg-red-950 border-red-600 text-red-300'
                            : row.status === 'AT_RISK'
                            ? 'bg-orange-950 border-orange-600 text-orange-300'
                            : row.status === 'WATCH'
                            ? 'bg-yellow-950 border-yellow-600 text-yellow-300'
                            : 'bg-emerald-950 border-emerald-600 text-emerald-300'
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
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 border border-slate-700 text-xs inline-flex items-center gap-1 transition-colors"
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
