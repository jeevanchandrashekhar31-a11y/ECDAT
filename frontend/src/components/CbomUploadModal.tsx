import React, { useState, useEffect } from 'react';
import { Upload, X, FileCode, CheckCircle2, AlertTriangle, Loader2, Globe, Folder, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { authManager } from '../security';

interface CbomUploadModalProps {
 isOpen: boolean;
 onClose: () => void;
 onSuccess: (newScanId: string) => void;
}

const MAX_CBOM_UPLOAD_BYTES = 10 * 1024 * 1024;

export const CbomUploadModal: React.FC<CbomUploadModalProps> = ({ isOpen, onClose, onSuccess }) => {
 const session = authManager.getSession();
 const [file, setFile] = useState<File | null>(null);
 const [jsonText, setJsonText] = useState('');
 const [mode, setMode] = useState<'scan' | 'file' | 'text'>('scan');
 const [scanType, setScanType] = useState<'network' | 'static' | 'binary'>('network');
 
 // Live Scanner State
 const [scanTarget, setScanTarget] = useState('');
 const [authorizedBy, setAuthorizedBy] = useState(session.userId || 'demo-developer');
 const [staticSubMode, setStaticSubMode] = useState<'upload' | 'folder' | 'git'>('upload');
 const [scanUploadFile, setScanUploadFile] = useState<File | null>(null);
 const [folderFiles, setFolderFiles] = useState<File[] | null>(null);
 const [scanGitUrl, setScanGitUrl] = useState('');
 const [binarySubMode, setBinarySubMode] = useState<'upload' | 'image'>('upload');
 const [binaryImageName, setBinaryImageName] = useState('');

 useEffect(() => {
 if (isOpen) {
 const cur = authManager.getSession();
 if (cur.userId) {
 setAuthorizedBy(cur.userId);
 }
 }
 }, [isOpen]);

 const [scanLabel, setScanLabel] = useState('');
 const [policyProfile, setPolicyProfile] = useState('regulated_bfsi');
 const [scenario, setScenario] = useState('baseline');
 const [scannerType, setScannerType] = useState('combined');
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);

 if (!isOpen) return null;

 const isArchiveFile = (name: string) => {
 const lower = name.toLowerCase();
 return (
 lower.endsWith('.zip') ||
 lower.endsWith('.tar') ||
 lower.endsWith('.tar.gz') ||
 lower.endsWith('.tgz') ||
 lower.endsWith('.jar')
 );
 };

 const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
 if (e.target.files && e.target.files[0]) {
 const selected = e.target.files[0];
 if (isArchiveFile(selected.name)) {
 // User picked a .zip or archive on File Upload tab: seamlessly switch them to Static Scan!
 setMode('scan');
 setScanType('static');
 setStaticSubMode('upload');
 setScanUploadFile(selected);
 if (!scanLabel) {
 setScanLabel(selected.name.replace(/\.[^/.]+$/, ''));
 }
 setError(null);
 return;
 }
 if (selected.size > MAX_CBOM_UPLOAD_BYTES) {
 setFile(null);
 setError('CBOM files must be 10 MB or smaller.');
 return;
 }
 setFile(selected);
 if (!scanLabel) {
 setScanLabel(selected.name.replace(/\.json$/i, ''));
 }
 setError(null);
 }
 };

 const handleDrop = (e: React.DragEvent) => {
 e.preventDefault();
 if (e.dataTransfer.files && e.dataTransfer.files[0]) {
 const dropped = e.dataTransfer.files[0];
 if (isArchiveFile(dropped.name)) {
 setMode('scan');
 setScanType('static');
 setStaticSubMode('upload');
 setScanUploadFile(dropped);
 if (!scanLabel) {
 setScanLabel(dropped.name.replace(/\.[^/.]+$/, ''));
 }
 setError(null);
 return;
 }
 if (dropped.size > MAX_CBOM_UPLOAD_BYTES) {
 setFile(null);
 setError('CBOM files must be 10 MB or smaller.');
 return;
 }
 setFile(dropped);
 if (!scanLabel) {
 setScanLabel(dropped.name.replace(/\.json$/i, ''));
 }
 setError(null);
 }
 };

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 setLoading(true);
 setError(null);

 try {
 if (mode === 'scan') {
 let scanRes: { scan_id?: string } | undefined;
 if (scanType === 'static') {
 if (staticSubMode === 'git') {
 if (!scanGitUrl.trim()) throw new Error('Please provide a Git repository URL.');
 scanRes = await api.triggerStaticScan(undefined, {
 github_url: scanGitUrl.trim(),
 scan_label: scanLabel.trim() || undefined,
 policy_profile: policyProfile,
 scenario,
 });
 } else if (staticSubMode === 'folder') {
 if (!folderFiles || folderFiles.length === 0) throw new Error('Please select a project folder containing source code.');
 scanRes = await api.triggerStaticScan(folderFiles, {
 scan_label: scanLabel.trim() || undefined,
 policy_profile: policyProfile,
 scenario,
 });
 } else {
 if (!scanUploadFile) throw new Error('Please select a project .ZIP archive or source file to scan.');
 scanRes = await api.triggerStaticScan(scanUploadFile || undefined, {
 scan_label: scanLabel.trim() || undefined,
 policy_profile: policyProfile,
 scenario,
 });
 }
 } else if (scanType === 'network') {
 const target = scanTarget.trim();
 if (!target) throw new Error('Please enter a target URL or hostname (e.g. https://api.yourdomain.com)');
 scanRes = await api.triggerNetworkScan(target, undefined, {
 scan_label: scanLabel.trim() || undefined,
 policy_profile: policyProfile,
 scenario,
 authorized_by: authorizedBy.trim() || 'demo-developer',
 });
 } else {
 if (binarySubMode === 'image') {
 const img = binaryImageName.trim();
 if (!img) throw new Error('Please enter a container image name (e.g. your-org/app:latest)');
 scanRes = await api.triggerBinaryScan(undefined, {
 image: img,
 scan_label: scanLabel.trim() || undefined,
 policy_profile: policyProfile,
 scenario,
 });
 } else {
 if (!scanUploadFile) throw new Error('Please select a binary file or archive to scan.');
 scanRes = await api.triggerBinaryScan(scanUploadFile, {
 scan_label: scanLabel.trim() || undefined,
 policy_profile: policyProfile,
 scenario,
 });
 }
 }

 if (scanRes?.scan_id) {
 onSuccess(scanRes.scan_id);
 onClose();
 } else {
 throw new Error('Scan completed without returning a scan ID.');
 }
 } else {
 let uploadTarget: File | object;

 if (mode === 'file') {
 if (!file) {
 throw new Error('Please select a CycloneDX CBOM JSON file to upload.');
 }
 uploadTarget = file;
 } else {
 if (!jsonText.trim()) {
 throw new Error('Please paste a valid CycloneDX JSON payload.');
 }
 if (new Blob([jsonText]).size > MAX_CBOM_UPLOAD_BYTES) {
 throw new Error('CBOM JSON must be 10 MB or smaller.');
 }
 try {
 uploadTarget = JSON.parse(jsonText);
 } catch (parseErr: unknown) {
 throw new Error(`Invalid JSON format: ${(parseErr as Error).message}`);
 }
 }

 const res = await api.uploadCbom(uploadTarget, {
 scanLabel: scanLabel.trim() || undefined,
 policyProfile,
 scenario,
 scannerType,
 });

 onSuccess(res.scan_id);
 onClose();
 }
 } catch (err: unknown) {
 setError((err as Error).message || 'Operation failed.');
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150">
 <div className="glass-card max-w-xl w-full p-6 border border-border-soft/80 shadow-md relative">
 <button
 onClick={onClose}
 className="absolute top-4 right-4 p-1.5 rounded-lg text-text-secondary hover:text-text-brand hover:bg-surface transition-colors"
 aria-label="Close modal"
 >
 <X size={18} />
 </button>

 <div className="flex items-center gap-3 mb-5">
 <div className="p-2.5 rounded-xl bg-pqc/15 border border-pqc/30 text-crypto">
 <Upload size={20} />
 </div>
 <div>
 <h3 className="text-lg font-bold text-text-brand">Cryptographic Discovery & Ingestion</h3>
 <p className="text-xs text-text-secondary">Run a live scan or ingest CycloneDX CBOM for quantum risk assessment</p>
 </div>
 </div>

 {error && (
 <div className="mb-4 p-3 rounded-lg bg-critical/15 border border-critical text-critical text-xs flex items-center gap-2">
 <AlertTriangle size={16} className="shrink-0" />
 <span>{error}</span>
 </div>
 )}

 <form onSubmit={handleSubmit} className="space-y-4 text-xs">
 {/* Input Mode Switcher */}
 <div className="flex rounded-lg bg-bg-1 p-1 border border-border">
 <button
 type="button"
 onClick={() => setMode('scan')}
 className={`flex-1 py-1.5 rounded-md font-medium transition-all ${
 mode === 'scan'
 ? 'bg-pqc text-text-muted font-bold shadow-md'
 : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 Live Scanner
 </button>
 <button
 type="button"
 onClick={() => setMode('file')}
 className={`flex-1 py-1.5 rounded-md font-medium transition-all ${
 mode === 'file'
 ? 'bg-pqc text-text-muted font-bold shadow-md'
 : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 File Upload
 </button>
 <button
 type="button"
 onClick={() => setMode('text')}
 className={`flex-1 py-1.5 rounded-md font-medium transition-all ${
 mode === 'text'
 ? 'bg-pqc text-text-muted font-bold shadow-md'
 : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 Paste JSON
 </button>
 </div>

 {/* Mode 1: Live Scanner Trigger */}
 {mode === 'scan' && (
 <div className="space-y-3 bg-background/50 p-4 rounded-xl border border-border">
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => setScanType('network')}
 className={`flex-1 py-1.5 px-3 rounded-lg font-semibold text-2xs uppercase tracking-wider transition-all border ${
 scanType === 'network'
 ? 'bg-success/20 border-success text-success'
 : 'bg-bg-1 border-border text-text-secondary hover:text-text-brand'
 }`}
 >
 Network TLS
 </button>
 <button
 type="button"
 onClick={() => setScanType('static')}
 className={`flex-1 py-1.5 px-3 rounded-lg font-semibold text-2xs uppercase tracking-wider transition-all border ${
 scanType === 'static'
 ? 'bg-pqc/20 border-pqc/60 text-crypto'
 : 'bg-bg-1 border-border text-text-secondary hover:text-text-brand'
 }`}
 >
 Static Code
 </button>
 <button
 type="button"
 onClick={() => setScanType('binary')}
 className={`flex-1 py-1.5 px-3 rounded-lg font-semibold text-2xs uppercase tracking-wider transition-all border ${
 scanType === 'binary'
 ? 'bg-brand/20 border-brand text-brand'
 : 'bg-bg-1 border-border text-text-secondary hover:text-text-brand'
 }`}
 >
 Binary / Container
 </button>
 </div>

 {scanType === 'network' && (
 <div className="space-y-3">
 <div>
 <label className="block text-text-secondary font-medium mb-1">Target URL or Hostname</label>
 <div className="relative flex items-center">
 <Globe className="w-4 h-4 text-success absolute left-3 pointer-events-none" />
 <input
 type="text"
 value={scanTarget}
 onChange={(e) => setScanTarget(e.target.value)}
 placeholder="e.g. https://api.yourdomain.com or 192.168.1.1"
 className="w-full bg-bg-1 border border-border rounded-lg pl-9 pr-3 py-2 text-text-brand focus:outline-none focus:border-success font-mono text-xs"
 />
 </div>
 </div>

 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-text-secondary font-medium flex items-center gap-1.5">
 <ShieldCheck className="w-3.5 h-3.5 text-success" />
 <span>Authorized By</span>
 </label>
 <span className="text-[10px] text-text-muted">Required by NIST / SSRF Security Guard</span>
 </div>
 <input
 type="text"
 value={authorizedBy}
 onChange={(e) => setAuthorizedBy(e.target.value)}
 placeholder="e.g. demo-developer or your user ID"
 className="w-full bg-bg-1 border border-border rounded-lg px-3 py-1.5 text-text-brand focus:outline-none focus:border-success font-mono text-xs"
 />
 <p className="text-[11px] text-text-muted mt-1">
 Must match your active session identity (<span className="text-success font-mono">{session.userId || 'demo-developer'}</span>) or an administrator role.
 </p>
 </div>
 </div>
 )}

 {scanType === 'static' && (
 <div className="space-y-2.5">
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => setStaticSubMode('upload')}
 className={`px-2.5 py-1 rounded text-2xs font-medium transition-all ${
 staticSubMode === 'upload' ? 'bg-pqc/20 text-crypto border border-pqc/40' : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 Upload Project (.ZIP)
 </button>
 <button
 type="button"
 onClick={() => setStaticSubMode('folder')}
 className={`px-2.5 py-1 rounded text-2xs font-medium transition-all ${
 staticSubMode === 'folder' ? 'bg-pqc/20 text-crypto border border-pqc/40' : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 Local Folder
 </button>
 <button
 type="button"
 onClick={() => setStaticSubMode('git')}
 className={`px-2.5 py-1 rounded text-2xs font-medium transition-all ${
 staticSubMode === 'git' ? 'bg-pqc/20 text-crypto border border-pqc/40' : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 Git Repository URL
 </button>
 </div>

 {staticSubMode === 'upload' && (
 <div>
 <label className="w-full flex items-center justify-between bg-bg-1 border border-dashed border-border-soft hover:border-pqc/60 rounded-lg px-3 py-2.5 text-xs text-text-secondary cursor-pointer">
 <div className="flex items-center gap-2 truncate">
 <Upload className="w-4 h-4 text-crypto shrink-0" />
 <span className="truncate">
 {scanUploadFile ? scanUploadFile.name : 'Select project .ZIP or source archive'}
 </span>
 </div>
 <span className="text-2xs bg-surface text-text-secondary px-2 py-0.5 rounded border border-border-soft font-medium">
 Browse
 </span>
 <input
 type="file"
 accept=".zip,.tar,.gz,.tgz,.c,.h,.cpp,.hpp,.go,.js,.jsx,.ts,.tsx,.py,.java"
 className="hidden"
 onChange={(e) => {
 if (e.target.files && e.target.files[0]) {
 const f = e.target.files[0];
 setScanUploadFile(f);
 if (!scanLabel) {
 setScanLabel(f.name.replace(/\.[^/.]+$/, ''));
 }
 }
 }}
 />
 </label>
 <p className="text-[11px] text-text-muted mt-1">
 Select a .ZIP archive containing your codebase or an individual source code file.
 </p>
 </div>
 )}

 {staticSubMode === 'folder' && (
 <div>
 <label className="w-full flex items-center justify-between bg-bg-1 border border-dashed border-border-soft hover:border-pqc/60 rounded-lg px-3 py-2.5 text-xs text-text-secondary cursor-pointer">
 <div className="flex items-center gap-2 truncate">
 <Folder className="w-4 h-4 text-crypto shrink-0" />
 <span className="truncate">
 {folderFiles && folderFiles.length > 0
 ? `Selected folder with ${folderFiles.length} files (${(folderFiles.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)} MB)`
 : 'Select local project directory / folder'}
 </span>
 </div>
 <span className="text-2xs bg-surface text-text-secondary px-2 py-0.5 rounded border border-border-soft font-medium">
 Choose Folder
 </span>
 <input
 type="file"
 multiple
 {...({ webkitdirectory: '', directory: '' } as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
 className="hidden"
 onChange={(e) => {
 if (e.target.files && e.target.files.length > 0) {
 const filesArr = Array.from(e.target.files);
 setFolderFiles(filesArr);
 if (!scanLabel) {
 const relPath = filesArr[0]?.webkitRelativePath || '';
 const rootFolderName = relPath.split('/')[0] || 'Local Project';
 setScanLabel(rootFolderName);
 }
 }
 }}
 />
 </label>
 <p className="text-[11px] text-text-muted mt-1">
 Selects an entire local folder using your browser's folder picker. All source files will be discovered and analyzed.
 </p>
 </div>
 )}

 {staticSubMode === 'git' && (
 <div className="space-y-1">
 <input
 type="text"
 value={scanGitUrl}
 onChange={(e) => setScanGitUrl(e.target.value)}
 placeholder="e.g. https://github.com/org/repo.git"
 className="w-full bg-bg-1 border border-border rounded-lg px-3 py-2 text-text-brand focus:outline-none focus:border-pqc font-mono text-xs"
 />
 <p className="text-[11px] text-text-muted">ECDAT will shallow-clone and discover AST cryptographic call sites.</p>
 </div>
 )}
 </div>
 )}

 {scanType === 'binary' && (
 <div className="space-y-2.5">
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => setBinarySubMode('upload')}
 className={`px-2.5 py-1 rounded text-2xs font-medium transition-all ${
 binarySubMode === 'upload' ? 'bg-brand/20 text-brand border border-brand' : 'text-text-secondary'
 }`}
 >
 Upload Binary (.ZIP/.jar/.bin)
 </button>
 <button
 type="button"
 onClick={() => setBinarySubMode('image')}
 className={`px-2.5 py-1 rounded text-2xs font-medium transition-all ${
 binarySubMode === 'image' ? 'bg-brand/20 text-brand border border-brand' : 'text-text-secondary'
 }`}
 >
 Container Image
 </button>
 </div>

 {binarySubMode === 'upload' ? (
 <div>
 <label className="w-full flex items-center justify-between bg-bg-1 border border-dashed border-border-soft hover:border-brand rounded-lg px-3 py-2.5 text-xs text-text-secondary cursor-pointer">
 <div className="flex items-center gap-2 truncate">
 <Upload className="w-4 h-4 text-brand-light shrink-0" />
 <span className="truncate">
 {scanUploadFile ? scanUploadFile.name : 'Select .ZIP, .jar, .dll, or binary executable'}
 </span>
 </div>
 <span className="text-2xs bg-surface text-text-secondary px-2 py-0.5 rounded border border-border-soft font-medium">
 Browse
 </span>
 <input
 type="file"
 accept=".zip,.jar,.tar,.so,.dll,.exe,.bin"
 className="hidden"
 onChange={(e) => {
 if (e.target.files && e.target.files[0]) {
 const f = e.target.files[0];
 setScanUploadFile(f);
 if (!scanLabel) {
 setScanLabel(f.name.replace(/\.[^/.]+$/, ''));
 }
 }
 }}
 />
 </label>
 </div>
 ) : (
 <div className="space-y-1">
 <input
 type="text"
 value={binaryImageName}
 onChange={(e) => setBinaryImageName(e.target.value)}
 placeholder="e.g. your-org/app:latest"
 className="w-full bg-bg-1 border border-border rounded-lg px-3 py-2 text-text-brand focus:outline-none focus:border-brand font-mono text-xs"
 />
 <p className="text-[11px] text-text-muted">Catalogs package libraries, dependencies, and CPE identifiers using Syft.</p>
 </div>
 )}
 </div>
 )}
 </div>
 )}

 {/* Mode 2: File Drag & Drop */}
 {mode === 'file' && (
 <div className="space-y-3">
 <div
 onDragOver={(e) => e.preventDefault()}
 onDrop={handleDrop}
 className="border-2 border-dashed border-border-soft/80 hover:border-pqc/60 rounded-xl p-6 text-center transition-colors bg-background/40"
 >
 <input
 type="file"
 id="cbom-file"
 accept=".json,application/json,.zip,application/zip"
 onChange={handleFileChange}
 className="hidden"
 />
 <label htmlFor="cbom-file" className="cursor-pointer block">
 {file ? (
 <div className="flex items-center justify-center gap-2 text-crypto">
 <FileCode size={24} className="text-crypto" />
 <span className="font-semibold truncate max-w-[280px]">{file.name}</span>
 <span className="text-text-muted text-[11px]">({(file.size / 1024).toFixed(1)} KB)</span>
 </div>
 ) : (
 <>
 <Upload size={28} className="mx-auto text-text-muted mb-2" />
 <p className="font-semibold text-text-brand">Click to browse or drag CycloneDX JSON here</p>
 <p className="text-text-muted mt-1">Supports CycloneDX v1.4, v1.5, v1.6</p>
 </>
 )}
 </label>
 </div>

 <div className="p-3 bg-surface-2 border border-pqc/20 rounded-lg flex items-center justify-between text-xs">
 <div className="text-text-secondary">
 <span className="text-crypto font-semibold">Want to scan source code or a .ZIP project?</span>
 <p className="text-[11px] text-text-secondary mt-0.5">
 Use the Live Code Scanner to analyze source code repositories, folders, or archives.
 </p>
 </div>
 <button
 type="button"
 onClick={() => {
 setMode('scan');
 setScanType('static');
 setStaticSubMode('upload');
 }}
 className="shrink-0 px-2.5 py-1.5 bg-pqc/20 hover:bg-pqc/30 text-crypto border border-pqc/40 rounded font-medium transition-all ml-3"
 >
 Switch to Code Scan &rarr;
 </button>
 </div>
 </div>
 )}

 {/* Mode 3: Paste Raw JSON */}
 {mode === 'text' && (
 <div>
 <label className="block text-text-secondary font-medium mb-1">CycloneDX JSON Payload</label>
 <textarea
 rows={6}
 value={jsonText}
 onChange={(e) => setJsonText(e.target.value)}
 placeholder='{"bomFormat": "CycloneDX", "specVersion": "1.6", "components": [...]}'
 className="w-full bg-background border border-border rounded-lg p-3 font-mono text-[11px] text-text-brand focus:outline-none focus:border-pqc/80"
 />
 </div>
 )}

 {/* Configuration Form */}
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-text-secondary mb-1">Scan Target / Label</label>
 <input
 type="text"
 value={scanLabel}
 onChange={(e) => setScanLabel(e.target.value)}
 placeholder="e.g. Production Infrastructure Scan"
 className="w-full bg-bg-1 border border-border rounded-lg px-3 py-2 text-text-brand focus:outline-none focus:border-pqc"
 />
 </div>

 <div>
 <label className="block text-text-secondary mb-1">Policy Profile</label>
 <select
 value={policyProfile}
 onChange={(e) => setPolicyProfile(e.target.value)}
 className="w-full bg-bg-1 border border-border rounded-lg px-3 py-2 text-text-brand focus:outline-none focus:border-pqc"
 >
 <option value="regulated_bfsi">Regulated BFSI (Strict)</option>
 <option value="public_internet">Public Internet</option>
 <option value="internal_enterprise">Internal Enterprise</option>
 <option value="government_high_value">Government High Value</option>
 <option value="iot_ot">IoT / OT Device</option>
 </select>
 </div>

 <div>
 <label className="block text-text-secondary mb-1">Mosca Scenario</label>
 <select
 value={scenario}
 onChange={(e) => setScenario(e.target.value)}
 className="w-full bg-bg-1 border border-border rounded-lg px-3 py-2 text-text-brand focus:outline-none focus:border-pqc"
 >
 <option value="baseline">Baseline (9 yr horizon)</option>
 <option value="conservative">Conservative (7 yr horizon)</option>
 <option value="optimistic">Optimistic (12 yr horizon)</option>
 </select>
 </div>

 <div>
 <label className="block text-text-secondary mb-1">Scanner Type</label>
 <select
 value={scannerType}
 onChange={(e) => setScannerType(e.target.value)}
 className="w-full bg-bg-1 border border-border rounded-lg px-3 py-2 text-text-brand focus:outline-none focus:border-pqc"
 >
 <option value="combined">Combined Multi-Scanner</option>
 <option value="network">Network (TLS / SSLyze)</option>
 <option value="static">Static Code (Tree-sitter AST)</option>
 <option value="binary_container">Binary / Syft Container</option>
 </select>
 </div>
 </div>

 <div className="pt-3 border-t border-border flex justify-end gap-2">
 <button
 type="button"
 onClick={onClose}
 className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-2 text-text-secondary font-medium transition-colors"
 >
 Cancel
 </button>
 <button
 type="submit"
 disabled={
 loading ||
 (mode === 'file' && !file) ||
 (mode === 'text' && !jsonText.trim()) ||
 (mode === 'scan' && (
 (scanType === 'network' && !scanTarget.trim()) ||
 (scanType === 'static' && staticSubMode === 'upload' && !scanUploadFile) ||
 (scanType === 'static' && staticSubMode === 'folder' && (!folderFiles || folderFiles.length === 0)) ||
 (scanType === 'static' && staticSubMode === 'git' && !scanGitUrl.trim()) ||
 (scanType === 'binary' && binarySubMode === 'upload' && !scanUploadFile) ||
 (scanType === 'binary' && binarySubMode === 'image' && !binaryImageName.trim())
 ))
 }
 className="px-5 py-2 rounded-lg bg-pqc hover:bg-crypto text-text-muted font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
 >
 {loading ? (
 <>
 <Loader2 size={15} className="animate-spin" />
 <span>{mode === 'scan' ? 'Executing Scan...' : 'Ingesting...'}</span>
 </>
 ) : (
 <>
 <CheckCircle2 size={15} />
 <span>{mode === 'scan' ? 'Run Live Scan & Ingest' : 'Ingest & Assess Risk'}</span>
 </>
 )}
 </button>
 </div>
 </form>
 </div>
 </div>
 );
};
