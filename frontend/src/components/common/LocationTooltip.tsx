import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
      className={`relative flex items-center gap-1.5 font-mono text-[11px] ${className}`}
    >
      <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <button 
        onClick={toggleTooltip}
        className={`truncate ${maxWidth} cursor-pointer hover:text-primary transition-colors text-left outline-none`}
        title="Click to view full path"
      >
        {displayLocation}
      </button>
      {lineNumber ? <span className="text-slate-500 shrink-0">:{lineNumber}</span> : null}
      
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
