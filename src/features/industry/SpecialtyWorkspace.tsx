import { useEffect, useRef, useState } from 'react';
import { BarChart3, ClipboardList, PackageCheck, Snowflake } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useIndustryTool } from '@/hooks/useIndustryTool';
import { isSpecialtyToolId, type SpecialtyToolId } from '@/lib/industry-tools';
import { WorkspaceBanner } from '@/components/layout/WorkspaceBanner';
import { Button } from '@/components/ui/Button';
import { formatChartLabel, operationChart } from './charts';
import { Field, inputClass, panel } from './fields';
import { readOperations, saveOperation, type Command, type Snapshot } from './operations';
import { Studio } from './Studio';
import { IceDesk } from './IceDesk';

export default function SpecialtyWorkspace() {
  const tool = useIndustryTool();
  const { currentOrg, currentRole, isMockAuth, canWriteOperations } = useOrg();
  const id = tool?.id;
  const org = currentOrg?.id;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [chartUnit, setChartUnit] = useState('piece');
  const pending = useRef<{ signature: string; id: string }>();
  const sending = useRef(false);
  useEffect(() => {
    if (!org || !isSpecialtyToolId(id)) return;
    let active = true;
    readOperations(org, id, isMockAuth)
      .then((rows) => {
        if (active) setSnapshot(rows);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [org, id, isMockAuth, refresh]);

  if (!tool || !isSpecialtyToolId(id) || !org) return null;
  const toolId: SpecialtyToolId = id;
  const Icon =
    id === 'banner-print-studio' ? ClipboardList : id === 'ice-cream-stalls' ? Snowflake : PackageCheck;
  const canWrite = isMockAuth || canWriteOperations;
  async function save(command: Command) {
    if (!org || !canWrite || sending.current) return false;
    sending.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    const signature = JSON.stringify(command);
    const request =
      pending.current?.signature === signature
        ? pending.current
        : { signature, id: crypto.randomUUID() };
    pending.current = request;
    try {
      await saveOperation(org, toolId, isMockAuth, command, request.id);
      pending.current = undefined;
      setStatus('Operation saved.');
      setRefresh((value) => value + 1);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the operation.');
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const chart = snapshot && operationChart(id, snapshot, chartUnit);
  return (
    <div className="space-y-4">
      <WorkspaceBanner
        name={tool.name}
        title={tool.headline}
        description={tool.description}
        status={isMockAuth ? 'Demo Workspace' : 'Cloud Workspace'}
        icon={<Icon size={16} />}
      />
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}{' '}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setError('');
              setRefresh((value) => value + 1);
            }}
          >
            Refresh records
          </Button>
        </div>
      )}
      {status && (
        <p role="status" className="text-sm font-semibold text-emerald-800">
          {status}
        </p>
      )}
      {snapshot && chart ? (
        <>
          <section className={panel} aria-labelledby="operations-graph">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="text-atlas-700" aria-hidden="true" />
                  <h2 id="operations-graph" className="text-lg font-bold">
                    {chart.title}
                  </h2>
                </div>
                <p className="mt-1 text-sm text-content-secondary">{chart.description}</p>
              </div>
              {id === 'ice-cream-stalls' && (
                <Field label="Graph unit">
                  <select
                    className={inputClass}
                    value={chartUnit}
                    onChange={(event) => setChartUnit(event.target.value)}
                  >
                    <option value="piece">Packaged pieces</option>
                    <option value="scoop">Estimated scoops</option>
                  </select>
                </Field>
              )}
            </div>
            <div className="mt-4 grid gap-2" aria-label={chart.title}>
              {chart.rows.map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[5.5rem_1fr] items-start gap-2 text-sm sm:grid-cols-[8rem_1fr]"
                >
                  <span>{formatChartLabel(row.label)}</span>
                  <div className="space-y-1">
                    {row.values.map((value, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div
                          className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"
                          aria-hidden="true"
                        >
                          <div
                            className={
                              'h-full rounded-full transition-[width] motion-reduce:transition-none ' +
                              (index === 0 ? 'bg-atlas-700' : 'bg-amber-500')
                            }
                            style={{ width: (100 * value) / chart.max + '%' }}
                          />
                        </div>
                        <span
                          className="min-w-8 text-right tabular-nums"
                          aria-label={chart.legend[index] + ': ' + value}
                        >
                          {value.toLocaleString('en-IN')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-content-secondary">{chart.legend.join(' · ')}</p>
          </section>
          {!canWrite && (
            <p className="rounded-xl border border-border bg-white p-3 text-sm">
              This workspace is available in read-only mode.
            </p>
          )}
          {id === 'banner-print-studio' ? (
            <Studio snapshot={snapshot} save={save} canWrite={canWrite} busy={busy} role={currentRole} />
          ) : (
            <IceDesk
              snapshot={snapshot}
              save={save}
              canWrite={canWrite}
              busy={busy}
              role={currentRole}
              distribution={id === 'ice-cream-distribution'}
            />
          )}
        </>
      ) : (
        !error && (
          <p role="status" className="px-4 py-6 text-sm">
            Loading the workspace…
          </p>
        )
      )}
    </div>
  );
}
