import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  pageSizeOptions?: number[];
  isLoading?: boolean;
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  totalCount,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  isLoading = false,
  className = '',
}) => {
  if (totalCount === 0) {
    return null;
  }

  const startRecord = (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalCount);

  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 border-t border-border bg-surface text-sm text-content-secondary ${className}`}
      data-testid="pagination-control"
    >
      {/* Record summary & Page Size Selector */}
      <div className="flex items-center gap-4 flex-wrap justify-center sm:justify-start">
        <span>
          Showing <span className="font-semibold text-content-primary">{startRecord}</span> to{' '}
          <span className="font-semibold text-content-primary">{endRecord}</span> of{' '}
          <span className="font-semibold text-content-primary">{totalCount}</span> results
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <label htmlFor="pageSizeSelect" className="text-xs text-content-muted">
              Rows per page:
            </label>
            <select
              id="pageSizeSelect"
              value={pageSize}
              disabled={isLoading}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="text-xs rounded-md border border-border bg-surface px-2 py-1 text-content-primary focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Navigation Buttons & Page Status */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-content-muted mr-2">
          Page <span className="font-semibold text-content-primary">{page}</span> of{' '}
          <span className="font-semibold text-content-primary">{Math.max(1, totalPages)}</span>
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || isLoading}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
          leftIcon={<ChevronLeft className="w-4 h-4" />}
          className="text-xs px-2.5 py-1"
        >
          Previous
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || isLoading}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
          rightIcon={<ChevronRight className="w-4 h-4" />}
          className="text-xs px-2.5 py-1"
        >
          Next
        </Button>
      </div>
    </div>
  );
};
