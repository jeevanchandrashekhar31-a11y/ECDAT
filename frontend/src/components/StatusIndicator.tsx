import React from 'react';

interface StatusIndicatorProps {
  online: boolean;
  version?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ online, version }) => {
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-xs font-medium">
      <span className="relative flex h-2 w-2">
        {online ? (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </>
        ) : (
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
        )}
      </span>
      <span className={online ? 'text-emerald-300' : 'text-rose-300'}>
        {online ? `Core Engine Live${version && version !== 'undefined' ? ` (v${version})` : ''}` : 'Engine Offline'}
      </span>
    </div>
  );
};
