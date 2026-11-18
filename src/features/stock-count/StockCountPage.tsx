import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Download, FileSpreadsheet, TriangleAlert } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { loadImportProducts } from '@/features/import-preview/import-catalog.service';
import { readImportFile, type SourceSheet } from '@/features/import-preview/import-file';
import { normalizeHeader, type ProductIdentity } from '@/features/import-preview/import-preview';
import { useOrg } from '@/features/organizations/OrgContext';
import { BatchOpeningPanel } from './BatchOpeningPanel';
import { getBusinessDate } from '@/lib/dates';
import {
  countFields, countStatuses, parseCountDate, readCountRows, reviewCount, suggestCountMapping, suggestCountSetup,
  type CountMapping, type CountSource, type CountStatus, type DateOrder, type ReviewRow,
} from './stock-count';

const pageSize = 25;
const statusVariants: Record<CountStatus, BadgeProps['variant']> = {
  Expired: 'danger', Usable: 'success', 'Needs review': 'warning',
};
const statusIcons = { Expired: TriangleAlert, Usable: CheckCircle2, 'Needs review': ClipboardList };
type Filter = CountStatus | 'All rows';
interface Workbook { file: string; sheets: SourceSheet[] }
interface Preview { rows: CountSource[]; sheet: string; revision: number }

export default function StockCountPage() {
  const { currentOrg, currentUser, currentRole, isMockAuth, canWriteOperations } = useOrg();
  if (!currentOrg) return null;
  return <StockCountWorkspace key={`${currentOrg.id}:${currentUser?.id}:${isMockAuth}`}
    orgId={currentOrg.id} userId={currentUser?.id} demo={isMockAuth}
    openingAccess={isMockAuth || !currentRole || !['owner', 'admin', 'inventory'].includes(currentRole) ? undefined : {
      orgId: currentOrg.id, userId: currentUser?.id, canSave: canWriteOperations && ['owner', 'admin'].includes(currentRole),
    }} />;
}

interface OpeningAccess { orgId: string; userId?: string; canSave: boolean }

function StockCountWorkspace({ orgId, userId, demo, openingAccess }: {
  orgId: string; userId?: string; demo: boolean; openingAccess?: OpeningAccess;
}) {
  const [workbook, setWorkbook] = useState<Workbook>();
  const [sheetIndex, setSheetIndex] = useState(0);
  const [header, setHeader] = useState('');
  const [mapping, setMapping] = useState<CountMapping>({});
  const [defaultGodown, setDefaultGodown] = useState('');
  const [countDate, setCountDate] = useState(getBusinessDate);
  const [order, setOrder] = useState<DateOrder>('dmy');
  const [preview, setPreview] = useState<Preview>();
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [setupError, setSetupError] = useState('');
  const catalog = useQuery({
    queryKey: ['stock-count-products', orgId, userId, demo],
    queryFn: ({ signal }) => loadImportProducts(orgId, demo, signal),
    enabled: !!preview,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const sheet = workbook?.sheets[sheetIndex];
  const headings = sheet?.rows.find((row) => row.number === Number(header))?.cells;
  const width = useMemo(() => sheet?.rows.reduce((max, row) => Math.max(max, row.cells.length), 0) ?? 0, [sheet]);
  const countDateValid = !!parseCountDate(countDate);

  function pickSheet(source: SourceSheet, index: number) {
    const suggested = suggestCountSetup(source);
    setSheetIndex(index);
    setHeader(String(suggested.header));
    setMapping(suggested.mapping);
    setSetupError('');
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || reading) return;
    setReading(true);
    setFileError('');
    try {
      const sheets = await readImportFile(file, { calendarDates: true });
      const bestSheet = sheets.reduce((best, candidate, index) => {
        const score = suggestCountSetup(candidate).score;
        return score > best.score ? { index, score } : best;
      }, { index: 0, score: -1 });
      setWorkbook({ file: file.name, sheets });
      pickSheet(sheets[bestSheet.index], bestSheet.index);
      setPreview(undefined);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not read this file.');
    } finally {
      setReading(false);
    }
  }

  function buildPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sheet || !headings) return setSetupError('Choose the populated row with column headings.');
    if (mapping.quantity === undefined || (mapping.sku === undefined && mapping.name === undefined)) {
      return setSetupError('Map the counted quantity and either SKU or item name.');
    }
    if (/\b(?:amount|rate|value|price|valuation)\b/.test(normalizeHeader(headings[mapping.quantity] ?? ''))) {
      return setSetupError('Choose a physical count column for quantity.');
    }
    const columns = Object.values(mapping);
    if (new Set(columns).size !== columns.length) return setSetupError('Choose a different column for each mapped field.');
    const rows = readCountRows(sheet, Number(header), mapping, defaultGodown);
    if (!rows.length) return setSetupError('There are no data rows below this header in the mapped columns.');
    setSetupError('');
    setPreview(previous => ({ rows, sheet: sheet.name, revision: (previous?.revision ?? 0) + 1 }));
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-content-primary sm:text-3xl">Stock count &amp; expiry review</h1>
        <p className="mt-1 text-sm text-content-secondary">Review warehouse counts from Excel or CSV before moving expired stock.</p>
      </header>
      <Card className="space-y-4 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-atlas-700" aria-hidden="true" />
          <h2 className="font-semibold text-content-primary">Upload a stock count</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Stock count file" type="file" accept=".xlsx,.csv" disabled={reading}
            onChange={onFile} helperText={preview ? 'Opening a new file replaces this preview and its edits.' : 'Excel (.xlsx) or CSV, up to 10 MB.'} />
          <Input label="Stock count date" type="date" required value={countDate} onChange={(event) => setCountDate(event.target.value)}
            error={countDateValid ? undefined : 'Enter a valid count date.'} />
          <Select label="Date order in text cells" value={order} onChange={(event) => setOrder(event.target.value as DateOrder)}
            options={[{ value: 'dmy', label: 'Day / Month / Year' }, { value: 'mdy', label: 'Month / Day / Year' }]} />
        </div>
        <p className="text-sm text-content-secondary">A batch is marked expired when its expiry falls on or before the count date. Enter <strong>No expiry</strong> where a date does not apply.</p>
        {reading && <p role="status" className="text-sm text-content-secondary">Reading stock count file…</p>}
        {fileError && <p role="alert" className="text-sm text-rose-700">{fileError}</p>}
        {workbook && sheet && (
          <form onSubmit={buildPreview} className="space-y-4 border-t border-border pt-4">
            <h2 className="break-all font-semibold text-content-primary">{workbook.file}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Worksheet" value={String(sheetIndex)} onChange={(event) => {
                const index = Number(event.target.value);
                pickSheet(workbook.sheets[index], index);
              }} options={workbook.sheets.map((entry, index) => ({ value: String(index), label: entry.name }))} />
              <Input label="Header row" type="number" min={1} required value={header} onChange={(event) => {
                const value = event.target.value;
                setHeader(value);
                setMapping(suggestCountMapping(sheet.rows.find((row) => row.number === Number(value))?.cells ?? []));
              }} />
              <Input label="Default godown" value={defaultGodown} maxLength={255}
                onChange={(event) => setDefaultGodown(event.target.value)} helperText="Fills rows with a blank godown." />
            </div>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {countFields.map((field) => <Select key={field.key} label={field.label} value={mapping[field.key] ?? ''}
                onChange={(event) => {
                  const next = { ...mapping };
                  if (event.target.value === '') delete next[field.key];
                  else next[field.key] = Number(event.target.value);
                  setMapping(next);
                }}
                options={[{ value: '', label: 'Skip column' }, ...Array.from({ length: width }, (_, index) => ({
                  value: String(index), label: `${index < 26 ? String.fromCharCode(65 + index) :
                    String.fromCharCode(64 + Math.floor(index / 26), 65 + index % 26)} · ${headings?.[index] || 'Untitled'}`,
                }))]} />)}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={reading || !countDateValid}>{preview ? 'Rebuild preview' : 'Build preview'}</Button>
              {preview && <p className="text-sm text-content-secondary">Rebuilding applies the settings above and clears row edits.</p>}
            </div>
            {setupError && <p role="alert" className="text-sm text-rose-700">{setupError}</p>}
          </form>
        )}
      </Card>
      {preview && workbook && (
        <>
          {catalog.isPending && <p role="status" className="text-sm text-content-secondary">Matching items with your Atlas catalog…</p>}
          {catalog.isError && (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-700">
              <p>{catalog.error instanceof Error ? catalog.error.message : 'Catalog comparison is unavailable.'}</p>
              <Button variant="outline" size="sm" onClick={() => void catalog.refetch()} disabled={catalog.isFetching}>Retry catalog</Button>
            </div>
          )}
          <StockCountPreview key={preview.revision} preview={preview} file={workbook.file} countDate={countDate}
            order={order} products={catalog.data} openingAccess={openingAccess} exportDisabled={catalog.isFetching || !countDateValid} />
        </>
      )}
    </div>
  );
}

function StockCountPreview({ preview, file, countDate, order, products, openingAccess, exportDisabled }: {
  preview: Preview; file: string; countDate: string; order: DateOrder; products?: ProductIdentity[]; openingAccess?: OpeningAccess; exportDisabled: boolean;
}) {
  const [edits, setEdits] = useState<Record<number, CountSource>>({});
  const [editing, setEditing] = useState<ReviewRow>();
  const [filter, setFilter] = useState<Filter>('All rows');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const reviewed = useMemo(() => reviewCount(preview.rows.map((row) => edits[row.number] ?? row), products, countDate, order),
    [preview.rows, edits, products, countDate, order]);
  const counts = useMemo(() => {
    const totals: Record<CountStatus, number> = { Expired: 0, Usable: 0, 'Needs review': 0 };
    reviewed.forEach((row) => { totals[row.status]++; });
    return totals;
  }, [reviewed]);
  const filtered = useMemo(() => filter === 'All rows' ? reviewed : reviewed.filter((row) => row.status === filter), [reviewed, filter]);
  const totalPages = Math.ceil(filtered.length / pageSize);
  const activePage = Math.min(page, Math.max(totalPages, 1));
  const visible = filtered.slice((activePage - 1) * pageSize, activePage * pageSize);

  async function exportReview() {
    setExporting(true);
    setExportError('');
    try {
      const { downloadStockCount } = await import('./stock-count-export');
      await downloadStockCount(reviewed, countDate, file, preview.sheet);
    } catch {
      setExportError('The report could not be downloaded. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-labelledby="count-preview-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="count-preview-heading" className="text-xl font-semibold text-content-primary">Review counted stock</h2>
          <p className="text-sm text-content-secondary">Changes apply to this preview only. Download the workbook to keep a copy.</p>
        </div>
        <Button variant="outline" onClick={() => void exportReview()} disabled={exportDisabled || exporting}
          leftIcon={<Download className="h-4 w-4" aria-hidden="true" />}>
          {exporting ? 'Preparing report…' : 'Download Excel review'}
        </Button>
      </div>
      {openingAccess && <BatchOpeningPanel {...openingAccess} rows={reviewed} countDate={countDate} />}
      {exportError && <p role="alert" className="text-sm text-rose-700">{exportError}</p>}
      <div aria-label="Filter stock count rows" role="group" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(['All rows', ...countStatuses] as const).map((status) => {
          const Icon = status === 'All rows' ? FileSpreadsheet : statusIcons[status];
          return <button type="button" key={status} aria-pressed={status === filter}
            onClick={() => { setFilter(status); setPage(1); }}
            className={`rounded-xl border bg-surface-card px-3 py-3 text-left text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atlas-500 ${status === filter ? 'border-atlas-600 ring-1 ring-atlas-600' : 'border-border hover:bg-surface-muted'}`}>
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{status}
            </span>
            <span className="mt-1 block text-2xl font-semibold tabular-nums">{status === 'All rows' ? reviewed.length : counts[status]}</span>
          </button>;
        })}
      </div>
      {!visible.length ? <Card className="p-5 text-sm text-content-secondary">No rows in this group.</Card> : (
        <>
          <Table aria-label="Stock count review">
            <TableHeader><TableRow>
              {['Row', 'Item', 'Batch', 'Expiry', 'Counted', 'Godown', 'Status', 'Edit'].map((heading) => <TableHead scope="col" key={heading}>{heading}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>{visible.map((row) => (
              <TableRow key={row.number}>
                <TableCell>{row.number}</TableCell>
                <TableCell className="min-w-44 break-words">
                  <span className="block max-w-56 font-medium">{row.values.name || row.matchedProduct?.name || row.values.sku || '—'}</span>
                  {row.matchedProduct && <span className="block max-w-56 text-xs text-content-secondary">Atlas · {row.matchedProduct.sku}</span>}
                </TableCell>
                <TableCell className="max-w-36 break-all">{row.values.batch || '—'}</TableCell>
                <TableCell className="max-w-36 break-words">{row.expiryText || '—'}</TableCell>
                <TableCell className="max-w-36 break-words">{row.values.quantity || '—'} {row.values.unit}</TableCell>
                <TableCell className="max-w-36 break-words">{row.values.godown || '—'}</TableCell>
                <TableCell className="min-w-52">
                  <Badge variant={statusVariants[row.status]}>{row.status}</Badge>
                  {!!row.problems.length && <ul className="mt-1 space-y-1 text-xs text-content-secondary">
                    {row.problems.map((problem) => <li key={problem}>{problem}</li>)}
                  </ul>}
                </TableCell>
                <TableCell><Button size="sm" variant="outline" aria-label={`Edit row ${row.number}`} onClick={() => setEditing(row)}>Edit</Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
          <Pagination page={activePage} pageSize={pageSize} totalCount={filtered.length} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
      {editing && <EditCountRow key={editing.number} row={editing} close={() => setEditing(undefined)}
        onApply={(row) => { setEdits({ ...edits, [row.number]: row }); setPage(activePage); setEditing(undefined); }} />}
    </section>
  );
}

function EditCountRow({ row, close, onApply }: { row: ReviewRow; close: () => void; onApply: (row: CountSource) => void }) {
  const [draft, setDraft] = useState<CountSource>({ number: row.number, values: row.values, issues: row.issues });
  return <Modal isOpen onClose={close} title={`Edit stock count row ${row.number}`} description="Use the Atlas SKU to resolve ambiguous item names.">
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault();
      const values = { ...draft.values };
      countFields.forEach(({ key }) => { values[key] = values[key].trim(); });
      onApply({ ...draft, values });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {countFields.map((field) => <Input key={field.key} label={field.label} value={draft.values[field.key]}
          inputMode={field.key === 'quantity' ? 'decimal' : undefined}
          helperText={field.key === 'expiry' ? 'Use a full date or No expiry.' : undefined}
          error={draft.issues[field.key]} onChange={(event) => {
            const value = event.target.value;
            setDraft((previous) => ({
              ...previous, values: { ...previous.values, [field.key]: value },
              issues: { ...previous.issues, [field.key]: value.trim().startsWith('=') ? 'Replace the formula with a fixed value.' : undefined },
            }));
          }} />)}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={close}>Cancel</Button>
        <Button type="submit">Apply to preview</Button>
      </div>
    </form>
  </Modal>;
}
