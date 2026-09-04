import React, { useState } from 'react';
import { Upload, X, FileCode, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
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
  const [mode, setMode] = useState<'file' | 'text'>('file');
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
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to upload CBOM.');
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
            <h3 className="text-lg font-bold text-white">Ingest CycloneDX CBOM</h3>
            <p className="text-xs text-slate-400">Upload cryptography bill of materials for risk and Mosca analysis</p>
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

          {/* Mode 1: File Drag & Drop */}
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

          {/* Mode 2: Paste Raw JSON */}
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
                placeholder="e.g. Production Ingress Gateway"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Scanner Source</label>
              <select
                value={scannerType}
                onChange={(e) => setScannerType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="combined">Combined Multi-Scanner</option>
                <option value="network">Network (SSLyze / TLS)</option>
                <option value="static">Static Code (Tree-sitter AST)</option>
                <option value="binary_container">Binary / Syft Container</option>
              </select>
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
              disabled={loading || (mode === 'file' && !file) || (mode === 'text' && !jsonText.trim())}
              className="px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Ingesting...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  <span>Ingest & Assess Risk</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
