import { supportAreaLabel } from '@/lib/support-reports';
import type { OwnerOverview } from '@/services/owner-console.service';

export type OwnerSection = 'overview' | 'clients' | 'tickets' | 'purchases';
type InsightArea = Exclude<OwnerSection, 'overview'>;
export interface OwnerInsight {
  message: string;
  area: InsightArea;
}

export const monthName = (value: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' })
  .format(new Date(value + '-01T00:00:00Z'));

export function getOwnerInsights(snapshot: OwnerOverview): OwnerInsight[] {
  const insights: OwnerInsight[] = [];
  const topArea = snapshot.report_areas[0];
  const latestComplete = snapshot.months.at(-2);
  const preceding = snapshot.months.at(-3);
  if (snapshot.urgent_reports) {
    const count = snapshot.urgent_reports;
    insights.push({ area: 'tickets', message: `${count} urgent client report${count === 1 ? ' needs' : 's need'} attention.` });
  }
  if (snapshot.overdue_reports) {
    const count = snapshot.overdue_reports;
    insights.push({ area: 'tickets', message: `${count} client report${count === 1 ? ' has' : 's have'} been open for over 48 hours.` });
  }
  if (snapshot.due_renewals) {
    const count = snapshot.due_renewals;
    insights.push({ area: 'clients', message: `${count} subscription${count === 1 ? ' reaches its' : 's reach their'} access end date within 14 days.` });
  }
  if (topArea) {
    insights.push({ area: 'tickets', message: `${supportAreaLabel(topArea.area)} has the most open reports (${topArea.reports}).` });
  }
  if (latestComplete && preceding && latestComplete.purchases < preceding.purchases) {
    insights.push({ area: 'purchases', message: `Purchases fell from ${preceding.purchases} in ${monthName(preceding.month)} to ${latestComplete.purchases} in ${monthName(latestComplete.month)}.` });
  }
  return insights;
}
