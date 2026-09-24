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
 iconBg: 'bg-critical/15 text-critical border-critical',
 badgeBg: 'bg-critical/20 text-critical border-critical',
 accent: 'border-l-critical',
 };
 case 'amber':
 return {
 iconBg: 'bg-high/15 text-high border-high',
 badgeBg: 'bg-high/20 text-high border-high',
 accent: 'border-l-high',
 };
 case 'violet':
 return {
 iconBg: 'bg-specialized text-specialized border-specialized',
 badgeBg: 'bg-specialized text-specialized border-specialized',
 accent: 'border-l-violet-500',
 };
 case 'emerald':
 return {
 iconBg: 'bg-success/15 text-success border-success',
 badgeBg: 'bg-success/20 text-success border-success',
 accent: 'border-l-success',
 };
 case 'slate':
 return {
 iconBg: 'bg-surface text-text-secondary border-border-soft',
 badgeBg: 'bg-surface text-text-secondary border-border-soft',
 accent: 'border-l-border',
 };
 case 'cyan':
 default:
 return {
 iconBg: 'bg-pqc/15 text-crypto border-pqc/30',
 badgeBg: 'bg-pqc/20 text-crypto border-pqc/40',
 accent: 'border-l-pqc',
 };
 }
 };

 const styles = getVariantStyles();

 return (
 <div className={`glass-card p-5 border-l-4 ${styles.accent} glass-card-hover flex flex-col justify-between group overflow-hidden relative`}>

 <div className="flex items-start justify-between relative z-10">
 <div>
 <p className="text-xs font-medium uppercase tracking-widest text-text-secondary">{title}</p>
 <h3 className="text-4xl font-display font-bold tracking-tight text-text-brand mt-2 leading-none">{value}</h3>
 </div>
 <div className={`p-3 rounded-xl border ${styles.iconBg} shrink-0 shadow-black/20`}>{icon}</div>
 </div>

 {(subtitle || badge) && (
 <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/50 text-xs relative z-10">
 {subtitle && <span className="text-text-secondary font-medium">{subtitle}</span>}
 {badge && (
 <span className={`px-2 py-0.5 rounded font-semibold border text-[11px] ${styles.badgeBg}`}>{badge}</span>
 )}
 </div>
 )}
 </div>
 );
};
