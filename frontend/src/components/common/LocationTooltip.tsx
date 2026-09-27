import React, { useState, useRef, useEffect } from 'react';
import { FileCode } from 'lucide-react';

interface LocationTooltipProps {
  location: string | undefined | null;
  lineNumber?: number | string | null;
  maxWidth?: string;
  className?: string;
}

export function LocationTooltip({ 
  location, 
  lineNumber, 
  maxWidth = 'max-w-[180px]',
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

  return (
    <div 
      ref={containerRef}
      className={`relative flex items-center gap-1.5 font-mono text-[11px] ${className}`}
    >
      <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <button 
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`truncate ${maxWidth} cursor-pointer hover:text-primary transition-colors text-left outline-none`}
        title="Click to view full path"
      >
        {displayLocation}
      </button>
      {lineNumber ? <span className="text-slate-500 shrink-0">:{lineNumber}</span> : null}
      
      {/* Click Dropdown */}
      {isOpen && (
        <div className="absolute left-0 bottom-full mb-2 z-[100] animate-in fade-in zoom-in duration-150">
          <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-2xl min-w-[250px] max-w-[400px] break-all whitespace-normal text-slate-200 text-xs text-left cursor-text"
               onClick={(e) => e.stopPropagation()}
          >
            {displayLocation}
            {lineNumber ? <span className="text-primary font-bold">:{lineNumber}</span> : ''}
          </div>
          <div className="absolute -bottom-1.5 left-4 w-3 h-3 bg-slate-900 border-b border-r border-slate-700 rotate-45"></div>
        </div>
      )}
    </div>
  );
}
