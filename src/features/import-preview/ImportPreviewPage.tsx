import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useOrg } from '@/features/organizations/OrgContext';
import { loadImportCustomers, loadImportProducts } from './import-catalog.service';
import { readImportFile, type SourceSheet } from './import-file';
import {
  IMPORT_DATASETS, mappingIssues, normalizeKey, previewCustomers, previewProducts, previewStock, readMappedRows,
  suggestColumns, suggestHeader, type ColumnMapping, type CustomerIdentity, type ImportDataset, type ProductIdentity,
} from './import-preview';

const datasets = ['products', 'customers', 'stock'] as const;
const emptyProducts: ProductIdentity[] = [];
const emptyCustomers: CustomerIdentity[] = [];
const pageSize = 25;

interface Workbook { id: number; filename: string; sheets: SourceSheet[] }
interface Selection { workbook: Workbook; sheet: SourceSheet; header: number; mapping: ColumnMapping }
type Selections = Partial<Record<ImportDataset, Selection>>;
type CatalogState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; records: T[] }
  | { status: 'error'; message: string };

function useCatalogComparison<T>(
  orgId: string,
  demo: boolean,
  enabled: boolean,
  load: (orgId: string, demo: boolean, signal: AbortSignal) => Promise<T[]>,
) {
  const [state, setState] = useState<CatalogState<T>>({ status: 'idle' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void load(orgId, demo, controller.signal)
      .then((records) => {
        if (!controller.signal.aborted) setState({ status: 'ready', records });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Atlas catalog comparison is unavailable.',
        });
      });
    return () => controller.abort();
  }, [orgId, demo, enabled, load, revision]);
  return { state, refresh: () => setRevision((value) => value + 1) };
}

function selectSheet(dataset: ImportDataset, workbook: Workbook, sheet: SourceSheet, header = suggestHeader(dataset, sheet)): Selection {
  const cells = sheet.rows.find((row) => row.number === header)?.cells ?? [];
  return { workbook, sheet, header, mapping: suggestColumns(dataset, cells) };
}

const sheetNames: Record<ImportDataset, RegExp> = {
  products: /^(products?|items?|item master|catalog)/,
  customers: /^(customers?|accounts?|sundry debtors|parties)/,
  stock: /^(opening stock|closing stock|stock|inventory)/,
};

function selectWorkbook(dataset: ImportDataset, workbook: Workbook): Selection {
  let best = selectSheet(dataset, workbook, workbook.sheets[0]);
  let bestScore = -1;
  for (const sheet of workbook.sheets) {
    const selection = selectSheet(dataset, workbook, sheet);
    const score = Object.keys(selection.mapping).length +
      (mappingIssues(dataset, selection.mapping).length === 0 ? 20 : 0) +
      (sheetNames[dataset].test(normalizeKey(sheet.name)) ? 10 : 0);
    if (score > bestScore) {
      best = selection;
      bestScore = score;
    }
  }
  return best;
}

function columnLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) :
    String.fromCharCode(64 + Math.floor(index / 26), 65 + index % 26);
}

function HeaderRowControl({ sheet, header, onApply }: { sheet: SourceSheet; header: number; onApply: (row: number) => void }) {
  const [value, setValue] = useState(String(header));
  const [error, setError] = useState('');
  return (
    <form className="flex items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      const row = Number(value);
      if (!sheet.rows.some((item) => item.number === row)) {
        setError('Choose a populated source row.');
        return;
      }
      onApply(row);
    }}>
      <Input label="Header row" type="number" min={1} max={sheet.rows.at(-1)?.number} step={1}
        required value={value} error={error} onChange={(event) => {
          setValue(event.target.value);
          setError('');
        }} />
      <Button type="submit" variant="outline" disabled={value === String(header)} className="shrink-0">Use row</Button>
    </form>
  );
}

export function ImportPreviewPage() {
  const { currentOrg, currentUser, isMockAuth } = useOrg();
  if (!currentOrg) return null;
  return <ImportPreview key={`${currentOrg.id}:${currentUser?.id}:${isMockAuth}`}
    orgId={currentOrg.id} demo={isMockAuth} />;
}

function ImportPreview({ orgId, demo }: { orgId: string; demo: boolean }) {
  const [dataset, setDataset] = useState<ImportDataset>('products');
  const [selections, setSelections] = useState<Selections>({});
  const [fileErrors, setFileErrors] = useState<Partial<Record<ImportDataset, string>>>({});
  const [reading, setReading] = useState<ImportDataset | null>(null);
  const nextWorkbookId = useRef(0);
  const [page, setPage] = useState(1);
  const [reviewOnly, setReviewOnly] = useState(false);

  const definition = IMPORT_DATASETS[dataset];
  const selected = selections[dataset];
  const workbooks = useMemo(() => [...new Map(
    Object.values(selections).map(({ workbook }) => [workbook.id, workbook]),
  ).values()], [selections]);
  const productComparison = useCatalogComparison(orgId, demo, !!(selections.products || selections.stock), loadImportProducts);
  const customerComparison = useCatalogComparison(orgId, demo, !!selections.customers, loadImportCustomers);
  const comparison = dataset === 'customers' ? customerComparison : productComparison;
  const catalogState = comparison.state;
  const productsCompared = productComparison.state.status === 'ready';

  const setSelection = (target: ImportDataset, selection: Selection) => {
    setSelections((previous) => ({ ...previous, [target]: selection }));
    setFileErrors((previous) => ({ ...previous, [target]: undefined }));
    setPage(1);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || reading) return;
    const target = dataset;
    setReading(target);
    setFileErrors((previous) => ({ ...previous, [target]: undefined }));
    try {
      const sheets = await readImportFile(file);
      const workbook = { id: ++nextWorkbookId.current, filename: file.name, sheets };
      setSelection(target, selectWorkbook(target, workbook));
    } catch (error) {
      setFileErrors((previous) => ({
        ...previous, [target]: error instanceof Error ? error.message : 'Could not read this export.',
      }));
    } finally {
      setReading(null);
    }
  };

  const products = productComparison.state.status === 'ready' ? productComparison.state.records : emptyProducts;
  const customers = customerComparison.state.status === 'ready' ? customerComparison.state.records : emptyCustomers;
  const sourceProducts = useMemo(() => {
    const source = selections.products;
    if (!source) return [];
    const headings = source.sheet.rows.find((row) => row.number === source.header)?.cells;
    if (mappingIssues('products', source.mapping, headings).length) return [];
    return previewProducts(readMappedRows('products', source.sheet, source.header, source.mapping).rows, products);
  }, [selections.products, products]);

  const headerCells = useMemo(() => selected?.sheet.rows.find((row) => row.number === selected.header)?.cells ?? [], [selected]);
  const mappingErrors = useMemo(() => selected ? mappingIssues(dataset, selected.mapping, headerCells) : [], [dataset, selected, headerCells]);
  const preview = useMemo(() => {
    if (!selected || mappingErrors.length) return { rows: [], ignored: 0 };
    const { rows, ignored } = readMappedRows(dataset, selected.sheet, selected.header, selected.mapping);
    if (dataset === 'products') return { rows: sourceProducts, ignored };
    if (dataset === 'customers') return {
      rows: previewCustomers(rows, customers, selected.mapping.group !== undefined), ignored,
    };
    return { rows: previewStock(rows, sourceProducts, products, productsCompared), ignored };
  }, [dataset, selected, mappingErrors, sourceProducts, products, productsCompared, customers]);

  const reviewRows = useMemo(() => preview.rows.filter((row) => row.issues.length > 0), [preview.rows]);
  const filtered = reviewOnly ? reviewRows : preview.rows;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visiblePage = Math.min(page, totalPages);
  const visibleRows = filtered.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
  const columnCount = useMemo(() => selected?.sheet.rows.reduce((max, row) => Math.max(max, row.cells.length), 0) ?? 0, [selected?.sheet]);
  const sourceColumns = Array.from({ length: columnCount }, (_, index) => ({
    value: String(index), label: columnLabel(index) + ' · ' + (headerCells[index]?.trim() || 'Unnamed column'),
  }));
  const displayedFields = definition.fields.filter((field) => selected?.mapping[field.key] !== undefined);

  return (
    <div className="min-w-0 space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/products" className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-atlas-700 hover:underline">
            <ArrowLeft size={15} /> Products
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-content-primary">
            <FileSpreadsheet size={23} className="text-atlas-700" /> BUSY import preview
          </h1>
          <p className="mt-1 text-sm text-content-secondary">Map your BUSY exports and review data issues before switching to Atlas.</p>
        </div>
        <Badge variant="info" size="sm">Preview only</Badge>
      </header>

      <div role="group" aria-label="Import datasets" className="flex flex-wrap gap-2">
        {datasets.map((target) => (
          <Button key={target} variant={target === dataset ? 'primary' : 'outline'} aria-pressed={target === dataset}
            onClick={() => { setDataset(target); setReviewOnly(false); setPage(1); }}>
            {IMPORT_DATASETS[target].label}
          </Button>
        ))}
      </div>

      <Card>
        <div className="space-y-3">
          <div>
            <h2 className="font-semibold text-content-primary">{definition.label} source</h2>
            <p className="mt-1 text-sm text-content-secondary">{definition.hint}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="busy-import-file" className="block text-sm font-medium text-content-primary">Export file</label>
              <input id="busy-import-file" type="file" accept=".xlsx,.csv" disabled={reading !== null}
                onChange={(event) => void onFile(event)}
                className="block w-full rounded-lg border border-border bg-surface-card p-2 text-sm text-content-secondary file:mr-2 file:rounded file:border-0 file:bg-atlas-50 file:px-2 file:py-1 file:text-atlas-800" />
              <p className="text-xs text-content-secondary">.xlsx or .csv, up to 10 MB. Files are read on this device.</p>
            </div>
            {workbooks.length > 0 && (
              <Select label="Use a loaded workbook" value={selected ? String(selected.workbook.id) : ''} disabled={reading === dataset}
                options={[{ value: '', label: 'Select workbook' }, ...workbooks.map((workbook) => ({
                  value: String(workbook.id), label: workbook.filename,
                }))]}
                onChange={(event) => {
                  const workbook = workbooks.find((item) => item.id === Number(event.target.value));
                  if (workbook) setSelection(dataset, selectWorkbook(dataset, workbook));
                }} />
            )}
          </div>
          {reading !== null && <p role="status" className="text-sm text-content-secondary">Reading {IMPORT_DATASETS[reading].label.toLowerCase()} export…</p>}
          {fileErrors[dataset] && <p role="alert" className="text-sm text-rose-700">{fileErrors[dataset]}</p>}
          {selected && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-content-secondary">
              <strong className="break-all text-content-primary">{selected.workbook.filename}</strong>
              <Button size="sm" variant="ghost" disabled={reading === dataset} onClick={() => {
                setSelections((previous) => {
                  const remaining = { ...previous };
                  delete remaining[dataset];
                  return remaining;
                });
                setPage(1);
              }}>Clear file</Button>
            </div>
          )}
        </div>
      </Card>

      {selected && (
        <Card>
          <div className="space-y-4">
            <h2 className="font-semibold text-content-primary">Column mapping</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Worksheet" value={selected.sheet.name} disabled={selected.workbook.sheets.length === 1}
                options={selected.workbook.sheets.map((sheet) => ({ value: sheet.name, label: sheet.name }))}
                onChange={(event) => {
                  const sheet = selected.workbook.sheets.find((item) => item.name === event.target.value);
                  if (sheet) setSelection(dataset, selectSheet(dataset, selected.workbook, sheet));
                }} />
              <HeaderRowControl key={dataset + ':' + selected.workbook.id + ':' + selected.sheet.name + ':' + selected.header}
                sheet={selected.sheet} header={selected.header}
                onApply={(row) => setSelection(dataset, selectSheet(dataset, selected.workbook, selected.sheet, row))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {definition.fields.map((field) => (
                <Select key={field.key} label={field.label}
                  value={selected.mapping[field.key] === undefined ? '' : String(selected.mapping[field.key])}
                  options={[{ value: '', label: field.required ? 'Choose source column' : 'Unmapped' }, ...sourceColumns]}
                  onChange={(event) => {
                    const mapping = { ...selected.mapping };
                    if (event.target.value === '') delete mapping[field.key];
                    else mapping[field.key] = Number(event.target.value);
                    setSelection(dataset, { ...selected, mapping });
                  }} />
              ))}
            </div>
            {mappingErrors.map((error) => <p key={error} role="alert" className="text-sm text-rose-700">{error}</p>)}
            {dataset === 'customers' && selected.mapping.group === undefined && (
              <p className="text-sm text-amber-800">Confirm that this file contains only customers, or map the account group.</p>
            )}
            {dataset === 'stock' && !sourceProducts.length && (
              <p className="text-sm text-content-secondary">Load the Products export to match items that are new to Atlas.</p>
            )}
          </div>
        </Card>
      )}

      {selected && mappingErrors.length === 0 && (
        <section aria-label="Preview results" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-content-primary">Preview results</h2>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-content-secondary">
                <span>{preview.rows.length.toLocaleString()} source rows</span>
                <span>{(preview.rows.length - reviewRows.length).toLocaleString()} {catalogState.status === 'ready' ? 'passed checks' : 'passed file checks'}</span>
                <span>{reviewRows.length.toLocaleString()} need review</span>
                {preview.ignored > 0 && <span>{preview.ignored.toLocaleString()} headers or totals skipped</span>}
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-content-primary">
              <input type="checkbox" checked={reviewOnly} onChange={(event) => {
                setReviewOnly(event.target.checked);
                setPage(1);
              }} /> Show rows needing review
            </label>
          </div>
          {catalogState.status === 'loading' && <p role="status" className="text-sm text-content-secondary">Comparing with your Atlas catalog…</p>}
          {catalogState.status === 'ready' && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-content-secondary">
              <p>Compared with your Atlas records.</p>
              <Button size="sm" variant="ghost" onClick={comparison.refresh}>Refresh comparison</Button>
            </div>
          )}
          {catalogState.status === 'error' && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
              <span>{catalogState.message} The results below cover the files you loaded.</span>
              <Button size="sm" variant="outline" onClick={comparison.refresh}>Retry comparison</Button>
            </div>
          )}
          {visibleRows.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-card p-4 text-sm text-content-secondary">
              {reviewOnly ? 'No rows need review.' : 'No data rows were found below the selected header.'}
            </p>
          ) : (
            <>
              <Table aria-label={definition.label + ' import preview'}>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Source row</TableHead>
                    {displayedFields.map((field) => <TableHead key={field.key} scope="col">{field.label}</TableHead>)}
                    {dataset === 'stock' && <TableHead scope="col">Matched product</TableHead>}
                    <TableHead scope="col">Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.number}>
                      <TableCell className="align-top tabular-nums text-content-secondary">{row.number}</TableCell>
                      {displayedFields.map((field) => (
                        <TableCell key={field.key} className="min-w-28 max-w-64 align-top [overflow-wrap:anywhere]">
                          {row.values[field.key] || (field.key === 'unit' && row.normalizedUnit) || '—'}
                          {field.key === 'unit' && row.normalizedUnit && row.values.unit &&
                            row.normalizedUnit !== row.values.unit && (
                              <span className="block text-xs text-content-secondary">Atlas unit {row.normalizedUnit}</span>
                            )}
                        </TableCell>
                      ))}
                      {dataset === 'stock' && <TableCell className="min-w-40 align-top">{row.matchedProduct ?? '—'}</TableCell>}
                      <TableCell className="min-w-64 align-top">
                        {row.issues.length > 0 ? (
                          <ul className="space-y-1 text-xs text-amber-900">
                            {row.issues.map((issue) => <li key={issue}>{issue}</li>)}
                          </ul>
                        ) : <Badge variant="success" size="sm">{catalogState.status === 'ready' ? 'Passes checks' : 'Passes file checks'}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {totalPages > 1 && <Pagination page={visiblePage} pageSize={pageSize}
                totalPages={totalPages} totalCount={filtered.length} onPageChange={setPage} />}
            </>
          )}
        </section>
      )}
    </div>
  );
}
