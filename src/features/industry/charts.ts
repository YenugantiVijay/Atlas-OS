import type { SpecialtyToolId } from '@/lib/industry-tools';
import { shiftDay, type IceSeries, type Snapshot } from './operations';

export function formatChartLabel(label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(label + 'T00:00:00Z'),
  );
}

export function operationChart(tool: SpecialtyToolId, data: Snapshot, stallUnit: string) {
  const studio = tool === 'banner-print-studio';
  const stalls = tool === 'ice-cream-stalls';
  const labels = studio
    ? ['Overdue', 'Due today', 'Next 7 days', 'Later']
    : Array.from({ length: 7 }, (_, index) => shiftDay(data.today, index - 6));
  const rows = labels.map((label, index) => {
    if (studio) return { label, values: [(data.series as number[])[index] ?? 0] };
    const entry = (data.series as IceSeries[]).find(
      (point) => point.day === label && point.unit === (stalls ? stallUnit : 'case'),
    );
    return { label, values: [entry?.first ?? 0, entry?.second ?? 0] };
  });
  return {
    title: studio
      ? 'Open print jobs by due date'
      : stalls
        ? 'Stock received and sold over 7 days'
        : 'Committed and dispatched cases over 7 days',
    description: studio
      ? 'Prioritize late and same-day jobs. Delivered jobs leave this chart.'
      : stalls
        ? 'Compare incoming stock with sales by unit.'
        : 'Compare new case commitments with actual dispatches. Use open commitments below to see what still needs to ship.',
    legend: studio ? ['Open jobs'] : stalls ? ['Received', 'Sold'] : ['Committed', 'Dispatched'],
    rows,
    max: Math.max(1, ...rows.flatMap((row) => row.values)),
  };
}
