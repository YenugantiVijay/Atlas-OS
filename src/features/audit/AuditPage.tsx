import React, { useState, useEffect } from 'react';
import { Search, History } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { AuditEvent } from '@/types';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';

export const AuditPage: React.FC = () => {
  const { currentOrg } = useOrg();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (currentOrg) {
      setEvents(storage.getAuditEvents(currentOrg.id));
    }
  }, [currentOrg]);

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
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              System Audit Trail
            </h1>
            <Badge variant="violet" size="sm">
              Immutable Log
            </Badge>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">
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
        />
      </Card>

      {/* Audit Log Table */}
      {filteredEvents.length === 0 ? (
        <EmptyState
          icon={<History className="w-7 h-7" />}
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
                  <span className="font-mono text-xs font-bold text-atlas-800 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200">
                    {evt.action}
                  </span>
                </TableCell>

                <TableCell>
                  <Badge variant="default" size="sm">
                    {evt.entityType}
                  </Badge>
                </TableCell>

                <TableCell className="text-xs text-content-secondary font-mono">
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
