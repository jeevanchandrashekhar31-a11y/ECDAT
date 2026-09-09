import React, { useState } from 'react';
import { Upload, X, FileCode, CheckCircle2, AlertTriangle, Loader2, Globe } from 'lucide-react';
import { api } from '../api/client';

interface CbomUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newScanId: string) => void;
}

const MAX_CBOM_UPLOAD_BYTES = 10 * 1024 * 1024;

export const CbomUploadModal: React.FC<CbomUploadModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [file, setFile] = useState<File | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [mode, setMode] = useState<'scan' | 'file' | 'text'>('scan');
  const [scanType, setScanType] = useState<'network' | 'static' | 'binary'>('network');
  
  // Live Scanner State
  const [scanTarget, setScanTarget] = useState('');
  const [staticSubMode, setStaticSubMode] = useState<'upload' | 'git'>('upload');
  const [scanUploadFile, setScanUploadFile] = useState<File | null>(null);
  const [scanGitUrl, setScanGitUrl] = useState('');
  const [binarySubMode, setBinarySubMode] = useState<'upload' | 'image'>('upload');
  const [binaryImageName, setBinaryImageName] = useState('');

  const [scanLabel, setScanLabel] = useState('');
  const [policyProfile, setPolicyProfile] = useState('regulated_bfsi');
  const [scenario, setScenario] = useState('baseline');
  const [scannerType, setScannerType] = useState('combined');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
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
        let scanRes: any;
        if (scanType === 'static') {
          if (staticSubMode === 'git') {
            if (!scanGitUrl.trim()) throw new Error('Please provide a Git repository URL.');
            scanRes = await api.triggerStaticScan(undefined, {
              github_url: scanGitUrl.trim(),
              scan_label: scanLabel.trim() || undefined,
              policy_profile: policyProfile,
              scenario,
            });
          } else {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="glass-card max-w-xl w-full p-6 border border-slate-700/80 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Close modal"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
            <Upload size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Cryptographic Discovery & Ingestion</h3>
            <p className="text-xs text-slate-400">Run a live scan or ingest CycloneDX CBOM for quantum risk assessment</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Input Mode Switcher */}
          <div className="flex rounded-lg bg-slate-900 p-1 border border-slate-800">
            <button
              type="button"
              onClick={() => setMode('scan')}
              className={`flex-1 py-1.5 rounded-md font-medium transition-all ${
                mode === 'scan'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Live Scanner
            </button>
            <button
              type="button"
              onClick={() => setMode('file')}
              className={`flex-1 py-1.5 rounded-md font-medium transition-all ${
                mode === 'file'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              File Upload
            </button>
            <button
              type="button"
              onClick={() => setMode('text')}
              className={`flex-1 py-1.5 rounded-md font-medium transition-all ${
                mode === 'text'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Paste JSON
            </button>
          </div>

          {/* Mode 1: Live Scanner Trigger */}
          {mode === 'scan' && (
            <div className="space-y-3 bg-slate-950/50 p-4 rounded-xl border border-slate-800">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScanType('network')}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-semibold text-2xs uppercase tracking-wider transition-all border ${
                    scanType === 'network'
                      ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Network TLS
                </button>
                <button
                  type="button"
                  onClick={() => setScanType('static')}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-semibold text-2xs uppercase tracking-wider transition-all border ${
                    scanType === 'static'
                      ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Static Code
                </button>
                <button
                  type="button"
                  onClick={() => setScanType('binary')}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-semibold text-2xs uppercase tracking-wider transition-all border ${
                    scanType === 'binary'
                      ? 'bg-blue-500/20 border-blue-500/60 text-blue-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Binary / Container
                </button>
              </div>

              {scanType === 'network' && (
                <div className="space-y-2">
                  <label className="block text-slate-400 font-medium">Target URL or Hostname</label>
                  <div className="relative flex items-center">
                    <Globe className="w-4 h-4 text-emerald-400 absolute left-3 pointer-events-none" />
                    <input
                      type="text"
                      value={scanTarget}
                      onChange={(e) => setScanTarget(e.target.value)}
                      placeholder="e.g. https://api.yourdomain.com or 192.168.1.1"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 font-mono text-xs"
                    />
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
                        staticSubMode === 'upload' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400'
                      }`}
                    >
                      Upload Project (.ZIP)
                    </button>
                    <button
                      type="button"
                      onClick={() => setStaticSubMode('git')}
                      className={`px-2.5 py-1 rounded text-2xs font-medium transition-all ${
                        staticSubMode === 'git' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400'
                      }`}
                    >
                      Git Repository URL
                    </button>
                  </div>

                  {staticSubMode === 'upload' ? (
                    <div>
                      <label className="w-full flex items-center justify-between bg-slate-900 border border-dashed border-slate-700 hover:border-cyan-500/60 rounded-lg px-3 py-2.5 text-xs text-slate-300 cursor-pointer">
                        <div className="flex items-center gap-2 truncate">
                          <Upload className="w-4 h-4 text-cyan-400 shrink-0" />
                          <span className="truncate">
                            {scanUploadFile ? scanUploadFile.name : 'Select project .ZIP or source archive'}
                          </span>
                        </div>
                        <span className="text-2xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700 font-medium">
                          Browse
                        </span>
                        <input
                          type="file"
                          accept=".zip,.c,.h,.cpp,.hpp,.go,.js,.py"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setScanUploadFile(e.target.files[0]);
                            }
                          }}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={scanGitUrl}
                        onChange={(e) => setScanGitUrl(e.target.value)}
                        placeholder="e.g. https://github.com/org/repo.git"
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500 font-mono text-xs"
                      />
                      <p className="text-[11px] text-slate-500">ECDAT will shallow-clone and discover AST cryptographic call sites.</p>
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
                        binarySubMode === 'upload' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'text-slate-400'
                      }`}
                    >
                      Upload Binary (.ZIP/.jar/.bin)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBinarySubMode('image')}
                      className={`px-2.5 py-1 rounded text-2xs font-medium transition-all ${
                        binarySubMode === 'image' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'text-slate-400'
                      }`}
                    >
                      Container Image
                    </button>
                  </div>

                  {binarySubMode === 'upload' ? (
                    <div>
                      <label className="w-full flex items-center justify-between bg-slate-900 border border-dashed border-slate-700 hover:border-blue-500/60 rounded-lg px-3 py-2.5 text-xs text-slate-300 cursor-pointer">
                        <div className="flex items-center gap-2 truncate">
                          <Upload className="w-4 h-4 text-blue-400 shrink-0" />
                          <span className="truncate">
                            {scanUploadFile ? scanUploadFile.name : 'Select .ZIP, .jar, .dll, or binary executable'}
                          </span>
                        </div>
                        <span className="text-2xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700 font-medium">
                          Browse
                        </span>
                        <input
                          type="file"
                          accept=".zip,.jar,.tar,.so,.dll,.exe,.bin"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setScanUploadFile(e.target.files[0]);
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
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500 font-mono text-xs"
                      />
                      <p className="text-[11px] text-slate-500">Catalogs package libraries, dependencies, and CPE identifiers using Syft.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Mode 2: File Drag & Drop */}
          {mode === 'file' && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-slate-700/80 hover:border-cyan-500/60 rounded-xl p-6 text-center transition-colors bg-slate-950/40"
            >
              <input
                type="file"
                id="cbom-file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="hidden"
              />
              <label htmlFor="cbom-file" className="cursor-pointer block">
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-cyan-300">
                    <FileCode size={24} className="text-cyan-400" />
                    <span className="font-semibold truncate max-w-[280px]">{file.name}</span>
                    <span className="text-slate-500 text-[11px]">({(file.size / 1024).toFixed(1)} KB)</span>
                  </div>
                ) : (
                  <>
                    <Upload size={28} className="mx-auto text-slate-500 mb-2" />
                    <p className="font-semibold text-slate-200">Click to browse or drag CycloneDX JSON here</p>
                    <p className="text-slate-500 mt-1">Supports CycloneDX v1.4, v1.5, v1.6</p>
                  </>
                )}
              </label>
            </div>
          )}

          {/* Mode 3: Paste Raw JSON */}
          {mode === 'text' && (
            <div>
              <label className="block text-slate-300 font-medium mb-1">CycloneDX JSON Payload</label>
              <textarea
                rows={6}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder='{"bomFormat": "CycloneDX", "specVersion": "1.6", "components": [...]}'
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500/80"
              />
            </div>
          )}

          {/* Configuration Form */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Scan Target / Label</label>
              <input
                type="text"
                value={scanLabel}
                onChange={(e) => setScanLabel(e.target.value)}
                placeholder="e.g. Production Infrastructure Scan"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Policy Profile</label>
              <select
                value={policyProfile}
                onChange={(e) => setPolicyProfile(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="regulated_bfsi">Regulated BFSI (Strict)</option>
                <option value="public_internet">Public Internet</option>
                <option value="internal_enterprise">Internal Enterprise</option>
                <option value="government_high_value">Government High Value</option>
                <option value="iot_ot">IoT / OT Device</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Mosca Scenario</label>
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="baseline">Baseline (9 yr horizon)</option>
                <option value="conservative">Conservative (7 yr horizon)</option>
                <option value="optimistic">Optimistic (12 yr horizon)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Scanner Type</label>
              <select
                value={scannerType}
                onChange={(e) => setScannerType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="combined">Combined Multi-Scanner</option>
                <option value="network">Network (TLS / SSLyze)</option>
                <option value="static">Static Code (Tree-sitter AST)</option>
                <option value="binary_container">Binary / Syft Container</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || (mode === 'file' && !file) || (mode === 'text' && !jsonText.trim()) || (mode === 'scan' && !scanTarget.trim())}
              className="px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
