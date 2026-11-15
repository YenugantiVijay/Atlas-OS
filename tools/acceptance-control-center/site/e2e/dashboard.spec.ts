import {test,expect} from '@playwright/test';
const sha='a'.repeat(40);
const checks=[{id:'STG-01',title:'Staging health',section:'Environment',status:'verified',effective_status:'verified',priority:'critical',requires_auth:false,description:'Healthy staging',next_steps:['Read-only project check'],evidence_url:'https://supabase.com'},
{id:'AUTH-01',title:'Real issued JWT',section:'Authentication',status:'unknown',effective_status:'unknown',priority:'critical',requires_auth:true,description:'Real Supabase sign-in',next_steps:['Sign in to staging'],evidence_url:''}];
const data={checks,migrations:Array.from({length:48},(_,i)=>({version:i+1,name:'migration_'+(i+1),status:'verified',observed_from:'fixture',verified_at:new Date().toISOString(),evidence_url:''})),
runs:[],events:[],github:{main_sha:sha,dev_sha:sha,pull_requests:[],ci_runs:[],last_synced_at:null,last_error:''},
summary:{decision:'NO-GO',completed:1,total:2,counts:{verified:1,failed:0,blocked:0,unknown:1},criticalVerified:1,criticalTotal:2,blockers:['AUTH-01'],reasons:['Auth unverified'],migrationVerified:48,ciGate:true,mainSha:sha}};
test.beforeEach(async({page})=>{await page.route('**/api/state',async r=>r.fulfill({json:data}));});
test('renders no-go and navigates to evidence',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Release readiness'})).toBeVisible();
 await expect(page.getByText('NO-GO').first()).toBeVisible();
 await page.getByRole('button',{name:/Acceptance matrix/}).click();
 await expect(page.getByRole('heading',{name:'Acceptance matrix'})).toBeVisible();
 await expect(page.getByText('Real issued JWT')).toBeVisible();
});
test('shows migration wall and workflow lab without production calls',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:/Migrations 001/}).click();
 await expect(page.getByRole('heading',{name:'Migration ledger'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Migration 048 verified'})).toBeVisible();
 await page.getByRole('button',{name:/Workflow lab/}).click();
 await expect(page.getByRole('heading',{name:'Authenticated workflow lab'})).toBeVisible();
});