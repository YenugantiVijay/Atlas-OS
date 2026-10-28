import React, { useState, useEffect } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { auditService } from '@/services/audit.service';
import { AuditEvent } from '@/types';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

export const AuditPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let isMounted = true;
    const fetchAudit = async () => {
      if (currentOrg) {
        setIsLoading(true);
        try {
          const data = await auditService.getAuditEvents(currentOrg.id, isMockAuth);
          if (isMounted) setEvents(data);
        } catch (err) {
          console.error('Failed to load audit events:', err);
        } finally {
          if (isMounted) setIsLoading(false);
        }
      }
    };
    fetchAudit();
    return () => {
      isMounted = false;
    };
  }, [currentOrg, isMockAuth]);

  const filteredEvents = events.filter((e) => {
    const s = searchQuery.toLowerCase();
    return (
      e.action.toLowerCase().includes(s) ||
      e.entityType.toLowerCase().includes(s) ||
      e.actorEmail?.toLowerCase().includes(s) ||
      JSON.stringify(e.details || {}).toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Audit Trail
            </h1>
            <Badge variant="indigo" size="sm">
              Immutable Log
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Complete security and operational audit trail: all price updates, stock confirmations, invoice emissions, and payments.
          </p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <Input
          placeholder="Filter audit events by action (e.g. CONFIRM_ORDER), entity, or actor..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
          aria-label="Filter audit events"
        />
      </Card>

      {/* Audit Log Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredEvents.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="w-7 h-7" />}
          title="No audit events found"
          description="Operational actions and database transactions will be logged here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target Entity</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Event Snapshot Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEvents.map((evt) => (
              <TableRow key={evt.id}>
                <TableCell className="font-mono text-xs text-content-secondary whitespace-nowrap">
                  {new Date(evt.createdAt).toLocaleString('en-IN', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  })}
                </TableCell>

                <TableCell>
                  <span className="font-mono text-xs font-bold text-atlas-800 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200/80">
                    {evt.action}
                  </span>
                </TableCell>

                <TableCell>
                  <Badge variant="default" size="sm">
                    {evt.entityType}
                  </Badge>
                </TableCell>

                <TableCell className="text-xs text-content-primary font-mono">
                  {evt.actorEmail || 'system'}
                </TableCell>

                <TableCell className="text-xs font-mono text-content-secondary max-w-md truncate">
                  {evt.details ? JSON.stringify(evt.details) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
