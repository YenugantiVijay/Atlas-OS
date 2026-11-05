import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { Search, ChevronDown, X, Loader2, Check } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeVariant?: 'success' | 'warning' | 'danger' | 'info' | 'default';
  disabled?: boolean;
}

export interface SearchableSelectProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string, option?: SearchableSelectOption) => void;
  options: SearchableSelectOption[];
  onSearch?: (query: string) => void;
  isLoading?: boolean;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  id?: string;
  emptyMessage?: string;
  className?: string;
  'aria-label'?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label,
  placeholder = 'Search and select...',
  value,
  onChange,
  options,
  onSearch,
  isLoading = false,
  required = false,
  disabled = false,
  error,
  id,
  emptyMessage = 'No matching results found',
  className = '',
  'aria-label': ariaLabel,
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Cache selected option so label remains visible even if outside current search page
  const [selectedOption, setSelectedOption] = useState<SearchableSelectOption | null>(() => {
    return options.find((o) => o.value === value) || null;
  });

  useEffect(() => {
    if (value) {
      const match = options.find((o) => o.value === value);
      if (match) {
        setSelectedOption(match);
      }
    } else {
      setSelectedOption(null);
    }
  }, [value, options]);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Debounced search trigger with cleanup on unmount
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    setHighlightedIndex(0);

    if (onSearch) {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      searchTimeoutRef.current = setTimeout(() => {
        onSearch(q);
      }, 250);
    }
  };

  // Filter options client-side if onSearch is not provided
  const visibleOptions = onSearch
    ? options
    : options.filter((o) => {
        const s = searchQuery.toLowerCase();
        return (
          o.label.toLowerCase().includes(s) ||
          Boolean(o.sublabel && o.sublabel.toLowerCase().includes(s))
        );
      });

  const handleSelect = useCallback(
    (opt: SearchableSelectOption) => {
      if (opt.disabled) return;
      setSelectedOption(opt);
      onChange(opt.value, opt);
      setIsOpen(false);
      setSearchQuery('');
    },
    [onChange]
  );

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedOption(null);
    onChange('', undefined);
    setSearchQuery('');
    if (onSearch) onSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < visibleOptions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : visibleOptions.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (visibleOptions[highlightedIndex]) {
          handleSelect(visibleOptions[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        break;
      case 'Tab':
        setIsOpen(false);
        setSearchQuery('');
        break;
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-semibold text-content-secondary mb-1.5"
        >
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      {/* Control Box */}
      <div
        className={`relative flex items-center min-h-[38px] px-3 py-1.5 rounded-lg border bg-surface-card transition-colors ${
          disabled
            ? 'bg-slate-100/60 border-border text-content-muted cursor-not-allowed'
            : isOpen
            ? 'border-atlas-600 ring-2 ring-atlas-500/20'
            : error
            ? 'border-red-500 ring-1 ring-red-500/30'
            : 'border-border hover:border-slate-400 cursor-pointer'
        }`}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel || label}
      >
        <div className="flex-1 flex items-center gap-2 overflow-hidden">
          {isOpen ? (
            <div className="flex items-center gap-1.5 w-full">
              <Search className="w-3.5 h-3.5 text-content-muted flex-shrink-0" />
              <input
                ref={inputRef}
                id={inputId}
                type="text"
                className="w-full bg-transparent text-xs text-content-primary placeholder-content-muted focus:outline-none"
                placeholder={selectedOption ? selectedOption.label : placeholder}
                value={searchQuery}
                onChange={handleQueryChange}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
                aria-autocomplete="list"
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-between truncate">
              {selectedOption ? (
                <div className="flex items-center gap-2 truncate">
                  <span className="text-xs font-medium text-content-primary truncate">
                    {selectedOption.label}
                  </span>
                  {selectedOption.sublabel && (
                    <span className="text-[11px] text-content-muted truncate">
                      {selectedOption.sublabel}
                    </span>
                  )}
                  {selectedOption.badge && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                      {selectedOption.badge}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-xs text-content-muted">{placeholder}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-atlas-600" />}

          {value && !disabled && !isLoading && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 text-content-muted hover:text-content-primary rounded hover:bg-slate-100"
              title="Clear selection"
              aria-label="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          <ChevronDown
            className={`w-4 h-4 text-content-muted transition-transform duration-150 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </div>
      </div>

      {/* Error Message */}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-surface-card shadow-lg py-1 animate-in fade-in-50 duration-150"
          role="listbox"
        >
          {visibleOptions.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-content-muted">
              {isLoading ? 'Searching...' : emptyMessage}
            </div>
          ) : (
            visibleOptions.map((opt, idx) => {
              const isSelected = opt.value === value;
              const isHighlighted = idx === highlightedIndex;

              return (
                <div
                  key={opt.value}
                  className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer transition-colors ${
                    opt.disabled
                      ? 'opacity-40 cursor-not-allowed bg-slate-50'
                      : isHighlighted
                      ? 'bg-atlas-50 text-atlas-900 font-medium'
                      : isSelected
                      ? 'bg-slate-50 font-medium text-content-primary'
                      : 'hover:bg-slate-50 text-content-primary'
                  }`}
                  onClick={() => handleSelect(opt)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="text-[11px] text-content-muted truncate mt-0.5">
                        {opt.sublabel}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {opt.badge && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && <Check className="w-3.5 h-3.5 text-atlas-600" />}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
