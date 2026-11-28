import {describe,it,expect} from 'vitest';
import {previewTimetable,timetableHeaders,clockText} from './timetable-import';
const sheet=(rows:string[][])=>[{name:'Timetable',rows:[[...timetableHeaders],...rows].map((cells,i)=>({number:i+1,cells}))}];
const lesson=['Monday','09:00','09:45','teaching','5','A','Science','Room 3'];
describe('Staff timetable preview',()=>{
 it('accepts classes, breaks, free periods and duties with adjacent periods',()=>{
  const r=previewTimetable(sheet([lesson,['Monday','09:45','10:00','break','','','',''],['Monday','10:00','10:45','free','','','',''],['Tuesday','11:00','12:00','duty','','','Gate duty','Gate 1']]));expect(r.errors).toEqual([]);expect(r.entries).toHaveLength(4);expect(clockText(r.entries[0].start)).toBe('09:00');
 });
 it('rejects overlapping periods while permitting the same time on different days',()=>{
  expect(previewTimetable(sheet([lesson,['Monday','09:30','10:00','duty','','','','']])).errors.join()).toContain('overlapping');
  expect(previewTimetable(sheet([lesson,['Tuesday',...lesson.slice(1)]])).errors).toEqual([]);
 });
 it('flags incomplete teaching periods, invalid days, malformed times and formulas',()=>{
  const input=sheet([['Mon','25:00','08:00','teaching','','','','']]);input[0].rows[1]={...input[0].rows[1],cellIssues:{2:'formula'}} as never;
  const r=previewTimetable(input);expect(r.errors.join()).toContain('formulas');expect(r.errors.join()).toContain('weekday');expect(r.errors.join()).toContain('HH:mm');expect(r.errors.join()).toContain('class and subject');
 });
 it('requires the template and caps one worksheet at 150 periods',()=>{
  expect(()=>previewTimetable([])).toThrow('one populated');expect(()=>previewTimetable(sheet([]))).toThrow('1 and 150');expect(()=>previewTimetable(sheet(Array.from({length:151},()=>lesson)))).toThrow('150');
  const input=sheet([lesson]);input[0].rows[0].cells[0]='unexpected';expect(()=>previewTimetable(input)).toThrow('headers');
 });
 it('accepts Excel numeric time fractions but rejects seconds and unknown activities',()=>{
  expect(previewTimetable(sheet([['Monday','0.375','0.40625','teaching','5','','Science','']])).errors).toEqual([]);
  expect(previewTimetable(sheet([['Monday','09:00:30','10:00','other','','','','']])).errors).toHaveLength(2);
 });
});
