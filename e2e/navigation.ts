import type {Page} from '@playwright/test';
export async function openNavigationGroup(page:Page,name:string){
 const button=page.getByRole('navigation',{name:'Workspace navigation'}).getByRole('button',{name,exact:true});
 if(await button.count()&&await button.getAttribute('aria-expanded')==='false')await button.click();
}
