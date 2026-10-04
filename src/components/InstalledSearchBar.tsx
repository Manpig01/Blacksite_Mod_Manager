import React, { useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

interface InstalledSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  totalCount: number;
  filteredCount: number;
  placeholder?: string;
  className?: string;
}

export const InstalledSearchBar: React.FC<InstalledSearchBarProps> = ({
  value,
  onChange,
  onClear,
  totalCount,
  filteredCount,
  placeholder = 'Search by name, author, or category...',
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut: pressing '/' focuses the search bar if not already in an input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onClear();
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClear]);

  const isFiltering = value.trim().length > 0;

  return (
    <div className={`relative flex items-center ${className}`}>
      {/* Search Icon */}
      <Search className="w-4 h-4 text-[#6B7480] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors" />

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Filter installed mods by name, author, or category"
        className="w-full bg-[#0E1013] border border-[#23272E] rounded-lg pl-9 pr-20 py-1.5 text-[13px] text-[#E8EAEE] placeholder-[#6B7480] focus:outline-none focus:border-[#EA580C] focus:ring-1 focus:ring-[#EA580C]/40 transition-all shadow-inner"
      />

      {/* Trailing Controls & Counter */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
        {/* Match Count Badge when filtering */}
        {isFiltering && (
          <span
            className={`text-[10.5px] px-1.5 py-0.5 rounded font-mono font-medium ${
              filteredCount > 0
                ? 'bg-[#20252D] text-[#9AA3AF]'
                : 'bg-[#2A0E0E] text-[#DC2626] font-semibold'
            }`}
            title={`${filteredCount} of ${totalCount} mods match`}
          >
            {filteredCount}/{totalCount}
          </span>
        )}

        {/* Clear Button */}
        {isFiltering ? (
          <button
            onClick={() => {
              onClear();
              inputRef.current?.focus();
            }}
            className="p-1 rounded text-[#9AA3AF] hover:text-[#E8EAEE] hover:bg-[#20252D] transition-colors cursor-pointer"
            title="Clear search (Esc)"
            type="button"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <kbd
            onClick={() => inputRef.current?.focus()}
            className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-[#6B7480] bg-[#181B20] border border-[#2A2F38] rounded shadow-xs cursor-pointer hover:border-[#EA580C]"
            title="Press '/' to quickly search"
          >
            /
          </kbd>
        )}
      </div>
    </div>
  );
};
