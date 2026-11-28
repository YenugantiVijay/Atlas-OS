import { readImportFile, type SourceSheet } from '@/features/import-preview/import-file';
export const timetableHeaders=['day','start','end','activity','class','section','subject','room'];
export const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export interface TimetableEntry {day:number;start:number;end:number;activity:'teaching'|'break'|'free'|'duty';class:string;section:string;subject:string;room:string}
export const clockText=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
function minutes(text:string) {
 if(/^\d*\.\d+$/.test(text)&&Number(text)<1){const value=Number(text)*1440;if(Math.abs(value-Math.round(value))<0.00001)return Math.round(value);}
 const match=/^(\d{1,2}):(\d{2})$/.exec(text);if(!match)return -1;
 const h=Number(match[1]),m=Number(match[2]);return h<=23&&m<=59?h*60+m:-1;
}
export function previewTimetable(sheets:SourceSheet[]) {
 if(sheets.length!==1)throw Error('Use one populated worksheet per staff timetable.');
 const [header,...source]=sheets[0].rows;const keys=header?.cells.map(c=>c.trim().toLowerCase())??[];
 if(keys.length!==8||new Set(keys).size!==8||timetableHeaders.some(h=>!keys.includes(h)))throw Error('Use the eight timetable template headers exactly.');
 if(source.length<1||source.length>150)throw Error('Use between 1 and 150 timetable periods.');
 const errors:string[]=[];const entries:TimetableEntry[]=source.map(row=>{
  const data=Object.fromEntries(keys.map((k,i)=>[k,(row.cells[i]??'').trim()]));const fail=(s:string)=>errors.push(`Row ${row.number}: ${s}`);
  if(Object.keys(row.cellIssues??{}).length)fail('formulas and error cells are not supported. Use plain values.');
  if(row.cells.length>8)fail('unexpected extra columns.');
  const day=weekdays.findIndex(d=>d.toLowerCase()===data.day.toLowerCase())+1;
  const start=minutes(data.start),end=minutes(data.end);const activity=data.activity.toLowerCase();
  if(!day)fail('enter a full weekday, such as Monday.');
  if(start<0||end<0||end<=start)fail('use HH:mm times with end after start; split overnight duties into separate days.');
  if(!['teaching','break','free','duty'].includes(activity))fail('activity must be teaching, break, free or duty.');
  if(activity==='teaching'&&(!data.class||!data.subject))fail('teaching periods require class and subject.');
  for(const [field,limit] of [['class',80],['section',40],['subject',100],['room',80]] as const)if(data[field].length>limit)fail(`${field} exceeds ${limit} characters.`);
  return {day,start,end,activity:activity as TimetableEntry['activity'],class:data.class,section:data.section,subject:data.subject,room:data.room};
 });
 entries.forEach((a,i)=>entries.slice(i+1).forEach(b=>{if(a.day===b.day&&a.start<b.end&&b.start<a.end)errors.push(`${weekdays[a.day-1]}: overlapping periods at ${clockText(a.start)} and ${clockText(b.start)}.`);}));
 return {entries:entries.sort((a,b)=>a.day-b.day||a.start-b.start),errors};
}
export async function readTimetable(file:File) {
 if(!/\.xlsx$/i.test(file.name)||file.size>1048576)throw Error('Choose an .xlsx file up to 1 MB.');
 return previewTimetable(await readImportFile(file,{clockTimes:true,singleVisibleSheet:true}));
}
export function saveTimetableFile(bytes:Uint8Array,name:string) {
 const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function downloadTimetableTemplate() {
 const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Timetable');
 sheet.addRow(timetableHeaders);sheet.addRow(['Monday','09:00','09:45','teaching','5','A','Science','Room 3']);sheet.addRow(['Monday','09:45','10:00','break','','','','']);sheet.addRow(['Monday','10:00','10:45','free','','','','']);
 sheet.columns.forEach(c=>{c.width=18;c.numFmt='@';});sheet.getRow(1).font={bold:true};
 saveTimetableFile(new Uint8Array(await book.xlsx.writeBuffer()),'Atlas-Staff-Timetable-Template.xlsx');
}
