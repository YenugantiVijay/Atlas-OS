export type Status='verified'|'failed'|'blocked'|'unknown';
export interface Check{id:string;status:Status;requires_auth:boolean;tested_commit:string;verified_at?:string|null}
export function effectiveStatus(check:Check,mainSha:string,now=Date.now()):Status{
 if(check.status!=='verified')return check.status;
 if(check.requires_auth&&(!mainSha||check.tested_commit!==mainSha))return 'unknown';
 if(check.id==='STG-01'&&(!check.verified_at||now-new Date(check.verified_at).getTime()>86400000))return 'unknown';
 return 'verified';
}
export function canRelease(checks:Check[],mainSha:string,mainCI:boolean,migrations:number):boolean{
 return Boolean(mainSha)&&mainCI&&migrations===48&&checks.length>0&&checks.every(c=>effectiveStatus(c,mainSha)==='verified');
}