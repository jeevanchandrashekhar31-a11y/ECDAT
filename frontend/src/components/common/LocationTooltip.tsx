import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FileCode } from 'lucide-react';

interface LocationTooltipProps {
  location: string | undefined | null;
  lineNumber?: number | string | null;
  className?: string;
}

export function LocationTooltip({ 
  location, 
  lineNumber, 
  className = ''
}: LocationTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const displayLocation = location || 'Endpoint / Session';
  const segments = displayLocation.split(/[\/\\]/);
  const filename = segments.length > 1 ? segments.pop() : displayLocation;
  const directory = segments.length > 0 && displayLocation !== filename ? segments.join('/') + '/' : '';
  
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });

  const toggleTooltip = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setTooltipPos({ top: rect.top - 8, left: rect.left });
    }
    setIsOpen(!isOpen);
  };

  return (
    <div 
      ref={containerRef}
      className={`relative flex items-start gap-2 font-mono text-[11px] ${className}`}
    >
      <FileCode className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
      <button 
        onClick={toggleTooltip}
        className={`flex flex-col text-left cursor-pointer hover:bg-surfaceHover p-1 -ml-1 rounded transition-colors outline-none`}
        title="Click to view full path"
      >
        <div className="flex items-center flex-wrap gap-1">
          <span className="font-semibold text-slate-200 break-all">{filename}</span>
          {lineNumber && <span className="text-primary font-bold bg-primary/10 px-1.5 rounded-sm">:{lineNumber}</span>}
        </div>
        {directory && (
          <span className="text-slate-500 text-[10px] leading-tight mt-0.5 break-all max-w-full">
            {directory}
          </span>
        )}
      </button>
      
      {/* Click Dropdown Portalled to Body to escape table overflow:hidden */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed z-[9999] animate-in fade-in zoom-in duration-150"
          style={{ top: tooltipPos.top, left: tooltipPos.left, transform: 'translateY(-100%)' }}
        >
          <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-2xl min-w-[250px] max-w-[400px] break-all whitespace-normal text-slate-200 text-xs text-left cursor-text"
               onClick={(e) => e.stopPropagation()}
          >
            {displayLocation}
            {lineNumber ? <span className="text-primary font-bold">:{lineNumber}</span> : ''}
          </div>
          <div className="absolute -bottom-1.5 left-4 w-3 h-3 bg-slate-900 border-b border-r border-slate-700 rotate-45"></div>
        </div>,
        document.body
      )}
    </div>
  );
}
