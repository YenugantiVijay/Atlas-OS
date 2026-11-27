import { randomUUID } from 'node:crypto';
export async function createProductFixture(client, source, category) {
 const id=randomUUID();
 await client.query('INSERT INTO public.organizations(id,name,pan,currency) SELECT $1,name||$2,pan,currency FROM public.organizations WHERE id=$3',[id,' '+category,source]);
 await client.query('INSERT INTO public.memberships(organization_id,user_id,role,is_active) SELECT $1,user_id,role,is_active FROM public.memberships WHERE organization_id=$2',[id,source]);
 await client.query("INSERT INTO public.organization_eligibility(organization_id,business_category,sells_electrical_products,status,declared_by) SELECT $1,$2,false,'approved',user_id FROM public.memberships WHERE organization_id=$3 AND role='owner' LIMIT 1",[id,category,source]);
 await client.query("INSERT INTO public.organization_subscriptions(organization_id,plan_tier,status,current_period_ends_at) VALUES($1,'professional','active',now()+interval '1 year')",[id]);
 return id;
}
