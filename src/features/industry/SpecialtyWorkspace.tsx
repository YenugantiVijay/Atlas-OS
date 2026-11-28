import { useEffect, useRef, useState } from 'react';
import { BarChart3, ClipboardList, PackageCheck, Snowflake } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useIndustryTool } from '@/hooks/useIndustryTool';
import { isSpecialtyToolId, type SpecialtyToolId } from '@/lib/industry-tools';
import { WorkspaceBanner } from '@/components/layout/WorkspaceBanner';
import { Button } from '@/components/ui/Button';
import { formatChartLabel, operationChart } from './charts';
import { Field, inputClass, panel } from './fields';
import { portalStorageKey } from '@/lib/portal-entry';
import { readOperations, saveOperation, resolveOperation, OperationUnconfirmedError, type Command, type Snapshot } from './operations';
import { Studio } from './Studio';
import { HandoverReport } from './HandoverReport';
import { InvoiceReviews } from './InvoiceReviews';
import { LocationAccess } from './LocationAccess';
import { IceDesk } from './IceDesk';

export default function SpecialtyWorkspace() {
  const {currentOrg,currentUser,currentRole,isMockAuth}=useOrg();const tool=useIndustryTool();
  return <SpecialtyWorkspaceBody key={[currentOrg?.id,currentUser?.id,currentRole,tool?.id,isMockAuth].join(':')}/>;
}
function SpecialtyWorkspaceBody() {
  const tool = useIndustryTool();
  const { currentOrg, currentUser, currentRole, isMockAuth, canWriteOperations } = useOrg();
  const id = tool?.id;
  const org = currentOrg?.id;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [chartUnit, setChartUnit] = useState('piece');
  const storageKey=portalStorageKey('industry-pending:'+org+':'+currentUser?.id+':'+id);
  const [uncertain,setUncertain]=useState<{signature:string;id:string;command:Command}|null>(()=>{
    if(isMockAuth)return null;
    try{const raw=localStorage.getItem(storageKey);if(!raw)return null;const saved=JSON.parse(raw);return saved&&typeof saved.id==='string'&&saved.command&&saved.signature===JSON.stringify(saved.command)?saved:null;}catch{return null;}
  });
  const [formVersion,setFormVersion]=useState(0);
  const pending = useRef<{ signature: string; id: string;command:Command }|undefined>(uncertain??undefined);
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
    if(uncertain&&uncertain.signature!==signature){sending.current=false;setBusy(false);return false;}
    const request =
      pending.current?.signature === signature
        ? pending.current
        : { signature, id: crypto.randomUUID(),command };
    pending.current = request;
    try {
      if(!isMockAuth)localStorage.setItem(storageKey,JSON.stringify(request));
      await saveOperation(org, toolId, isMockAuth, command, request.id);
      pending.current = undefined;
      if(!isMockAuth)localStorage.removeItem(storageKey);
      if(uncertain)setFormVersion(v=>v+1);setUncertain(null);
      setStatus('Operation saved.');
      setRefresh((value) => value + 1);
      return true;
    } catch (failure) {
      if(failure instanceof OperationUnconfirmedError||uncertain)setUncertain(request);
      else if(!isMockAuth)localStorage.removeItem(storageKey);
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
      <Button variant="outline" disabled={busy} onClick={()=>setRefresh(v=>v+1)}>Refresh workspace records</Button>
      {id!=='banner-print-studio'&&!isMockAuth&&['owner','admin'].includes(currentRole??'')&&<HandoverReport orgId={org} tool={toolId}/>}
      {id!=='banner-print-studio'&&!isMockAuth&&['owner','admin'].includes(currentRole??'')&&<LocationAccess orgId={org} tool={toolId} editable={canWrite}/>}
      {id==='ice-cream-distribution'&&!isMockAuth&&['owner','admin','accounts'].includes(currentRole??'')&&<InvoiceReviews orgId={org} editable={canWrite&&!uncertain} refreshKey={refresh}/>}
      {snapshot?.location_restricted&&<p role="status" className="rounded-xl border border-border bg-white p-3 text-sm">{snapshot.assigned_locations?.length?'Assigned locations: '+snapshot.assigned_locations.join(', '):'No location is assigned to your account. Ask the owner or administrator to grant access.'}</p>}
      {uncertain&&<section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><p>A previous save has not been confirmed. Its original request is preserved for this account and workspace. Retry it unchanged to prevent duplicate stock or cash entries.</p><Button disabled={busy||!canWrite} onClick={()=>void save(uncertain.command)}>Retry unchanged operation</Button><Button variant="outline" disabled={busy} onClick={async()=>{
        setBusy(true);try{const recorded=await resolveOperation(org,toolId,uncertain.id,uncertain.command);localStorage.removeItem(storageKey);pending.current=undefined;setUncertain(null);setFormVersion(v=>v+1);setError('');setStatus(recorded?'The original operation was saved. No duplicate was created.':'The unsaved request was cancelled. You can enter a new operation.');setRefresh(v=>v+1);}catch(e){setError(e instanceof Error?e.message:'Could not resolve request');}finally{setBusy(false);}
      }}>Check status / cancel if unsaved</Button></section>}
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
            <Studio key={formVersion} snapshot={snapshot} save={save} canWrite={canWrite&&!uncertain&&(!snapshot.location_restricted||!!snapshot.assigned_locations?.length)} busy={busy} role={currentRole} />
          ) : (
            <IceDesk key={formVersion}
              snapshot={snapshot}
              save={save}
              canWrite={canWrite&&!uncertain}
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
