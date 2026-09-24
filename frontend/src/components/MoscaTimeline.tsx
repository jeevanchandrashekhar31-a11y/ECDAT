import React, { useState, useMemo } from 'react';
import {
 Clock,
 RotateCcw,
 Sliders,
 ShieldAlert,
 AlertTriangle,
 ShieldCheck,
 Zap,
 Info,
 Layers,
 Sparkles,
} from 'lucide-react';
import { MoscaStatus } from '../types';

export interface MoscaTimelineProps {
 initialX: number;
 initialY: number;
 initialZ: number;
 initialSensitivity?: string;
 initialScenario?: 'conservative' | 'baseline' | 'optimistic';
 initialStatus?: MoscaStatus;
 assetIdentifier?: string;
 policyProfile?: string;
 isIntegrityOnly?: boolean;
}

// Sensitivity map adhering to mosca_config.json
const SENSITIVITY_CONFIG: Record<string, { label: string; defaultX: number; description: string }> = {
 public: {
 label: 'Public',
 defaultX: 0,
 description: 'No confidentiality shelf-life requirement (X = 0y)',
 },
 internal: {
 label: 'Internal',
 defaultX: 3,
 description: 'Standard enterprise business data (shelf-life 3y)',
 },
 confidential: {
 label: 'Confidential',
 defaultX: 7,
 description: 'Proprietary IP, customer PII & credentials (shelf-life 7y)',
 },
 restricted: {
 label: 'Restricted',
 defaultX: 15,
 description: 'Critical secrets, healthcare & banking ledgers (shelf-life 15y)',
 },
};

// Scenario map adhering to mosca_config.json
const SCENARIO_CONFIG: Record<
 'conservative' | 'baseline' | 'optimistic',
 { label: string; Z: number; horizonYear: number; description: string }
> = {
 conservative: {
 label: 'Conservative',
 Z: 5,
 horizonYear: 2031,
 description: 'Aggressive CRQC timeline (~2031) with migration drag',
 },
 baseline: {
 label: 'Baseline',
 Z: 9,
 horizonYear: 2035,
 description: 'Consensus timeline (~2035, CNSA 2.0 / BSI alignment)',
 },
 optimistic: {
 label: 'Optimistic',
 Z: 15,
 horizonYear: 2041,
 description: 'Delayed quantum threat (~2041) with rapid tooling',
 },
};

export const MoscaTimeline: React.FC<MoscaTimelineProps> = ({
 initialX,
 initialY,
 initialZ,
 initialSensitivity = 'confidential',
 initialScenario = 'baseline',
 assetIdentifier,
 policyProfile,
}) => {
 // Normalize initial sensitivity to known key
 const normalizedInitialSensitivity = useMemo(() => {
 const key = (initialSensitivity || 'confidential').toLowerCase();
 return SENSITIVITY_CONFIG[key] ? key : 'confidential';
 }, [initialSensitivity]);

 // Normalize initial scenario to known key
 const normalizedInitialScenario = useMemo(() => {
 const key = (initialScenario || 'baseline').toLowerCase() as 'conservative' | 'baseline' | 'optimistic';
 return SCENARIO_CONFIG[key] ? key : 'baseline';
 }, [initialScenario]);

 // Local what-if state
 const [localY, setLocalY] = useState<number>(initialY);
 const [localSensitivity, setLocalSensitivity] = useState<string>(normalizedInitialSensitivity);
 const [localScenario, setLocalScenario] = useState<'conservative' | 'baseline' | 'optimistic'>(
 normalizedInitialScenario
 );

 // Derive X based on sensitivity selection; if sensitivity unchanged, honor initialX
 const currentX = useMemo(() => {
 if (localSensitivity === normalizedInitialSensitivity) {
 return initialX;
 }
 return SENSITIVITY_CONFIG[localSensitivity]?.defaultX ?? initialX;
 }, [localSensitivity, normalizedInitialSensitivity, initialX]);

 // Derive Z based on scenario
 const currentZ = useMemo(() => {
 return SCENARIO_CONFIG[localScenario]?.Z ?? initialZ;
 }, [localScenario, initialZ]);

 // Exact calculations
 const totalXY = useMemo(() => {
 return Math.round((currentX + localY) * 10) / 10;
 }, [currentX, localY]);

 // Mosca margin: (X + Y) - Z
 // Positive value = Deficit (years exposed after CRQC emerges)
 // Negative value = Safe buffer remaining before CRQC
 const marginDeficit = useMemo(() => {
 return Math.round((totalXY - currentZ) * 10) / 10;
 }, [totalXY, currentZ]);

 // Safety buffer: Z - (X + Y)
 const safetyBuffer = useMemo(() => {
 return Math.round((currentZ - totalXY) * 10) / 10;
 }, [currentZ, totalXY]);

 // Determine dynamic Mosca status
 const currentStatus: MoscaStatus = useMemo(() => {
 if (marginDeficit > 2.5) {
 return 'CRITICAL_URGENT';
 }
 if (marginDeficit > 0) {
 return 'AT_RISK';
 }
 if (safetyBuffer <= 2.0) {
 return 'WATCH';
 }
 return 'SAFE';
 }, [marginDeficit, safetyBuffer]);

 // Check if current values differ from initial policy values
 const isSimulated = useMemo(() => {
 const yChanged = Math.abs(localY - initialY) > 0.05;
 const sensitivityChanged = localSensitivity !== normalizedInitialSensitivity;
 const scenarioChanged = localScenario !== normalizedInitialScenario;
 const xChanged = Math.abs(currentX - initialX) > 0.05;
 const zChanged = Math.abs(currentZ - initialZ) > 0.05;
 return yChanged || sensitivityChanged || scenarioChanged || xChanged || zChanged;
 }, [
 localY,
 initialY,
 localSensitivity,
 normalizedInitialSensitivity,
 localScenario,
 normalizedInitialScenario,
 currentX,
 initialX,
 currentZ,
 initialZ,
 ]);

 // Reset function
 const handleReset = () => {
 setLocalY(initialY);
 setLocalSensitivity(normalizedInitialSensitivity);
 setLocalScenario(normalizedInitialScenario);
 };

 // Timeline scale calculation (0 to maxYears)
 const maxScale = useMemo(() => {
 const highestVal = Math.max(totalXY, currentZ, 16);
 return Math.ceil((highestVal + 3) / 5) * 5; // round up to nearest 5
 }, [totalXY, currentZ]);

 // Percent conversion helper
 const getPercent = (val: number) => {
 const clamped = Math.max(0, Math.min(val, maxScale));
 return (clamped / maxScale) * 100;
 };

 const xPercent = getPercent(currentX);
 const totalPercent = getPercent(totalXY);
 const zPercent = getPercent(currentZ);

 // Status visual attributes
 const statusMeta = useMemo(() => {
 switch (currentStatus) {
 case 'CRITICAL_URGENT':
 return {
 label: 'CRITICAL URGENT',
 badgeClass: 'bg-critical/20 text-critical border-critical',
 gaugeColor: '#f43f5e',
 description: `Severe Exposure: Combined timeline (X + Y = ${totalXY}y) exceeds CRQC horizon (Z = ${currentZ}y) by ${marginDeficit} years. Immediate mitigation mandated.`,
 };
 case 'AT_RISK':
 return {
 label: 'AT RISK',
 badgeClass: 'bg-high/20 text-high border-high',
 gaugeColor: '#f59e0b',
 description: `Vulnerable to SNDL: Migration completes at ${totalXY}y, which is ${marginDeficit} years after estimated quantum decryption capability.`,
 };
 case 'WATCH':
 return {
 label: 'WATCH',
 badgeClass: 'bg-pqc/20 text-crypto border-pqc/40',
 gaugeColor: '#06b6d4',
 description: `Safety Buffer Narrowing: Only ${safetyBuffer} years remain before threat horizon. Migration planning should commence.`,
 };
 case 'SAFE':
 default:
 return {
 label: 'SAFE',
 badgeClass: 'bg-success/20 text-success border-success',
 gaugeColor: '#10b981',
 description: `Compliant: Robust quantum safety window of +${safetyBuffer} years before expected CRQC threat emergence.`,
 };
 }
 }, [currentStatus, totalXY, currentZ, marginDeficit, safetyBuffer]);

 // Generate scale ticks
 const ticks = useMemo(() => {
 const step = maxScale <= 15 ? 2 : maxScale <= 25 ? 5 : 5;
 const arr: number[] = [];
 for (let i = 0; i <= maxScale; i += step) {
 arr.push(i);
 }
 return arr;
 }, [maxScale]);

 return (
 <div className="bg-bg-1/90 border border-border rounded-2xl p-6 shadow-md space-y-6">
 {/* 1. Header with Mode Badge & Reset Action */}
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
 <div className="space-y-1">
 <div className="flex items-center gap-2.5">
 <div className="p-2 rounded-xl bg-surface-2 border border-border-soft text-crypto">
 <Clock className="w-5 h-5" />
 </div>
 <div>
 <div className="flex items-center gap-3">
 <h2 className="text-lg font-bold text-text-brand tracking-wide">Mosca Theorem Quantum Risk Engine</h2>
 {/* Visual Distinction: Stored vs Simulation Badge */}
 {isSimulated ? (
 <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-high/15 text-high border border-high shadow-sm animate-pulse">
 <Sparkles className="w-3.5 h-3.5 text-high" />
 Simulation only — not persisted
 </span>
 ) : (
 <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-surface text-text-secondary border border-border-soft">
 <ShieldCheck className="w-3.5 h-3.5 text-success" />
 Policy Assessed Values
 </span>
 )}
 </div>
 <p className="text-xs text-text-secondary mt-0.5">
 Evaluates harvest-now-decrypt-later (SNDL) exposure risk across quantum timeline horizons
 {assetIdentifier ? ` for ${assetIdentifier}` : ''}
 </p>
 </div>
 </div>
 </div>

 {/* Reset Action */}
 <div className="flex items-center gap-2 self-start sm:self-center">
 <button
 onClick={handleReset}
 disabled={!isSimulated}
 className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
 isSimulated
 ? 'bg-surface hover:bg-surface-2 text-text-brand border border-border-soft shadow-md cursor-pointer hover:text-text-brand'
 : 'bg-bg-1 text-text-muted border border-border cursor-not-allowed'
 }`}
 title="Reset all inputs back to original policy assessment values"
 >
 <RotateCcw className={`w-3.5 h-3.5 ${isSimulated ? 'text-crypto' : 'text-text-muted'}`} />
 <span>Reset to policy values</span>
 </button>
 </div>
 </div>

 {/* 2. Mandatory Core Mosca Explanation Banner */}
 <div className="p-4 rounded-xl border border-pqc relative overflow-hidden">
 <div className="absolute top-0 right-0 w-32 h-32 bg-pqc/5 rounded-full blur-2xl pointer-events-none"></div>
 <div className="flex items-start gap-3 relative z-10">
 <div className="p-1.5 rounded-lg bg-surface-2 border border-border-soft text-crypto shrink-0 mt-0.5">
 <Info className="w-4 h-4" />
 </div>
 <div className="space-y-1">
 <div className="text-sm font-semibold text-crypto">Fundamental Quantum Theorem:</div>
 <p className="text-xs md:text-sm text-text-brand font-medium leading-relaxed">
 <strong className="text-high font-mono tracking-wide">
 If X + Y &gt; Z, the asset may be exposed before migration completes.
 </strong>
 </p>
 <p className="text-xs text-text-secondary">
 When the combined duration of data confidentiality shelf-life (
 <code className="text-crypto font-mono">X</code>) and cryptographic migration time (
 <code className="text-specialized font-mono">Y</code>) exceeds the arrival horizon of a cryptanalytically
 relevant quantum computer (<code className="text-high font-mono">Z</code>), adversaries who record
 encrypted data today will decrypt it tomorrow.
 </p>
 </div>
 </div>
 </div>

 {/* 3. Numeric KPI Cards with Exact Values */}
 <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
 {/* X */}
 <div className="p-3.5 rounded-xl bg-background/70 border border-border space-y-1">
 <div className="flex items-center justify-between text-xs text-text-secondary">
 <span className="font-semibold uppercase tracking-wider">Shelf-Life (X)</span>
 <span className="text-[10px] font-mono text-crypto">Data Secrecy</span>
 </div>
 <div className="text-2xl font-bold font-mono text-crypto">
 {currentX.toFixed(1)} <span className="text-xs font-normal text-text-secondary">yrs</span>
 </div>
 <p className="text-[11px] text-text-muted truncate" title={SENSITIVITY_CONFIG[localSensitivity]?.description}>
 {SENSITIVITY_CONFIG[localSensitivity]?.label || 'Sensitivity'} tier
 </p>
 </div>

 {/* Y */}
 <div className="p-3.5 rounded-xl bg-background/70 border border-border space-y-1">
 <div className="flex items-center justify-between text-xs text-text-secondary">
 <span className="font-semibold uppercase tracking-wider">Migration (Y)</span>
 <span className="text-[10px] font-mono text-specialized">Deployment</span>
 </div>
 <div className="text-2xl font-bold font-mono text-specialized">
 {localY.toFixed(1)} <span className="text-xs font-normal text-text-secondary">yrs</span>
 </div>
 <p className="text-[11px] text-text-muted">
 {isSimulated && Math.abs(localY - initialY) > 0.05
 ? `Changed from ${initialY.toFixed(1)}y`
 : 'Policy migration baseline'}
 </p>
 </div>

 {/* X + Y */}
 <div className="p-3.5 rounded-xl bg-background/70 border border-border space-y-1">
 <div className="flex items-center justify-between text-xs text-text-secondary">
 <span className="font-semibold uppercase tracking-wider">Total (X + Y)</span>
 <span className="text-[10px] font-mono text-indigo-400">Exposure Sum</span>
 </div>
 <div className="text-2xl font-bold font-mono text-indigo-300">
 {totalXY.toFixed(1)} <span className="text-xs font-normal text-text-secondary">yrs</span>
 </div>
 <p className="text-[11px] text-text-muted">Total transition lifespan</p>
 </div>

 {/* Z */}
 <div className="p-3.5 rounded-xl bg-background/70 border border-border space-y-1">
 <div className="flex items-center justify-between text-xs text-text-secondary">
 <span className="font-semibold uppercase tracking-wider">Threat (Z)</span>
 <span className="text-[10px] font-mono text-high">Q-Day</span>
 </div>
 <div className="text-2xl font-bold font-mono text-high">
 {currentZ.toFixed(1)} <span className="text-xs font-normal text-text-secondary">yrs</span>
 </div>
 <p className="text-[11px] text-text-muted">~{SCENARIO_CONFIG[localScenario]?.horizonYear} horizon</p>
 </div>

 {/* Margin: (X + Y) - Z */}
 <div
 className={`p-3.5 rounded-xl border space-y-1 col-span-2 md:col-span-1 ${
 marginDeficit > 0
 ? 'bg-surface-2 border-critical text-critical'
 : safetyBuffer <= 2
 ? 'bg-surface-2 border-high text-high'
 : 'bg-surface-2 border-success text-success'
 }`}
 >
 <div className="flex items-center justify-between text-xs">
 <span className="font-semibold uppercase tracking-wider">Margin (X+Y)-Z</span>
 <span className="text-[10px] font-mono font-bold">{marginDeficit > 0 ? 'DEFICIT' : 'BUFFER'}</span>
 </div>
 <div className="text-2xl font-bold font-mono">
 {marginDeficit > 0 ? `+${marginDeficit.toFixed(1)}` : marginDeficit.toFixed(1)}{' '}
 <span className="text-xs font-normal">yrs</span>
 </div>
 <p className="text-[11px] opacity-80">
 {marginDeficit > 0 ? `Exposed for ${marginDeficit.toFixed(1)}y` : `Safe by ${safetyBuffer.toFixed(1)}y`}
 </p>
 </div>
 </div>

 {/* 4. Interactive Visual Timeline & Dual Bar Representation */}
 <div className="p-6 rounded-2xl bg-background/80 border border-border space-y-6">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex items-center gap-2">
 <Layers className="w-4 h-4 text-crypto" />
 <span className="text-xs font-bold text-text-brand uppercase tracking-wider">
 Comparative Lifespan Timeline (0 to {maxScale} Years)
 </span>
 </div>
 <div className="flex items-center gap-3 text-xs">
 <span className={`px-2.5 py-0.5 rounded-full font-bold border ${statusMeta.badgeClass}`}>
 {statusMeta.label}
 </span>
 <span className="text-text-secondary font-mono text-[11px]">
 Condition: {totalXY.toFixed(1)}y {totalXY > currentZ ? '>' : '<='} {currentZ.toFixed(1)}y
 </span>
 </div>
 </div>

 {/* Master SVG / Visual Bar Track */}
 <div className="space-y-6">
 {/* Timeline Bar Canvas */}
 <div className="relative pt-8 pb-4">
 {/* Timeline Ruler / Background Grid */}
 <div className="h-10 bg-bg-1/90 rounded-xl border border-border relative overflow-hidden flex items-center shadow-inner">
 {/* Scale graduation lines */}
 {ticks.map((tick) => {
 const leftPercent = (tick / maxScale) * 100;
 return (
 <div
 key={tick}
 className="absolute top-0 bottom-0 border-l border-border pointer-events-none"
 style={{ left: `${leftPercent}%` }}
 />
 );
 })}

 {/* Segment 1: Shelf-Life X (Cyan bar) */}
 <div
 className="h-full bg-brand to-cyan-500 opacity-90 transition-all duration-300 relative group flex items-center justify-center"
 style={{
 width: `${xPercent}%`,
 }}
 >
 {xPercent > 10 && (
 <span className="text-[11px] font-bold text-text-muted font-mono truncate px-1">
 X = {currentX.toFixed(1)}y
 </span>
 )}
 </div>

 {/* Segment 2: Migration Time Y (Purple bar) */}
 <div
 className="h-full bg-surface-2 opacity-90 transition-all duration-300 relative group flex items-center justify-center"
 style={{
 width: `${Math.max(0, totalPercent - xPercent)}%`,
 }}
 >
 {totalPercent - xPercent > 10 && (
 <span className="text-[11px] font-bold text-text-brand font-mono truncate px-1">
 Y = {localY.toFixed(1)}y
 </span>
 )}
 </div>

 {/* Deficit Window Indicator (if X + Y > Z) */}
 {totalXY > currentZ && (
 <div
 className="absolute top-0 bottom-0 bg-critical/25 border-y-2 border-critical animate-pulse flex items-center justify-center"
 style={{
 left: `${zPercent}%`,
 width: `${totalPercent - zPercent}%`,
 }}
 >
 <span className="text-[10px] font-mono font-black text-critical px-1 truncate drop-shadow">
 DEFICIT (+{marginDeficit.toFixed(1)}y)
 </span>
 </div>
 )}

 {/* Safe Buffer Window (if X + Y <= Z) */}
 {totalXY <= currentZ && (
 <div
 className="absolute top-0 bottom-0 bg-success/15 border-y border-success flex items-center justify-center"
 style={{
 left: `${totalPercent}%`,
 width: `${zPercent - totalPercent}%`,
 }}
 >
 <span className="text-[10px] font-mono font-semibold text-success px-1 truncate">
 BUFFER ({safetyBuffer.toFixed(1)}y)
 </span>
 </div>
 )}
 </div>

 {/* Marker for Quantum Threat Horizon (Z) */}
 <div
 className="absolute top-0 bottom-0 -ml-0.5 transition-all duration-300 pointer-events-none z-20 flex flex-col items-center"
 style={{ left: `${zPercent}%` }}
 >
 {/* Top Z Flag */}
 <div className="absolute -top-7 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-md bg-high text-text-muted font-bold font-mono text-[10px] whitespace-nowrap">
 <Zap className="w-3 h-3 text-text-muted fill-current" />
 <span>Z = {currentZ.toFixed(1)}y (CRQC)</span>
 </div>
 {/* Vertical line through bar */}
 <div className="w-0.5 h-full bg-high "></div>
 </div>

 {/* Marker for Total (X + Y) */}
 <div
 className="absolute top-0 bottom-0 -ml-0.5 transition-all duration-300 pointer-events-none z-20 flex flex-col items-center"
 style={{ left: `${totalPercent}%` }}
 >
 {/* Bottom (X+Y) Flag */}
 <div className="absolute -bottom-7 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600 text-text-brand font-bold font-mono text-[10px] whitespace-nowrap">
 <span>X+Y = {totalXY.toFixed(1)}y</span>
 </div>
 {/* Vertical line */}
 <div className="w-0.5 h-full bg-indigo-400 "></div>
 </div>
 </div>

 {/* Scale Axis & Tick Labels */}
 <div className="relative h-6 text-text-secondary font-mono text-[10px]">
 {ticks.map((tick) => {
 const leftPercent = (tick / maxScale) * 100;
 return (
 <div
 key={tick}
 className="absolute -translate-x-1/2 flex flex-col items-center"
 style={{ left: `${leftPercent}%` }}
 >
 <div className="w-0.5 h-1.5 bg-surface-2"></div>
 <span className="mt-1">{tick}y</span>
 </div>
 );
 })}
 </div>

 {/* Legend */}
 <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 pt-2 text-xs border-t border-border">
 <div className="flex items-center gap-2">
 <div className="w-3 h-3 rounded bg-pqc"></div>
 <span className="text-text-secondary">
 X: Confidentiality Lifetime (<strong className="text-text-brand font-mono">{currentX.toFixed(1)}y</strong>)
 </span>
 </div>
 <div className="flex items-center gap-2">
 <div className="w-3 h-3 rounded bg-specialized"></div>
 <span className="text-text-secondary">
 Y: Migration Duration (<strong className="text-text-brand font-mono">{localY.toFixed(1)}y</strong>)
 </span>
 </div>
 <div className="flex items-center gap-2">
 <div className="w-3 h-3 rounded bg-high"></div>
 <span className="text-text-secondary">
 Z: Threat Horizon (<strong className="text-text-brand font-mono">{currentZ.toFixed(1)}y</strong>)
 </span>
 </div>
 {totalXY > currentZ ? (
 <div className="flex items-center gap-2">
 <div className="w-3 h-3 rounded bg-critical/80 border border-critical animate-pulse"></div>
 <span className="text-critical font-semibold">
 Deficit Window (<strong className="font-mono">+{marginDeficit.toFixed(1)}y</strong>)
 </span>
 </div>
 ) : (
 <div className="flex items-center gap-2">
 <div className="w-3 h-3 rounded bg-success/80 border border-success"></div>
 <span className="text-success font-semibold">
 Safety Buffer (<strong className="font-mono">{safetyBuffer.toFixed(1)}y</strong>)
 </span>
 </div>
 )}
 </div>
 </div>

 {/* Qualitative Risk Status Explanation */}
 <div
 className={`p-4 rounded-xl border flex items-start gap-3 text-xs ${
 currentStatus === 'CRITICAL_URGENT'
 ? 'bg-surface-2 border-critical text-critical'
 : currentStatus === 'AT_RISK'
 ? 'bg-surface-2 border-high text-high'
 : currentStatus === 'WATCH'
 ? 'bg-surface-2 border-border-soft text-crypto'
 : 'bg-surface-2 border-success text-success'
 }`}
 >
 {currentStatus === 'CRITICAL_URGENT' ? (
 <ShieldAlert className="w-5 h-5 text-critical shrink-0 mt-0.5" />
 ) : currentStatus === 'AT_RISK' ? (
 <AlertTriangle className="w-5 h-5 text-high shrink-0 mt-0.5" />
 ) : currentStatus === 'WATCH' ? (
 <Clock className="w-5 h-5 text-crypto shrink-0 mt-0.5" />
 ) : (
 <ShieldCheck className="w-5 h-5 text-success shrink-0 mt-0.5" />
 )}
 <div className="space-y-1">
 <div className="font-bold uppercase tracking-wider">{statusMeta.label} — Dynamic Status Assessment</div>
 <p className="leading-relaxed text-text-brand">{statusMeta.description}</p>
 </div>
 </div>
 </div>

 {/* 5. What-If Interactive Controls Section */}
 <div className="p-6 rounded-2xl bg-background/80 border border-border space-y-6">
 <div className="flex items-center justify-between border-b border-border pb-3">
 <div className="flex items-center gap-2">
 <Sliders className="w-4 h-4 text-crypto" />
 <h3 className="text-sm font-bold text-text-brand uppercase tracking-wider">
 What-If Scenario &amp; Migration Modeler
 </h3>
 </div>
 <span className="text-[11px] text-text-secondary">Client-side interactive simulation (safe, non-destructive)</span>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 {/* Control 1: Adjust Migration Time Y */}
 <div className="space-y-3 p-4 rounded-xl bg-bg-1/60 border border-border">
 <div className="flex items-center justify-between">
 <label htmlFor="migration-slider" className="text-xs font-semibold text-text-secondary">
 Migration Time (Y)
 </label>
 <span className="text-sm font-bold font-mono text-specialized bg-surface-2 px-2 py-0.5 rounded border border-specialized">
 {localY.toFixed(1)} years
 </span>
 </div>

 {/* Slider */}
 <input
 id="migration-slider"
 type="range"
 min="0.5"
 max="12.0"
 step="0.5"
 value={localY}
 onChange={(e) => setLocalY(parseFloat(e.target.value))}
 className="w-full h-2 bg-surface rounded-lg appearance-none cursor-pointer accent-purple-500"
 />

 {/* Quick Adjust Buttons */}
 <div className="flex items-center justify-between gap-1 pt-1">
 <button
 type="button"
 onClick={() => setLocalY((prev) => Math.max(0.5, Math.round((prev - 1.0) * 10) / 10))}
 className="px-2 py-1 bg-surface hover:bg-surface-2 text-text-secondary rounded text-xs font-mono"
 title="Decrease Y by 1 year"
 >
 -1.0y
 </button>
 <button
 type="button"
 onClick={() => setLocalY((prev) => Math.max(0.5, Math.round((prev - 0.5) * 10) / 10))}
 className="px-2 py-1 bg-surface hover:bg-surface-2 text-text-secondary rounded text-xs font-mono"
 title="Decrease Y by 0.5 year"
 >
 -0.5y
 </button>
 <button
 type="button"
 onClick={() => setLocalY((prev) => Math.min(15.0, Math.round((prev + 0.5) * 10) / 10))}
 className="px-2 py-1 bg-surface hover:bg-surface-2 text-text-secondary rounded text-xs font-mono"
 title="Increase Y by 0.5 year"
 >
 +0.5y
 </button>
 <button
 type="button"
 onClick={() => setLocalY((prev) => Math.min(15.0, Math.round((prev + 1.0) * 10) / 10))}
 className="px-2 py-1 bg-surface hover:bg-surface-2 text-text-secondary rounded text-xs font-mono"
 title="Increase Y by 1 year"
 >
 +1.0y
 </button>
 </div>
 <p className="text-[11px] text-text-muted">
 Drag slider or click steppers to test organizational transition speed.
 </p>
 </div>

 {/* Control 2: Select Sensitivity */}
 <div className="space-y-3 p-4 rounded-xl bg-bg-1/60 border border-border">
 <div className="flex items-center justify-between">
 <label className="text-xs font-semibold text-text-secondary">Data Sensitivity (Affects X)</label>
 <span className="text-xs font-bold font-mono text-crypto uppercase">{localSensitivity}</span>
 </div>

 <div className="grid grid-cols-2 gap-2">
 {Object.entries(SENSITIVITY_CONFIG).map(([key, item]) => (
 <button
 key={key}
 type="button"
 onClick={() => setLocalSensitivity(key)}
 className={`p-2 rounded-lg text-left transition-all text-xs border ${
 localSensitivity === key
 ? 'bg-surface-2 border-pqc text-crypto font-semibold shadow-sm'
 : 'bg-bg-1/60 border-border text-text-secondary hover:text-text-brand hover:bg-surface-2'
 }`}
 >
 <div className="font-semibold">{item.label}</div>
 <div className="text-[10px] opacity-75 font-mono">X = {item.defaultX}y</div>
 </button>
 ))}
 </div>
 <p className="text-[11px] text-text-muted">
 Sets baseline confidentiality shelf-life <code className="text-crypto font-mono">X</code> according to
 policy rules.
 </p>
 </div>

 {/* Control 3: Select Quantum Scenario */}
 <div className="space-y-3 p-4 rounded-xl bg-bg-1/60 border border-border">
 <div className="flex items-center justify-between">
 <label className="text-xs font-semibold text-text-secondary">Quantum Threat Scenario (Affects Z)</label>
 <span className="text-xs font-bold font-mono text-high uppercase">{localScenario}</span>
 </div>

 <div className="space-y-2">
 {(Object.keys(SCENARIO_CONFIG) as Array<'conservative' | 'baseline' | 'optimistic'>).map((key) => {
 const item = SCENARIO_CONFIG[key];
 const isSelected = localScenario === key;
 return (
 <button
 key={key}
 type="button"
 onClick={() => setLocalScenario(key)}
 className={`w-full p-2 rounded-lg flex items-center justify-between transition-all text-xs border ${
 isSelected
 ? 'bg-surface-2 border-high text-high font-semibold shadow-sm'
 : 'bg-bg-1/60 border-border text-text-secondary hover:text-text-brand hover:bg-surface-2'
 }`}
 >
 <div>
 <span className="font-semibold">{item.label}</span>
 <span className="text-[11px] opacity-75 ml-2 font-mono">~{item.horizonYear}</span>
 </div>
 <span className="text-[11px] font-mono font-bold">Z = {item.Z}y</span>
 </button>
 );
 })}
 </div>
 <p className="text-[11px] text-text-muted">Switches quantum cryptanalysis emergence timeline benchmark.</p>
 </div>
 </div>

 {/* Simulation Diff Review Bar */}
 {isSimulated && (
 <div className="p-3.5 rounded-xl bg-surface-2 border border-high flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
 <div className="flex items-center gap-2">
 <Sparkles className="w-4 h-4 text-high shrink-0" />
 <div className="text-text-secondary">
 <span className="font-bold text-high">Active What-If Simulation:</span> Stored Assessment:{' '}
 <code className="font-mono text-text-secondary">
 Y = {initialY.toFixed(1)}y, Z = {initialZ.toFixed(1)}y
 </code>{' '}
 <span className="text-text-muted">→</span> Simulated:{' '}
 <code className="font-mono text-crypto">
 Y = {localY.toFixed(1)}y, Z = {currentZ.toFixed(1)}y
 </code>
 </div>
 </div>
 <button
 onClick={handleReset}
 className="px-3 py-1 bg-high hover:bg-high text-text-muted font-bold rounded-lg transition-colors text-xs shrink-0 cursor-pointer"
 >
 Reset to policy values
 </button>
 </div>
 )}

 {/* Policy Profile Metadata Footer */}
 {policyProfile && (
 <div className="text-[11px] text-text-muted font-mono text-right pt-2 border-t border-border">
 Active Security Policy Context: {policyProfile} (Rule Engine v1.0.0)
 </div>
 )}
 </div>
 </div>
 );
};
