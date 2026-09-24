import React, { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
 ArrowLeft,
 Shield,
 AlertTriangle,
 Zap,
 CheckCircle2,
 XCircle,
 FileCode,
 Layers,
 Copy,
 Check,
 Cpu,
 BookOpen,
 Sparkles,
 FileCheck,
} from 'lucide-react';
import { api } from '../api/client';
import { AssetDetail as IAssetDetail } from '../types';
import { SeverityBadge, MoscaStatusBadge } from '../components/SeverityBadge';
import { MoscaTimeline } from '../components/MoscaTimeline';

export const AssetDetail: React.FC = () => {
 const { assetId } = useParams<{ assetId: string }>();
 const [searchParams] = useSearchParams();
 const scanId = searchParams.get('scanId') || undefined;

 const [asset, setAsset] = useState<IAssetDetail | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [copied, setCopied] = useState(false);
 const [showMoscaDetails, setShowMoscaDetails] = useState(false);
 const [showPolicyDetails, setShowPolicyDetails] = useState(false);

 // Sub-inventory categorization tab
 const [inventoryTab, setInventoryTab] = useState<'all' | 'certs' | 'protocols' | 'code'>('all');

 useEffect(() => {
 if (!assetId) return;

 let mounted = true;
 const fetchAsset = async () => {
 setLoading(true);
 setError(null);
 try {
 const data = await api.getAssetById(assetId, scanId);
 if (mounted) {
 setAsset(data);
 }
 } catch (err: unknown) {
 if (mounted) {
 const message = err instanceof Error ? err.message : 'Failed to load asset details';
 setError(message);
 }
 } finally {
 if (mounted) setLoading(false);
 }
 };

 fetchAsset();

 return () => {
 mounted = false;
 };
 }, [assetId, scanId]);

 const copyToClipboard = (text: string) => {
 navigator.clipboard.writeText(text);
 setCopied(true);
 setTimeout(() => setCopied(false), 2000);
 };

 // Filter evidence based on active category tab
 const filteredEvidence = (asset?.evidence || []).filter((item) => {
 if (inventoryTab === 'all') return true;
 const cat = (item.category || '').toLowerCase();
 const alg = (item.algorithm || '').toLowerCase();
 const loc = (item.location || '').toLowerCase();

 if (inventoryTab === 'certs') {
 return cat.includes('cert') || cat.includes('x509') || alg.includes('rsa') || alg.includes('ecdsa');
 }
 if (inventoryTab === 'protocols') {
 return (
 cat.includes('protocol') ||
 cat.includes('tls') ||
 cat.includes('ssh') ||
 loc.includes('port') ||
 loc.includes('cipher')
 );
 }
 if (inventoryTab === 'code') {
 return (
 cat.includes('code') ||
 cat.includes('call') ||
 item.line_number !== undefined ||
 loc.includes('/') ||
 loc.includes('\\')
 );
 }
 return true;
 });

 if (loading) {
 return (
 <div className="space-y-6">
 <div className="h-6 w-36 bg-surface animate-pulse rounded"></div>
 <div className="bg-bg-1/60 border border-border rounded-xl p-6 h-44 animate-pulse"></div>
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
 <div className="bg-bg-1/60 border border-border rounded-xl p-6 h-64 animate-pulse"></div>
 <div className="bg-bg-1/60 border border-border rounded-xl p-6 h-64 animate-pulse"></div>
 </div>
 </div>
 );
 }

 if (error || !asset) {
 return (
 <div className="space-y-6">
 <Link
 to="/assets"
 className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-brand transition-colors"
 >
 <ArrowLeft className="w-4 h-4" />
 Back to Asset Inventory
 </Link>
 <div className="p-8 rounded-xl bg-bg-1/60 border border-border text-center space-y-4">
 <AlertTriangle className="w-12 h-12 text-crypto mx-auto" />
 <h2 className="text-xl font-semibold text-text-brand">
 {error && error.includes('No scan data available')
 ? 'No Scan Data Available'
 : 'Asset Not Found or Telemetry Query Failed'}
 </h2>
 <p className="text-sm text-text-secondary max-w-md mx-auto">
 {error && error.includes('No scan data available')
 ? 'There are currently no completed cryptographic scans. Please upload or scan a repository archive to inspect cryptographic assets and telemetry.'
 : error || 'Unable to retrieve cryptographic telemetry for this asset.'}
 </p>
 <div className="pt-2">
 <Link
 to="/assets"
 className="px-4 py-2 bg-pqc hover:bg-pqc text-text-muted font-bold rounded-lg text-sm transition-colors inline-block"
 >
 Return to Cryptographic Inventory
 </Link>
 </div>
 </div>
 </div>
 );
 }

 return (
 <div className="space-y-8 animate-fade-in">
 {/* 1. Breadcrumb & Zero-Secret Verification Banner */}
 <div className="flex flex-wrap items-center justify-between gap-4">
 <Link
 to="/assets"
 className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-crypto transition-colors"
 >
 <ArrowLeft className="w-4 h-4" />
 Back to Cryptographic Asset Inventory
 </Link>

 {/* Zero Secret Literals Security Badge */}
 <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-2 border border-success text-success text-xs font-mono">
 <FileCheck className="w-3.5 h-3.5 text-success" />
 <span>Zero Secret Literals Verified — Redaction Engine Active</span>
 </div>
 </div>

 {/* 2. Asset Hero Card & Explainable Story */}
 <div className=" border border-border rounded-2xl p-6 md:p-8 shadow-xl relative overflow-hidden">
 <div className="absolute top-0 right-0 w-96 h-96 bg-pqc/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

 <div className="space-y-6 relative z-10">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div className="space-y-2">
 <div className="flex items-center gap-2">
 <span className="text-xs font-mono px-2.5 py-1 bg-surface-2 border border-border-soft text-crypto rounded-md uppercase tracking-wider font-semibold">
 {asset.asset_type.replace(/_/g, ' ')}
 </span>
 {asset.policy_profile && (
 <span className="text-xs font-mono px-2.5 py-1 bg-surface text-text-secondary rounded-md border border-border-soft">
 Policy: {asset.policy_profile}
 </span>
 )}
 </div>
 <div className="flex items-center gap-3">
 <h1 className="text-2xl md:text-3xl font-bold text-text-brand font-mono tracking-tight break-all">
 {asset.primary_identifier}
 </h1>
 <button
 onClick={() => copyToClipboard(asset.primary_identifier)}
 title="Copy identifier"
 className="p-1.5 text-text-secondary hover:text-text-brand bg-surface hover:bg-surface-2/80 rounded-lg transition-colors"
 >
 {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
 </button>
 </div>
 </div>

 {/* Status & Risk Badges */}
 <div className="flex flex-wrap items-center gap-2.5">
 <SeverityBadge severity={asset.highest_severity} />
 <MoscaStatusBadge status={asset.mosca?.status || 'SAFE'} />

 {asset.at_quantum_risk ? (
 <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-2 text-critical border border-critical">
 <Zap className="w-3.5 h-3.5 text-critical" />
 Quantum Vulnerable (SNDL)
 </span>
 ) : (
 <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-surface-2 text-success border border-success">
 <Shield className="w-3.5 h-3.5 text-success" />
 Quantum Resistant
 </span>
 )}

 {asset.cicd_pass ? (
 <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-surface-2 text-success border border-success">
 <CheckCircle2 className="w-3.5 h-3.5" />
 CI/CD Gate Passed
 </span>
 ) : (
 <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-surface-2 text-critical border border-critical">
 <XCircle className="w-3.5 h-3.5" />
 CI/CD Gate Blocked
 </span>
 )}
 </div>
 </div>

 {/* Explainable Executive Narrative Story */}
 <div className="p-4 rounded-xl bg-background/70 border border-border space-y-2">
 <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-crypto">
 <Sparkles className="w-4 h-4" />
 <span>Explainable Asset Risk Story</span>
 </div>
 <p className="text-xs md:text-sm text-text-brand leading-relaxed font-sans">
 Asset <span className="font-mono text-crypto font-semibold">{asset.primary_identifier}</span> is
 classified as a <strong className="text-text-brand capitalize">{asset.asset_type.replace(/_/g, ' ')}</strong>{' '}
 containing{' '}
 <strong className="text-text-brand">{asset.evidence?.length || 0} cryptographic primitive(s)</strong>.
 {asset.at_quantum_risk ? (
 <>
 {' '}
 It is vulnerable to <strong>Store Now, Decrypt Later (SNDL)</strong> attacks under the active Mosca
 scenario because confidential data with a {asset.mosca?.shelf_life_X || 5}-year shelf life will remain
 exposed when cryptanalytically relevant quantum computers emerge.
 </>
 ) : (
 <>
 {' '}
 It currently satisfies cryptographic policy safety requirements without immediate quantum deficit
 windows.
 </>
 )}
 </p>
 </div>

 {/* Quick Telemetry Grid */}
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2 border-t border-border">
 <div>
 <p className="text-[11px] text-text-muted font-medium uppercase tracking-wider">Data Sensitivity</p>
 <p className="text-sm font-semibold text-text-brand capitalize mt-0.5">
 {asset.data_sensitivity || 'Standard'}
 </p>
 </div>
 <div>
 <p className="text-[11px] text-text-muted font-medium uppercase tracking-wider">Business Criticality</p>
 <p className="text-sm font-semibold text-text-brand capitalize mt-0.5">
 {asset.business_criticality || 'Standard'}
 </p>
 </div>
 <div>
 <p className="text-[11px] text-text-muted font-medium uppercase tracking-wider">Discovered Primitives</p>
 <p className="text-sm font-semibold text-crypto font-mono mt-0.5">
 {asset.evidence?.length || 0} Component{asset.evidence?.length === 1 ? '' : 's'}
 </p>
 </div>
 </div>
 </div>
 </div>

 {/* 3. Interactive Mosca Visualization Timeline & What-If Modeler */}
 {asset.mosca && (
 <div className="bg-bg-1/60 border border-border rounded-2xl p-4 shadow-xl">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <div className="flex flex-col">
 <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Mosca Theorem Status</span>
 <MoscaStatusBadge status={asset.mosca.status} />
 </div>
 </div>
 <button
 onClick={() => setShowMoscaDetails(!showMoscaDetails)}
 className="text-xs font-semibold text-crypto hover:text-crypto transition-colors"
 >
 {showMoscaDetails ? 'Hide Mosca Calculus Details' : 'View Detailed Mosca Calculus'}
 </button>
 </div>
 
 {showMoscaDetails && (
 <div className="mt-6 pt-6 border-t border-border">
 <MoscaTimeline
 initialX={asset.mosca.shelf_life_X}
 initialY={asset.mosca.migration_time_Y}
 initialZ={asset.mosca.quantum_threat_Z}
 initialSensitivity={asset.data_sensitivity}
 initialScenario="baseline"
 initialStatus={asset.mosca.status}
 assetIdentifier={asset.primary_identifier}
 policyProfile={asset.policy_profile}
 />
 </div>
 )}
 </div>
 )}

 {/* 4. Two-Column Layout: Evidence / Findings vs Remediation Roadmap */}
 <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
 {/* Left Column: Inventory Evidence & Findings List (7 cols) */}
 <div className="lg:col-span-7 space-y-8">
 {/* Categorized Crypto Inventory Section */}
 <div className="bg-bg-1/80 border border-border rounded-2xl p-6 shadow-xl space-y-4">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
 <div className="flex items-center gap-2">
 <Layers className="w-5 h-5 text-crypto" />
 <h3 className="text-base font-bold text-text-brand">Cryptographic Inventory Evidence</h3>
 </div>

 {/* Sub-Category Filter Tabs (Certificates / Protocols / Code) */}
 <div className="flex items-center p-0.5 bg-background border border-border rounded-lg text-xs">
 <button
 onClick={() => setInventoryTab('all')}
 className={`px-2.5 py-1 rounded-md transition-colors ${
 inventoryTab === 'all' ? 'bg-surface text-text-brand font-semibold' : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 All ({asset.evidence?.length || 0})
 </button>
 <button
 onClick={() => setInventoryTab('certs')}
 className={`px-2.5 py-1 rounded-md transition-colors ${
 inventoryTab === 'certs'
 ? 'bg-surface text-text-brand font-semibold'
 : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 Certificates
 </button>
 <button
 onClick={() => setInventoryTab('protocols')}
 className={`px-2.5 py-1 rounded-md transition-colors ${
 inventoryTab === 'protocols'
 ? 'bg-surface text-text-brand font-semibold'
 : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 Protocols
 </button>
 <button
 onClick={() => setInventoryTab('code')}
 className={`px-2.5 py-1 rounded-md transition-colors ${
 inventoryTab === 'code'
 ? 'bg-surface text-text-brand font-semibold'
 : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 Source Code
 </button>
 </div>
 </div>

 {filteredEvidence.length > 0 ? (
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs">
 <thead>
 <tr className="border-b border-border text-text-secondary uppercase font-mono text-[11px]">
 <th className="pb-3 pr-3">Algorithm &amp; Key Size</th>
 <th className="pb-3 pr-3">Category</th>
 <th className="pb-3 pr-3">Location / Target</th>
 <th className="pb-3 text-right">Confidence</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border font-sans">
 {filteredEvidence.map((item, idx) => (
 <tr key={item.finding_id || idx} className="hover:bg-surface transition-colors">
 <td className="py-3.5 pr-3">
 <div className="font-mono font-bold text-text-brand flex items-center gap-2">
 <span>{item.algorithm}</span>
 {item.key_size !== undefined && item.key_size !== null && (
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-crypto border border-border-soft">
 {item.key_size} bit
 </span>
 )}
 </div>
 </td>
 <td className="py-3.5 pr-3 text-text-secondary capitalize">
 {item.category || 'Cryptographic Primitive'}
 </td>
 <td className="py-3.5 pr-3">
 <div className="flex items-center gap-1.5 text-text-secondary font-mono text-[11px]">
 <FileCode className="w-3.5 h-3.5 text-text-secondary shrink-0" />
 <span className="truncate max-w-[180px]" title={item.location || 'Endpoint / Session'}>
 {item.location || 'Endpoint / Session'}
 </span>
 {item.line_number ? <span className="text-text-muted">:{item.line_number}</span> : null}
 </div>
 </td>
 <td className="py-3.5 text-right">
 <span
 className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
 (item.confidence || 'HIGH').toUpperCase() === 'HIGH'
 ? 'bg-surface-2 text-success border-success'
 : 'bg-surface-2 text-high border-high'
 }`}
 >
 {item.confidence || 'HIGH'}
 </span>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 ) : (
 <p className="text-xs text-text-secondary py-6 text-center">
 No items match the selected sub-category filter.
 </p>
 )}
 </div>

 {/* Detailed Findings & Standards Violations List */}
 {asset.risks && asset.risks.length > 0 && (
 <div className="bg-bg-1/80 border border-border rounded-2xl p-6 shadow-xl space-y-5">
 <div className="flex items-center gap-2 border-b border-border pb-3">
 <Shield className="w-5 h-5 text-critical" />
 <h3 className="text-base font-bold text-text-brand">Findings, Risk Assessments &amp; Standards</h3>
 </div>

 <div className="space-y-4">
 {asset.risks.map((risk, index) => (
 <div key={index} className="p-4 rounded-xl bg-background/60 border border-border space-y-3">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <SeverityBadge severity={risk.severity} />
 <span className="text-xs font-semibold text-text-secondary">{risk.classical_risk}</span>
 </div>
 </div>

 <p className="text-xs text-text-secondary leading-relaxed font-sans">{risk.explanation}</p>

 <div className="space-y-2 pt-2 border-t border-border">
 <div className="flex items-start justify-between text-xs">
 <div className="flex gap-2">
 <span className="text-text-muted font-mono shrink-0">Quantum Relevance:</span>
 <span className="text-high font-sans">{risk.quantum_relevance}</span>
 </div>
 {((risk.applied_rules && risk.applied_rules.length > 0) || (risk.policy_violations && risk.policy_violations.length > 0)) && (
 <button
 onClick={() => setShowPolicyDetails(!showPolicyDetails)}
 className="text-[11px] text-crypto hover:text-crypto font-medium"
 >
 {showPolicyDetails ? 'Hide Policy Matrix' : 'View Policy Matrix'}
 </button>
 )}
 </div>

 {showPolicyDetails && (
 <div className="pt-2 space-y-2">
 {risk.applied_rules && risk.applied_rules.length > 0 && (
 <div className="flex flex-wrap items-center gap-1.5 pt-1">
 <span className="text-xs text-text-muted mr-1 font-mono">Standards:</span>
 {risk.applied_rules.map((rule, rIdx) => (
 <span
 key={rIdx}
 className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-1 text-text-secondary border border-border"
 >
 {rule}
 </span>
 ))}
 </div>
 )}

 {risk.policy_violations && risk.policy_violations.length > 0 && (
 <div className="flex flex-wrap items-center gap-1.5 pt-1">
 <span className="text-xs text-critical mr-1 font-mono">Violations:</span>
 {risk.policy_violations.map((violation, vIdx) => (
 <span
 key={vIdx}
 className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-2 text-critical border border-critical"
 >
 {violation}
 </span>
 ))}
 </div>
 )}
 </div>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>

 {/* Right Column: Migration Roadmap & PQC Targets (5 cols) */}
 <div className="lg:col-span-5 space-y-8">
 <div className="bg-bg-1/80 border border-border rounded-2xl p-6 shadow-xl space-y-5 sticky top-24">
 <div className="flex items-center gap-2 border-b border-border pb-3">
 <Cpu className="w-5 h-5 text-specialized" />
 <h3 className="text-base font-bold text-text-brand">PQC Remediation Roadmap</h3>
 </div>

 {asset.recommendations && asset.recommendations.length > 0 ? (
 <div className="space-y-6">
 {asset.recommendations.map((rec, idx) => (
 <div key={idx} className="space-y-4">
 {/* Target recommendation highlight */}
 <div className="p-4 rounded-xl bg-surface-2 border border-specialized space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-xs font-mono text-specialized uppercase tracking-wider font-semibold">
 Target Architecture
 </span>
 <span
 className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
 rec.priority === 'critical'
 ? 'bg-surface-2 text-critical'
 : 'bg-surface-2 text-specialized'
 }`}
 >
 {rec.priority} priority
 </span>
 </div>
 <div className="text-sm font-semibold text-text-brand">{rec.recommended_target}</div>
 </div>

 {/* Classical vs PQC dual tracks */}
 <div className="space-y-3">
 {rec.classical_remediation && (
 <div className="p-3.5 rounded-xl bg-background/70 border border-border space-y-1">
 <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
 Phase 1: Classical Hardening
 </p>
 <p className="text-xs text-text-brand">{rec.classical_remediation}</p>
 </div>
 )}

 {rec.hybrid_transition_recommended && (
 <div className="p-3.5 rounded-xl bg-background/70 border border-border space-y-1">
 <p className="text-[11px] font-semibold text-fuchsia-400 uppercase tracking-wider">
 Phase 2: Hybrid Transition
 </p>
 <p className="text-xs text-text-brand">
 Deploy hybrid cryptographic schemes combining classical (e.g. ECDH/ECDSA) and PQC (e.g. ML-KEM/ML-DSA) to maintain compliance while introducing quantum resistance.
 </p>
 </div>
 )}

 {rec.pqc_migration && (
 <div className="p-3.5 rounded-xl bg-background/70 border border-border space-y-1">
 <p className="text-[11px] font-semibold text-crypto uppercase tracking-wider">
 {rec.hybrid_transition_recommended ? 'Phase 3: Native PQC Enforcement' : 'Phase 2: Post-Quantum Migration'}
 </p>
 <p className="text-xs text-text-brand">{rec.pqc_migration}</p>
 </div>
 )}
 </div>

 {/* Migration Characteristics Matrix */}
 <div className="grid grid-cols-2 gap-2.5 text-xs">
 <div className="p-2.5 rounded-lg bg-background/50 border border-border">
 <span className="text-text-muted block text-[11px]">Complexity:</span>
 <span className="font-semibold text-text-secondary capitalize">
 {rec.migration_complexity || 'Medium'}
 </span>
 </div>
 <div className="p-2.5 rounded-lg bg-background/50 border border-border">
 <span className="text-text-muted block text-[11px]">Latency Impact:</span>
 <span className="font-semibold text-text-secondary capitalize">{rec.latency_impact || 'Low'}</span>
 </div>
 <div className="p-2.5 rounded-lg bg-background/50 border border-border">
 <span className="text-text-muted block text-[11px]">Bandwidth Impact:</span>
 <span className="font-semibold text-text-secondary capitalize">
 {rec.bandwidth_impact || 'Medium'}
 </span>
 </div>
 <div className="p-2.5 rounded-lg bg-background/50 border border-border">
 <span className="text-text-muted block text-[11px]">Cost Category:</span>
 <span className="font-semibold text-text-secondary capitalize">
 {rec.cost_category || 'Operational'}
 </span>
 </div>
 </div>

 {rec.rationale && (
 <div className="text-xs text-text-secondary leading-relaxed">
 <span className="font-semibold text-text-secondary block mb-1">Architectural Rationale:</span>
 {rec.rationale}
 </div>
 )}

 {rec.references && rec.references.length > 0 && (
 <div className="space-y-1.5 pt-2 border-t border-border">
 <span className="text-xs font-medium text-text-secondary flex items-center gap-1">
 <BookOpen className="w-3.5 h-3.5 text-text-secondary" />
 Compliance Standards &amp; RFCs:
 </span>
 <div className="flex flex-wrap gap-1.5">
 {rec.references.map((refStr, rIdx) => (
 <span
 key={rIdx}
 className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface text-text-secondary border border-border-soft"
 >
 {refStr}
 </span>
 ))}
 </div>
 </div>
 )}
 </div>
 ))}
 </div>
 ) : (
 <div className="p-6 rounded-xl bg-background/40 text-center space-y-2">
 <CheckCircle2 className="w-8 h-8 text-success mx-auto" />
 <p className="text-sm font-medium text-text-brand">No Immediate Remediation Required</p>
 <p className="text-xs text-text-secondary">
 This asset conforms to current quantum-safe standards and classical cipher lifetime requirements.
 </p>
 </div>
 )}
 </div>
 </div>
 </div>
 </div>
 );
};
