import React, { useState, useEffect } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import {
  FileText,
  Download,
  ExternalLink,
  Shield,
  Layers,
  Code2,
  Maximize2,
  Minimize2,
  Printer,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../api/client';
import { ScanItem } from '../types';
import { sanitizeUrl } from '../security';

export const Reports: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const outlet = useOutletContext<{ selectedScanId?: string }>() || {};
  const activeScanId = searchParams.get('scanId') || outlet.selectedScanId || 'latest';

  const [scans, setScans] = useState<ScanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewHeight, setPreviewHeight] = useState<'standard' | 'tall' | 'compact'>('standard');
  const [iframeKey, setIframeKey] = useState(0);
  const [showAdvancedExports, setShowAdvancedExports] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>('');
  const [reportLoading, setReportLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchScans = async () => {
      try {
        const data = await api.getScans();
        if (mounted && data?.scans) {
          setScans(data.scans);
        }
      } catch (err) {
        console.warn('Failed to fetch scans list:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchScans();
    return () => {
      mounted = false;
    };
  }, []);

  const handleScanChange = (newScanId: string) => {
    const params = new URLSearchParams(searchParams);
    if (newScanId === 'latest') {
      params.delete('scanId');
    } else {
      params.set('scanId', newScanId);
    }
    setSearchParams(params);
    setIframeKey((prev) => prev + 1);
  };

  useEffect(() => {
    let mounted = true;
    const fetchHtml = async () => {
      setReportLoading(true);
      try {
        const html = await api.getReportHtml(activeScanId === 'latest' ? '' : activeScanId);
        if (mounted) setReportHtml(html);
      } catch (err) {
        if (mounted) setReportHtml(`<div style="padding: 2rem; font-family: sans-serif; color: #f43f5e; text-align: center;"><h3>Failed to load report</h3><p>${(err as Error).message || 'Unknown error'}</p></div>`);
      } finally {
        if (mounted) setReportLoading(false);
      }
    };
    fetchHtml();
    return () => { mounted = false; };
  }, [activeScanId, iframeKey]);

  const handleDownload = async (type: 'annotated' | 'raw' | 'summary') => {
    setDownloading(type);
    setDownloadSuccess(null);
    try {
      let data: unknown;
      let filename = `ecdat_${type}_${activeScanId}.json`;

      if (type === 'annotated') {
        data = await api.getReportCbom(activeScanId, 'annotated');
        filename = `ecdat_cbom_annotated_${activeScanId}.json`;
      } else if (type === 'raw') {
        data = await api.getReportCbom(activeScanId, 'raw');
        filename = `ecdat_cbom_raw_${activeScanId}.json`;
      } else {
        data = await api.getReportsSummary(activeScanId === 'latest' ? undefined : activeScanId);
        filename = `ecdat_summary_${activeScanId}.json`;
      }

      const jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(jsonBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setDownloadSuccess(type);
      setTimeout(() => setDownloadSuccess(null), 3000);
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to generate export file. Ensure scan data exists.');
    } finally {
      setDownloading(null);
    }
  };

  const queryParam = activeScanId && activeScanId !== 'latest' ? `?scanId=${encodeURIComponent(activeScanId)}` : '';
  const htmlReportUrl = sanitizeUrl(`${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')}/api/v1/reports/executive/html${queryParam}`);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl md:text-3xl font-bold text-white font-mono tracking-tight flex items-center gap-3">
            <FileText className="w-8 h-8 text-primary" />
            Compliance Reports &amp; CBOM Exports
          </h1>
          <p className="text-sm text-slate-400">
            Generate, inspect, and export CycloneDX 1.6 Cryptographic BOMs and executive risk summaries.
          </p>
        </div>

        {/* Scan Selector */}
        <div className="flex items-center gap-3">
          <label htmlFor="scan-select" className="text-xs text-slate-400 font-medium">
            Active Scan:
          </label>
          <select
            id="scan-select"
            value={activeScanId}
            disabled={loading}
            onChange={(e) => handleScanChange(e.target.value)}
            className="bg-surface border border-borderMid text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500 font-mono disabled:opacity-50"
          >
            <option value="latest">Latest Scan (Active)</option>
            {scans.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.id.slice(0, 16)} ({new Date(s.created_at).toLocaleDateString()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Export Format Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Available Exports</h2>
          <button
            onClick={() => setShowAdvancedExports(!showAdvancedExports)}
            className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            {showAdvancedExports ? 'Hide Advanced Data Exports' : 'Show Advanced Data Exports'}
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Card 1: Executive Summary JSON (Always Visible) */}
          <div className="bg-surface/80 border border-border rounded-xl p-5 shadow-lg flex flex-col justify-between hover:border-borderMid transition-colors md:col-span-1">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-amber-950/60 text-amber-400 rounded-lg border border-amber-800/40">
                  <Layers className="w-5 h-5" />
                </div>
                <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/50">
                  Telemetry
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Executive Summary JSON</h3>
                <p className="text-xs text-slate-400 mt-1">
                  High-level metrics, Mosca Theorem threat timeline tables, compliance gate evaluation, and priority
                  remediation queues.
                </p>
              </div>
            </div>
            <div className="pt-4 mt-2 border-t border-border/80 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-mono">Format: JSON</span>
              <button
                onClick={() => handleDownload('summary')}
                disabled={downloading === 'summary'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surfaceHover hover:bg-surfaceMid text-slate-200 font-semibold text-xs rounded-lg transition-colors border border-borderMid disabled:opacity-50"
              >
                {downloading === 'summary' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : downloadSuccess === 'summary' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>Export Summary</span>
              </button>
            </div>
          </div>

          {/* Advanced Exports */}
          {showAdvancedExports && (
            <>
              {/* Card 2: Risk-Annotated CycloneDX 1.6 */}
              <div className="bg-surface/80 border border-border rounded-xl p-5 shadow-lg flex flex-col justify-between hover:border-borderMid transition-colors">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="p-2 bg-cyan-950/60 text-primary rounded-lg border border-cyan-800/40">
                      <Shield className="w-5 h-5" />
                    </div>
                    <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded bg-cyan-950 text-primary/80 border border-cyan-800/50">
                      CycloneDX 1.6
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">Risk-Annotated CBOM</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Full cryptographic Bill of Materials enriched with classical risk ratings, Mosca parameters, and NIST
                      PQC migration targets.
                    </p>
                  </div>
                </div>
                <div className="pt-4 mt-2 border-t border-border/80 flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-mono">Format: JSON</span>
                  <button
                    onClick={() => handleDownload('annotated')}
                    disabled={downloading === 'annotated'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors disabled:opacity-50"
                  >
                    {downloading === 'annotated' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : downloadSuccess === 'annotated' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Export CBOM</span>
                  </button>
                </div>
              </div>

              {/* Card 3: Raw Immutable Source CBOM */}
              <div className="bg-surface/80 border border-border rounded-xl p-5 shadow-lg flex flex-col justify-between hover:border-borderMid transition-colors">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="p-2 bg-purple-950/60 text-purple-400 rounded-lg border border-purple-800/40">
                      <Code2 className="w-5 h-5" />
                    </div>
                    <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/50">
                      Evidence
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">Raw Ingested CBOM</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Unmodified scanner evidence captured during initial static, network, or certificate ingestion prior to
                      risk engine enrichment.
                    </p>
                  </div>
                </div>
                <div className="pt-4 mt-2 border-t border-border/80 flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-mono">Format: JSON</span>
                  <button
                    onClick={() => handleDownload('raw')}
                    disabled={downloading === 'raw'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surfaceHover hover:bg-surfaceMid text-slate-200 font-semibold text-xs rounded-lg transition-colors border border-borderMid disabled:opacity-50"
                  >
                    {downloading === 'raw' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : downloadSuccess === 'raw' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Export Raw</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* HTML Report Embedded Viewer */}
      <div
        className={`bg-surface/90 border border-border rounded-2xl shadow-2xl transition-all duration-300 flex flex-col ${
          isFullscreen ? 'fixed inset-0 z-50 bg-background p-6 rounded-none border-0' : 'p-6'
        }`}
      >
        {/* Viewer Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-800/40 text-primary">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Standalone Executive Risk Report Preview</h2>
              <p className="text-xs text-slate-400">
                Self-contained, judge-ready HTML report rendered dynamically by the ECDAT risk engine.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Height Toggle (when not in fullscreen) */}
            {!isFullscreen && (
              <div className="flex items-center bg-surfaceHover/90 rounded-lg p-0.5 border border-borderMid/80 mr-1 text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewHeight('compact')}
                  className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                    previewHeight === 'compact'
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Compact View (700px)"
                >
                  Compact
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewHeight('standard')}
                  className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                    previewHeight === 'standard'
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Standard View (950px)"
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewHeight('tall')}
                  className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                    previewHeight === 'tall'
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Expanded View (1350px)"
                >
                  Expanded
                </button>
              </div>
            )}

            <button
              onClick={() => setIframeKey((prev) => prev + 1)}
              title="Reload preview"
              className="p-2 text-slate-400 hover:text-white bg-surfaceHover hover:bg-surfaceMid rounded-lg transition-colors border border-borderMid/60"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <a
              href={htmlReportUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full report in new tab"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-surfaceHover hover:bg-surfaceMid rounded-lg transition-colors border border-borderMid"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open in Tab</span>
            </a>
            <button
              onClick={() => {
                const iframe = document.getElementById('report-iframe') as HTMLIFrameElement;
                if (iframe?.contentWindow) {
                  iframe.contentWindow.print();
                }
              }}
              title="Print report"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-surfaceHover hover:bg-surfaceMid rounded-lg transition-colors border border-borderMid"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="p-2 text-slate-400 hover:text-white bg-surfaceHover hover:bg-surfaceMid rounded-lg transition-colors border border-borderMid/60"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Embedded Iframe Container */}
        <div
          className={`mt-4 rounded-xl overflow-hidden border border-border/80 bg-background w-full shadow-inner ${
            isFullscreen ? 'flex-1 min-h-0' : ''
          }`}
          style={{
            height: isFullscreen
              ? 'calc(100vh - 120px)'
              : previewHeight === 'tall'
                ? '1350px'
                : previewHeight === 'compact'
                  ? '700px'
                  : '950px',
            minHeight: isFullscreen ? '0px' : '700px',
          }}
        >
          {reportLoading ? (
            <div className="w-full h-full flex items-center justify-center bg-background text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mb-2" />
              <span>Generating report...</span>
            </div>
          ) : (
            <iframe
              id="report-iframe"
              key={iframeKey}
              srcDoc={reportHtml}
              title="Executive Cryptographic Report"
              className="w-full h-full border-0 bg-background block"
              sandbox="allow-same-origin allow-scripts allow-popups"
            />
          )}
        </div>
      </div>
    </div>
  );
};
