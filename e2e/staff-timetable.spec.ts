import {test,expect} from '@playwright/test';
import ExcelJS from 'exceljs';
test('staff timetable previews real Excel and publishes only after review on mobile',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Timetable');sheet.addRow(['day','start','end','activity','class','section','subject','room']);sheet.addRow(['Monday','09:00','09:45','teaching','5','A','Science','Room 3']);sheet.addRow(['Monday','09:45','10:00','break','','','','']);
 const bytes=Buffer.from(await book.xlsx.writeBuffer());
 await page.addScriptTag({type:'module',content:'import {mountTimetable} from "/e2e/fixtures/timetable-harness.tsx";mountTimetable();'});
 await expect(page.getByLabel('Timetable staff member')).toBeVisible({timeout:10000}).catch(()=>{throw new Error(errors.join(' | ')||'Timetable harness did not mount');});
 await page.getByLabel('Timetable staff member').selectOption('staff-a');await page.getByLabel('Upload staff timetable Excel').setInputFiles({name:'Teacher.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
 await expect(page.getByText('Preview · Teacher.xlsx · 2 periods')).toBeVisible();await expect(page.getByRole('button',{name:'Download original Excel'})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Publish timetable',exact:true}).click();await expect(page.getByText('Timetable published. Previous versions and original files are preserved.')).toBeVisible();
 await page.getByRole('button',{name:'Show weekly timetable'}).click();await expect(page.getByText('Science · Class 5 A · Room 3')).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download original Excel'}).click();expect((await download).suggestedFilename()).toBe('Teacher.xlsx');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
