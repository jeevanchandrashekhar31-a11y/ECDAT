import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
 const activeScanId = searchParams.get('scanId') || 'latest';

 const [scans, setScans] = useState<ScanItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [downloading, setDownloading] = useState<string | null>(null);
 const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
 const [isFullscreen, setIsFullscreen] = useState(false);
 const [previewHeight, setPreviewHeight] = useState<'standard' | 'tall' | 'compact'>('standard');
 const [iframeKey, setIframeKey] = useState(0);
 const [showAdvancedExports, setShowAdvancedExports] = useState(false);

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
 const htmlReportUrl = sanitizeUrl(`/api/v1/reports/executive/html${queryParam}`);

 return (
 <div className="space-y-8 animate-fade-in">
 {/* Header */}
 <div className="flex flex-wrap items-center justify-between gap-4">
 <div className="space-y-1">
 <h1 className="text-2xl md:text-3xl font-bold text-text-brand font-mono tracking-tight flex items-center gap-3">
 <FileText className="w-8 h-8 text-crypto" />
 Compliance Reports &amp; CBOM Exports
 </h1>
 <p className="text-sm text-text-secondary">
 Generate, inspect, and export CycloneDX 1.6 Cryptographic BOMs and executive risk summaries.
 </p>
 </div>

 {/* Scan Selector */}
 <div className="flex items-center gap-3">
 <label htmlFor="scan-select" className="text-xs text-text-secondary font-medium">
 Active Scan:
 </label>
 <select
 id="scan-select"
 value={activeScanId}
 disabled={loading}
 onChange={(e) => handleScanChange(e.target.value)}
 className="bg-bg-1 border border-border-soft text-text-brand text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-pqc font-mono disabled:opacity-50"
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
 <h2 className="text-sm font-semibold text-text-brand">Available Exports</h2>
 <button
 onClick={() => setShowAdvancedExports(!showAdvancedExports)}
 className="text-xs font-semibold text-crypto hover:text-crypto transition-colors"
 >
 {showAdvancedExports ? 'Hide Advanced Data Exports' : 'Show Advanced Data Exports'}
 </button>
 </div>
 
 <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
 {/* Card 1: Executive Summary JSON (Always Visible) */}
 <div className="bg-bg-1/80 border border-border rounded-xl p-5 flex flex-col justify-between hover:border-border-soft transition-colors md:col-span-1">
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <div className="p-2 bg-surface-2 text-high rounded-lg border border-high">
 <Layers className="w-5 h-5" />
 </div>
 <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded bg-surface-2 text-high border border-high">
 Telemetry
 </span>
 </div>
 <div>
 <h3 className="text-base font-semibold text-text-brand">Executive Summary JSON</h3>
 <p className="text-xs text-text-secondary mt-1">
 High-level metrics, Mosca Theorem threat timeline tables, compliance gate evaluation, and priority
 remediation queues.
 </p>
 </div>
 </div>
 <div className="pt-4 mt-2 border-t border-border flex items-center justify-between">
 <span className="text-xs text-text-muted font-mono">Format: JSON</span>
 <button
 onClick={() => handleDownload('summary')}
 disabled={downloading === 'summary'}
 className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-2 text-text-brand font-semibold text-xs rounded-lg transition-colors border border-border-soft disabled:opacity-50"
 >
 {downloading === 'summary' ? (
 <RefreshCw className="w-3.5 h-3.5 animate-spin" />
 ) : downloadSuccess === 'summary' ? (
 <CheckCircle2 className="w-3.5 h-3.5 text-success" />
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
 <div className="bg-bg-1/80 border border-border rounded-xl p-5 flex flex-col justify-between hover:border-border-soft transition-colors">
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <div className="p-2 bg-surface-2 text-crypto rounded-lg border border-border-soft">
 <Shield className="w-5 h-5" />
 </div>
 <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded bg-surface-2 text-crypto border border-border-soft">
 CycloneDX 1.6
 </span>
 </div>
 <div>
 <h3 className="text-base font-semibold text-text-brand">Risk-Annotated CBOM</h3>
 <p className="text-xs text-text-secondary mt-1">
 Full cryptographic Bill of Materials enriched with classical risk ratings, Mosca parameters, and NIST
 PQC migration targets.
 </p>
 </div>
 </div>
 <div className="pt-4 mt-2 border-t border-border flex items-center justify-between">
 <span className="text-xs text-text-muted font-mono">Format: JSON</span>
 <button
 onClick={() => handleDownload('annotated')}
 disabled={downloading === 'annotated'}
 className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-pqc hover:bg-crypto text-text-muted font-semibold text-xs rounded-lg transition-colors disabled:opacity-50"
 >
 {downloading === 'annotated' ? (
 <RefreshCw className="w-3.5 h-3.5 animate-spin" />
 ) : downloadSuccess === 'annotated' ? (
 <CheckCircle2 className="w-3.5 h-3.5 text-text-muted" />
 ) : (
 <Download className="w-3.5 h-3.5" />
 )}
 <span>Export CBOM</span>
 </button>
 </div>
 </div>

 {/* Card 3: Raw Immutable Source CBOM */}
 <div className="bg-bg-1/80 border border-border rounded-xl p-5 flex flex-col justify-between hover:border-border-soft transition-colors">
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <div className="p-2 bg-surface-2 text-specialized rounded-lg border border-specialized">
 <Code2 className="w-5 h-5" />
 </div>
 <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded bg-surface-2 text-specialized border border-specialized">
 Evidence
 </span>
 </div>
 <div>
 <h3 className="text-base font-semibold text-text-brand">Raw Ingested CBOM</h3>
 <p className="text-xs text-text-secondary mt-1">
 Unmodified scanner evidence captured during initial static, network, or certificate ingestion prior to
 risk engine enrichment.
 </p>
 </div>
 </div>
 <div className="pt-4 mt-2 border-t border-border flex items-center justify-between">
 <span className="text-xs text-text-muted font-mono">Format: JSON</span>
 <button
 onClick={() => handleDownload('raw')}
 disabled={downloading === 'raw'}
 className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-2 text-text-brand font-semibold text-xs rounded-lg transition-colors border border-border-soft disabled:opacity-50"
 >
 {downloading === 'raw' ? (
 <RefreshCw className="w-3.5 h-3.5 animate-spin" />
 ) : downloadSuccess === 'raw' ? (
 <CheckCircle2 className="w-3.5 h-3.5 text-success" />
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
 className={`bg-bg-1/90 border border-border rounded-2xl shadow-md transition-all duration-300 flex flex-col ${
 isFullscreen ? 'fixed inset-0 z-50 bg-background p-6 rounded-none border-0' : 'p-6'
 }`}
 >
 {/* Viewer Header */}
 <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-border">
 <div className="flex items-center gap-3">
 <div className="p-2 rounded-lg bg-surface-2 border border-border-soft text-crypto">
 <FileText className="w-5 h-5" />
 </div>
 <div>
 <h2 className="text-base font-bold text-text-brand">Standalone Executive Risk Report Preview</h2>
 <p className="text-xs text-text-secondary">
 Self-contained, judge-ready HTML report rendered dynamically by the ECDAT risk engine.
 </p>
 </div>
 </div>

 <div className="flex items-center gap-2 flex-wrap">
 {/* Height Toggle (when not in fullscreen) */}
 {!isFullscreen && (
 <div className="flex items-center bg-surface rounded-lg p-0.5 border border-border-soft/80 mr-1 text-xs">
 <button
 type="button"
 onClick={() => setPreviewHeight('compact')}
 className={`px-2.5 py-1 rounded-md transition-all font-medium ${
 previewHeight === 'compact'
 ? 'bg-pqc text-text-muted font-bold shadow-sm'
 : 'text-text-secondary hover:text-text-brand'
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
 ? 'bg-pqc text-text-muted font-bold shadow-sm'
 : 'text-text-secondary hover:text-text-brand'
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
 ? 'bg-pqc text-text-muted font-bold shadow-sm'
 : 'text-text-secondary hover:text-text-brand'
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
 className="p-2 text-text-secondary hover:text-text-brand bg-surface hover:bg-surface-2 rounded-lg transition-colors border border-border-soft/60"
 >
 <RefreshCw className="w-4 h-4" />
 </button>
 <a
 href={htmlReportUrl}
 target="_blank"
 rel="noopener noreferrer"
 title="Open full report in new tab"
 className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-brand bg-surface hover:bg-surface-2 rounded-lg transition-colors border border-border-soft"
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
 className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-brand bg-surface hover:bg-surface-2 rounded-lg transition-colors border border-border-soft"
 >
 <Printer className="w-3.5 h-3.5" />
 <span>Print / PDF</span>
 </button>
 <button
 onClick={() => setIsFullscreen(!isFullscreen)}
 title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
 className="p-2 text-text-secondary hover:text-text-brand bg-surface hover:bg-surface-2 rounded-lg transition-colors border border-border-soft/60"
 >
 {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
 </button>
 </div>
 </div>

 {/* Embedded Iframe Container */}
 <div
 className={`mt-4 rounded-xl overflow-hidden border border-border bg-background w-full shadow-inner ${
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
 <iframe
 id="report-iframe"
 key={iframeKey}
 src={htmlReportUrl}
 title="Executive Cryptographic Report"
 className="w-full h-full border-0 bg-background block"
 sandbox="allow-same-origin allow-modals allow-scripts allow-popups"
 />
 </div>
 </div>
 </div>
 );
};
