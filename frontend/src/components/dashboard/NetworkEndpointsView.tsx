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
            <Globe className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-bold text-slate-100">Network Endpoint Cryptography & TLS Posture</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Active TLS ingress scans, negotiated cipher suites, Forward Secrecy (PFS), and Post-Quantum hybrid key exchange support.
          </p>
        </div>

        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
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
              className="glass-card p-5 flex flex-col justify-between hover:border-slate-700 transition-all group min-w-0"
            >
              <div>
                {/* Header row */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-2 rounded-lg bg-slate-800 text-cyan-400 shrink-0">
                      <Radio className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-100 text-sm group-hover:text-cyan-300 transition-colors truncate" title={`${ep.host}:${ep.port}`}>
                        {ep.host}:{ep.port}
                      </h4>
                      <span className="text-[10px] font-mono text-slate-500 block truncate" title={ep.protocol}>{ep.protocol}</span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      isWeakTls
                        ? 'bg-rose-950/80 border-rose-500 text-rose-300'
                        : 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                    }`}
                  >
                    {ep.tls_version}
                  </span>
                </div>

                {/* Cipher suite stats */}
                <div className="grid grid-cols-2 gap-2 my-3 p-2.5 rounded-lg bg-slate-950/50 border border-slate-850 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Cipher Suites</span>
                    <span className="text-slate-200 font-bold">{ep.cipher_suites_count} offered</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block uppercase">Weak Ciphers</span>
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
                          ? 'text-rose-400 underline cursor-pointer'
                          : 'text-emerald-400 cursor-default'
                      }`}
                    >
                      {ep.weak_ciphers_detected} detected
                    </button>
                  </div>
                </div>

                {/* PFS & Hybrid PQC capability tags */}
                <div className="space-y-2 mb-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Forward Secrecy (PFS):</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                        ep.pfs_supported
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                          : 'bg-rose-950 text-rose-300 border border-rose-700'
                      }`}
                    >
                      {ep.pfs_supported ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                      {ep.pfs_supported ? 'PFS Enforced' : 'No PFS'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Post-Quantum Hybrid:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                        ep.hybrid_supported
                          ? 'bg-violet-950 text-violet-300 border border-violet-700'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      <Zap className="w-2.5 h-2.5" />
                      {ep.hybrid_supported ? 'X25519Kyber768' : 'Classical Only'}
                    </span>
                  </div>
                </div>

                {ep.cert_fingerprint && (
                  <div className="text-[10px] font-mono text-slate-500 truncate mb-2">
                    Cert: {ep.cert_fingerprint.slice(0, 24)}...
                  </div>
                )}
              </div>

              {/* Action */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
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
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 text-xs font-medium border border-slate-700 inline-flex items-center gap-1 transition-colors"
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
