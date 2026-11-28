
import {describe,it,expect,beforeAll,afterAll,vi} from 'vitest';
import {Blob as NodeBlob} from 'node:buffer';
beforeAll(()=>vi.stubGlobal('Blob',NodeBlob));afterAll(()=>vi.unstubAllGlobals());
import ExcelJS from 'exceljs';
import {readTimetable,timetableHeaders} from './timetable-import';
async function workbook(start:unknown='09:00',end:unknown='09:45',format?:string,hidden=false) {
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Timetable');sheet.addRow(timetableHeaders);sheet.addRow(['Monday',start,end,'teaching','5','A','Science','Room 3']);
 if(format){sheet.getCell('B2').numFmt=format;sheet.getCell('C2').numFmt=format;}
 if(hidden)book.addWorksheet('Other staff',{state:'hidden'}).addRow(['private']);
 const buffer=await book.xlsx.writeBuffer();const bytes=new Uint8Array(buffer);
 return {name:'Teacher.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)} as File;
}
describe('Real Excel timetable workbooks',()=>{
 it('reads an actual compressed Excel workbook',async()=>{const result=await readTimetable(await workbook());expect(result.errors).toEqual([]);expect(result.entries[0].start).toBe(540);});
 it('reads Excel time-formatted numeric cells as hours and minutes',async()=>{const result=await readTimetable(await workbook(9/24,9.75/24,'hh:mm'));expect(result.errors).toEqual([]);expect(result.entries[0].end).toBe(585);});
 it('flags formulas instead of trusting cached results',async()=>{const result=await readTimetable(await workbook({formula:'1+1',result:0.375}));expect(result.errors.join()).toContain('formulas');});
 it('rejects hidden additional worksheets',async()=>{await expect(readTimetable(await workbook('09:00','09:45',undefined,true))).rejects.toThrow('no hidden sheets');});
 it('blocks oversized or non-xlsx files before parsing',async()=>{await expect(readTimetable({name:'Teacher.xls',size:1} as File)).rejects.toThrow('.xlsx');await expect(readTimetable({name:'Teacher.xlsx',size:1048577} as File)).rejects.toThrow('1 MB');});
});
