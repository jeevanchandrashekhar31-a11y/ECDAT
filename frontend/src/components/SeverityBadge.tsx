import React from 'react';
import { AlertOctagon, AlertTriangle, Info, CheckCircle2, ShieldAlert, Clock, Zap, CheckCircle } from 'lucide-react';
import { SeverityLevel, MoscaStatus } from '../types';

interface SeverityBadgeProps {
  severity: SeverityLevel | string;
  size?: 'sm' | 'md';
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity, size = 'md' }) => {
  const normalized = (severity || 'informational').toLowerCase();

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs font-semibold';
  const iconSize = size === 'sm' ? 12 : 14;

  switch (normalized) {
    case 'critical':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 ${sizeClasses}`}
        >
          <AlertOctagon size={iconSize} className="text-rose-400 shrink-0" aria-hidden="true" />
          <span>Critical</span>
        </span>
      );
    case 'high':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30 ${sizeClasses}`}
        >
          <AlertTriangle size={iconSize} className="text-amber-400 shrink-0" aria-hidden="true" />
          <span>High</span>
        </span>
      );
    case 'medium':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 ${sizeClasses}`}
        >
          <ShieldAlert size={iconSize} className="text-cyan-400 shrink-0" aria-hidden="true" />
          <span>Medium</span>
        </span>
      );
    case 'low':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 ${sizeClasses}`}
        >
          <Info size={iconSize} className="text-indigo-400 shrink-0" aria-hidden="true" />
          <span>Low</span>
        </span>
      );
    case 'informational':
    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60 ${sizeClasses}`}
        >
          <CheckCircle2 size={iconSize} className="text-slate-400 shrink-0" aria-hidden="true" />
          <span>Info</span>
        </span>
      );
  }
};

interface MoscaStatusBadgeProps {
  status: MoscaStatus | string;
  size?: 'sm' | 'md';
}

export const MoscaStatusBadge: React.FC<MoscaStatusBadgeProps> = ({ status, size = 'md' }) => {
  const norm = (status || 'SAFE').toUpperCase();
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs font-semibold';
  const iconSize = size === 'sm' ? 12 : 14;

  switch (norm) {
    case 'CRITICAL_URGENT':
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-red-950/70 text-red-300 border border-red-800/80 font-mono uppercase ${sizeClasses}`}
        >
          <Zap size={iconSize} className="text-red-400 shrink-0" />
          <span>CRITICAL URGENT</span>
        </span>
      );
    case 'AT_RISK':
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-amber-950/70 text-amber-300 border border-amber-800/80 font-mono uppercase ${sizeClasses}`}
        >
          <AlertTriangle size={iconSize} className="text-amber-400 shrink-0" />
          <span>AT RISK</span>
        </span>
      );
    case 'WATCH':
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-blue-950/70 text-blue-300 border border-blue-800/80 font-mono uppercase ${sizeClasses}`}
        >
          <Clock size={iconSize} className="text-blue-400 shrink-0" />
          <span>WATCH</span>
        </span>
      );
    case 'SAFE':
    default:
      return (
        <span
          className={`inline-flex items-center gap-1 rounded-md bg-emerald-950/70 text-emerald-300 border border-emerald-800/80 font-mono uppercase ${sizeClasses}`}
        >
          <CheckCircle size={iconSize} className="text-emerald-400 shrink-0" />
          <span>SAFE</span>
        </span>
      );
  }
};
