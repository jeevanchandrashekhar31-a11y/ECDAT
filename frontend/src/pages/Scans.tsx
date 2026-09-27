import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ScanItem } from '../types';
import {
  Shield,
  Clock,
  Play,
  Loader2,
  ExternalLink
} from 'lucide-react';

export const Scans: React.FC = () => {
  const outlet = useOutletContext<{ selectedScanId?: string; scans?: ScanItem[] }>() || {};
  const [scans, setScans] = useState<ScanItem[]>(outlet.scans || []);
  const [loading, setLoading] = useState(!outlet.scans);
  const navigate = useNavigate();

  useEffect(() => {
    if (!outlet.scans || outlet.scans.length === 0) {
      setLoading(true);
      api.getScans().then((res) => {
        setScans(res.scans || []);
        setLoading(false);
      }).catch(() => {
        setLoading(false);
      });
    } else {
      setScans(outlet.scans);
      setLoading(false);
    }
  }, [outlet.scans]);

  const viewScanDetails = (scanId: string) => {
    navigate(`/?scanId=${scanId}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Play className="text-primary w-6 h-6" /> Scan History
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Historical log of all cryptographic discovery scans and artifact ingestions.
          </p>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : scans.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Shield className="w-12 h-12 text-slate-600 mx-auto mb-3 opacity-50" />
            <p>No scans recorded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-background/80 text-slate-400 uppercase text-xs tracking-wider border-b border-border">
                <tr>
                  <th className="py-4 px-5 font-semibold">Scan Target</th>
                  <th className="py-4 px-5 font-semibold">Type / Source</th>
                  <th className="py-4 px-5 font-semibold">Date</th>
                  <th className="py-4 px-5 font-semibold">Findings</th>
                  <th className="py-4 px-5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {scans.map((scan) => {
                  const d = scan.created_at ? new Date(scan.created_at) : null;
                  const dateStr = d && !isNaN(d.getTime()) ? d.toLocaleString() : 'N/A';
                  return (
                    <tr key={scan.id} className="hover:bg-surface/50 transition-colors">
                      <td className="py-4 px-5">
                        <div className="font-semibold text-slate-100">{scan.name || scan.id}</div>
                        <div className="text-xs text-slate-500 font-mono mt-1">{scan.id}</div>
                      </td>
                      <td className="py-4 px-5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface border border-border text-xs font-mono text-slate-300 uppercase">
                          {scan.scanner_type || 'Ingestion'}
                        </span>
                      </td>
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{dateStr}</span>
                        </div>
                      </td>
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Assets</span>
                            <span className="text-sm font-semibold text-slate-200">{scan.metrics?.total_assets || 0}</span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Findings</span>
                            <span className="text-sm font-semibold text-rose-400">{scan.metrics?.total_findings || 0}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-right">
                        <button
                          onClick={() => viewScanDetails(scan.id)}
                          className="px-3 py-1.5 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors inline-flex items-center gap-1.5 text-sm font-semibold"
                        >
                          <span>View Dashboard</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scans;
