import React, { useState, useEffect } from 'react';
import { Shield, Plus, Lock, AlertTriangle, Settings, Loader2 } from 'lucide-react';
import { api } from '../api/client';

interface PolicyRule {
  id: string;
  name: string;
  description: string;
  condition: Record<string, any>;
  action: 'warn' | 'fail' | 'block' | string;
}

export const Policies: React.FC = () => {
  const [policies, setPolicies] = useState<PolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    const fetchPolicies = async () => {
      try {
        const res = await api.getPolicyRules();
        if (res.success && res.rules) {
          setPolicies(res.rules);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load policy rules');
      } finally {
        setLoading(false);
      }
    };
    fetchPolicies();
  }, []);

  const togglePolicy = async (id: string, currentAction: string) => {
    try {
      setUpdating(id);
      const newAction = currentAction.toUpperCase() === 'FAIL' || currentAction.toUpperCase() === 'BLOCK' ? 'WARN' : 'FAIL';
      const res = await api.togglePolicyRule(id, newAction);
      if (res.success && res.rules) {
        setPolicies(res.rules);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update rule');
    } finally {
      setUpdating(null);
    }
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

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-12 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-4">
          {policies.map(policy => (
            <div key={policy.id} className={`p-5 rounded-2xl bg-surface/60 border border-border/80 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-colors hover:bg-surface/80 ${updating === policy.id ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-400" />
                    {policy.name}
                  </h3>
                  <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                    policy.action.toUpperCase() === 'FAIL' || policy.action.toUpperCase() === 'BLOCK' ? 'bg-rose-950/70 text-rose-400 border border-rose-800' : 'bg-amber-950/70 text-amber-400 border border-amber-800'
                  }`}>
                    Action: {policy.action}
                  </span>
                </div>
                <p className="text-sm text-slate-300">{policy.description}</p>
                
                <div className="mt-3 inline-flex flex-wrap items-center gap-2 px-3 py-1.5 bg-slate-900/80 rounded-lg border border-slate-700/50">
                  <span className="text-xs text-slate-500 font-mono">IF</span>
                  <span className="text-xs text-emerald-400 font-mono font-semibold max-w-lg truncate" title={JSON.stringify(policy.condition || {})}>
                    {Object.keys(policy.condition || {}).length > 0 ? JSON.stringify(policy.condition || {}).replace(/[{}"']/g, '').substring(0, 80) : "ALL"}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">THEN {policy.action.toUpperCase()}</span>
                </div>
              </div>

              <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-6">
                <div className="flex flex-col items-center gap-1 mr-2">
                  <span className={`text-xs font-semibold ${policy.action.toUpperCase() === 'FAIL' || policy.action.toUpperCase() === 'BLOCK' ? 'text-rose-400' : 'text-amber-400'}`}>
                    {policy.action.toUpperCase() === 'FAIL' || policy.action.toUpperCase() === 'BLOCK' ? 'Fail Build' : 'Warn Only'}
                  </span>
                  <button 
                    onClick={() => togglePolicy(policy.id, policy.action)}
                    disabled={updating === policy.id}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${policy.action.toUpperCase() === 'FAIL' || policy.action.toUpperCase() === 'BLOCK' ? 'bg-rose-500' : 'bg-amber-500'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${policy.action.toUpperCase() === 'FAIL' || policy.action.toUpperCase() === 'BLOCK' ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </div>
                <button className="p-2 text-slate-400 hover:text-white bg-surfaceHover rounded-lg transition-colors">
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      
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
