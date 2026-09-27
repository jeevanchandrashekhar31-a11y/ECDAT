import React, { useState } from 'react';
import { Shield, Plus, Lock, AlertTriangle, Settings } from 'lucide-react';

interface PolicyRule {
  id: string;
  name: string;
  description: string;
  condition: string;
  action: 'WARN' | 'FAIL' | 'BLOCK';
  enabled: boolean;
}

export const Policies: React.FC = () => {
  // Mock initial policies until connected to backend API
  const [policies, setPolicies] = useState<PolicyRule[]>([
    {
      id: 'pol_1',
      name: 'NIST SP 800-52 Rev. 2 (TLS)',
      description: 'Enforces minimum TLS version 1.2 across all internet-facing endpoints.',
      condition: 'Protocol IN (SSL, TLSv1.0, TLSv1.1)',
      action: 'FAIL',
      enabled: true,
    },
    {
      id: 'pol_2',
      name: 'CNSA 2.0 PQC Requirement',
      description: 'Flags legacy asymmetric algorithms as vulnerable to CRQC.',
      condition: 'Algorithm IN (RSA, ECC, DSA, DH)',
      action: 'WARN',
      enabled: true,
    },
    {
      id: 'pol_3',
      name: 'FIPS 140-3 Minimum Key Size',
      description: 'Ensures RSA keys are strictly 2048-bit or higher.',
      condition: 'Algorithm = RSA AND KeySize < 2048',
      action: 'FAIL',
      enabled: true,
    },
  ]);

  const togglePolicy = (id: string) => {
    setPolicies(policies.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white font-mono tracking-tight flex items-center gap-3">
            <Shield className="text-primary w-8 h-8" />
            Compliance & Policy Engine
          </h1>
          <p className="text-sm text-slate-400 mt-2 max-w-2xl">
            Visually manage cryptographic compliance rules (NIST, FIPS, CNSA 2.0). 
            These policies are evaluated in real-time during scans to generate findings and enforce CI/CD gates.
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-slate-950 font-bold rounded-xl text-sm transition-all hover:bg-cyan-300">
          <Plus className="w-4 h-4" />
          Create Rule
        </button>
      </div>

      <div className="grid gap-4">
        {policies.map(policy => (
          <div key={policy.id} className="p-5 rounded-2xl bg-surface/60 border border-border/80 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-colors hover:bg-surface/80">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-400" />
                  {policy.name}
                </h3>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                  policy.action === 'FAIL' || policy.action === 'BLOCK' ? 'bg-rose-950/70 text-rose-400 border border-rose-800' : 'bg-amber-950/70 text-amber-400 border border-amber-800'
                }`}>
                  Action: {policy.action}
                </span>
              </div>
              <p className="text-sm text-slate-300">{policy.description}</p>
              
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 rounded-lg border border-slate-700/50">
                <span className="text-xs text-slate-500 font-mono">IF</span>
                <span className="text-xs text-emerald-400 font-mono font-semibold">{policy.condition}</span>
                <span className="text-xs text-slate-500 font-mono">THEN {policy.action}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-6">
              <div className="flex items-center gap-3 mr-2">
                <span className={`text-xs font-semibold ${policy.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {policy.enabled ? 'Active' : 'Disabled'}
                </span>
                <button 
                  onClick={() => togglePolicy(policy.id)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${policy.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${policy.enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
              </div>
              <button className="p-2 text-slate-400 hover:text-white bg-surfaceHover rounded-lg transition-colors">
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
      
      <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-900/30 flex gap-3 mt-4">
        <AlertTriangle className="w-5 h-5 text-cyan-500 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-semibold text-cyan-300">Policy Evaluation Note</h4>
          <p className="text-xs text-cyan-400/80 mt-1">
            Rules are evaluated sequentially during CBOM ingestion. Changes made here will only apply to future scans unless you manually trigger a retroactive re-evaluation.
          </p>
        </div>
      </div>
    </div>
  );
};
