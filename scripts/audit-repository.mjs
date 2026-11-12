import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Read-only repository gate; do not delete dependencies based solely on this scan.
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const problems=[], warnings=[];
const banned=tracked.filter(p=>
 /(^|\/)(node_modules|dist|coverage|test-results|playwright-report|\.astro|\.data)\//.test(p) ||
 /(^|\/)\.env(?:\.(?!example$)[^/]*)?$/.test(p) ||
 p.startsWith('tools/acceptance-control-center/backend/') ||
 /\.(pem|p12|pfx|key)$/.test(p)
);
if(banned.length) problems.push('Tracked generated/private/retired files: '+banned.join(', '));
const migrations=tracked.filter(p=>/^supabase\/migrations\/.+\.sql$/.test(p));
const tests=tracked.filter(p=>/\.(test|spec)\./.test(p));
if(migrations.length<48) problems.push('Migration chain shortened: '+migrations.length);
if(tests.length<75) problems.push('Test inventory shortened: '+tests.length);
if(!tracked.includes('tools/acceptance-control-center/site/local/server.mjs'))
 problems.push('Standalone acceptance server missing');
const sources=tracked.filter(p=>
 /^(src\/|e2e\/|scripts\/|atlas-os-website\/src\/|atlas-os-website\/scripts\/|tools\/acceptance-control-center\/site\/)/.test(p) &&
 /\.(tsx?|jsx?|mjs|astro)$/.test(p)
).map(path=>({path,text:readFileSync(path,'utf8')}));
for(const {path,text} of sources){
 if(path==='scripts/audit-repository.mjs') continue;
 if(/sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
  problems.push('Potential embedded secret: '+path);
 if(/window\.hatchable\b|hatchable\.events\b/.test(text))
  problems.push('Retired Hatchable runtime code: '+path);
 if(/\beval\s*\(|new\s+Function\s*\(/.test(text)&&!/\.(test|spec)\./.test(path))
  warnings.push('Dynamic code evaluation: '+path);
 if(/dangerouslySetInnerHTML/.test(text))
  warnings.push('HTML injection sink: '+path);
}
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const candidates=Object.keys(pkg.dependencies||{}).filter(name=>
 !sources.some(x=>x.text.includes("'"+name+"'")||x.text.includes('"'+name+'"')));
if(candidates.length) warnings.push('Possible unused direct dependencies (review before removal): '+candidates.join(', '));
console.log('Atlas OS hygiene: '+tracked.length+' tracked files; '+migrations.length+
 ' migrations; '+tests.length+' test/spec files; '+sources.length+' code files scanned.');
for(const warn of warnings) console.log('AUDIT REVIEW: '+warn);
for(const fail of problems) console.error('AUDIT FAILURE: '+fail);
if(problems.length) process.exitCode=1;
else console.log('PASS: repository hygiene and accidental credential exposure checks.');
