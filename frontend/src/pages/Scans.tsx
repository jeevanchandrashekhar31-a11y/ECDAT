import React, { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ScanItem } from '../types';
import {
  Shield,
  Clock,
  Play,
  Loader2,
  ExternalLink,
  FileBarChart,
  X
} from 'lucide-react';

export const Scans: React.FC = () => {
  const outlet = useOutletContext<{ selectedScanId?: string; scans?: ScanItem[] }>() || {};
  const [scans, setScans] = useState<ScanItem[]>(outlet.scans || []);
  const [loading, setLoading] = useState(!outlet.scans);
  const [selectedCoverageScan, setSelectedCoverageScan] = useState<ScanItem | null>(null);
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
                        <div className="flex items-center justify-end gap-2">
                          {scan.coverage_stats && (
                            <button
                              onClick={() => setSelectedCoverageScan(scan)}
                              className="px-3 py-1.5 rounded bg-surface/50 border border-border hover:bg-surface/80 text-slate-300 transition-colors inline-flex items-center gap-1.5 text-sm"
                            >
                              <FileBarChart className="w-4 h-4" />
                              <span>Coverage</span>
                            </button>
                          )}
                          <button
                            onClick={() => viewScanDetails(scan.id)}
                            className="px-3 py-1.5 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors inline-flex items-center gap-1.5 text-sm font-semibold"
                          >
                            <span>View Dashboard</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Coverage Modal */}
      {selectedCoverageScan && selectedCoverageScan.coverage_stats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <div>
                <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                  <FileBarChart className="w-5 h-5 text-emerald-400" /> Coverage Report
                </h2>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  {selectedCoverageScan.id}
                </div>
              </div>
              <button 
                onClick={() => setSelectedCoverageScan(null)}
                className="text-slate-400 hover:text-white p-2 rounded hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto flex-1 text-sm text-slate-300 space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-background/50 p-4 rounded border border-border/50">
                  <div className="text-xs uppercase text-slate-500 font-bold mb-1">Total Files</div>
                  <div className="text-2xl font-mono text-slate-100">{selectedCoverageScan.coverage_stats.files_total}</div>
                </div>
                <div className="bg-background/50 p-4 rounded border border-border/50">
                  <div className="text-xs uppercase text-slate-500 font-bold mb-1">Files Scanned</div>
                  <div className="text-2xl font-mono text-emerald-400">{selectedCoverageScan.coverage_stats.files_scanned}</div>
                </div>
                <div className="bg-background/50 p-4 rounded border border-border/50">
                  <div className="text-xs uppercase text-slate-500 font-bold mb-1">Files Skipped</div>
                  <div className="text-2xl font-mono text-amber-400">
                    {Object.values(selectedCoverageScan.coverage_stats.files_skipped || {}).reduce((a, b) => a + b, 0)}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-200 mb-3 border-b border-border/50 pb-2">Parser Success Rates</h3>
                <div className="space-y-3">
                  {Object.entries(selectedCoverageScan.coverage_stats.parser_stats || {}).map(([lang, stats]) => {
                    const successRate = stats.attempted > 0 ? (stats.success / stats.attempted) * 100 : 0;
                    return (
                      <div key={lang} className="bg-background/30 p-3 rounded border border-border/30">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-mono text-slate-200 font-semibold">{lang}</span>
                          <span className={`font-mono text-xs font-bold ${successRate === 100 ? 'text-emerald-400' : successRate > 80 ? 'text-amber-400' : 'text-rose-400'}`}>
                            {successRate.toFixed(1)}% ({stats.success}/{stats.attempted})
                          </span>
                        </div>
                        <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
                          <div 
                            className={`h-1.5 rounded-full ${successRate === 100 ? 'bg-emerald-500' : successRate > 80 ? 'bg-amber-500' : 'bg-rose-500'}`}
                            style={{ width: `${successRate}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {Object.keys(selectedCoverageScan.coverage_stats.files_skipped || {}).length > 0 && (
                <div>
                  <h3 className="font-semibold text-slate-200 mb-3 border-b border-border/50 pb-2">Skip Reasons</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(selectedCoverageScan.coverage_stats.files_skipped).map(([reason, count]) => (
                      <div key={reason} className="flex justify-between items-center bg-background/30 px-3 py-2 rounded text-xs">
                        <span className="text-slate-400 truncate pr-2" title={reason}>{reason}</span>
                        <span className="font-mono text-amber-400 font-bold">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-border/50 bg-background/80 flex justify-end">
              <button 
                onClick={() => setSelectedCoverageScan(null)}
                className="px-4 py-2 rounded bg-surface hover:bg-white/10 text-slate-200 text-sm font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scans;
