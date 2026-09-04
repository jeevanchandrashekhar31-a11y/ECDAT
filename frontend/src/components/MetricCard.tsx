import React from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  variant?: 'cyan' | 'rose' | 'amber' | 'violet' | 'emerald' | 'slate';
  badge?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({ title, value, subtitle, icon, variant = 'cyan', badge }) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'rose':
        return {
          iconBg: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
          badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
          accent: 'border-l-rose-500',
        };
      case 'amber':
        return {
          iconBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
          badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          accent: 'border-l-amber-500',
        };
      case 'violet':
        return {
          iconBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
          badgeBg: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
          accent: 'border-l-violet-500',
        };
      case 'emerald':
        return {
          iconBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
          badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          accent: 'border-l-emerald-500',
        };
      case 'slate':
        return {
          iconBg: 'bg-slate-800 text-slate-400 border-slate-700',
          badgeBg: 'bg-slate-800 text-slate-300 border-slate-700',
          accent: 'border-l-slate-600',
        };
      case 'cyan':
      default:
        return {
          iconBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
          badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
          accent: 'border-l-cyan-500',
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div className={`glass-card p-5 border-l-4 ${styles.accent} glass-card-hover flex flex-col justify-between`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</p>
          <h3 className="text-3xl font-bold tracking-tight text-white mt-1.5">{value}</h3>
        </div>
        <div className={`p-3 rounded-xl border ${styles.iconBg} shrink-0`}>{icon}</div>
      </div>

      {(subtitle || badge) && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800/70 text-xs">
          {subtitle && <span className="text-slate-400">{subtitle}</span>}
          {badge && (
            <span className={`px-2 py-0.5 rounded font-semibold border text-[11px] ${styles.badgeBg}`}>{badge}</span>
          )}
        </div>
      )}
    </div>
  );
};
