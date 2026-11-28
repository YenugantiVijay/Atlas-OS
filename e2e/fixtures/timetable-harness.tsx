import React from 'react';
 import ReactDOM from 'react-dom/client';
 import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
 import {SchoolTimetable} from '../../src/features/school/SchoolTimetable';
 import {timetableService} from '../../src/features/school/timetable.service';
 export function mountTimetable(){let saved=null;
 timetableService.read=async()=>({current:saved,history:[],latest_id:saved?.id??null,can_publish:true});
 timetableService.publish=async(org,staff,id,expected,effective,entries,filename,original)=>{saved={id,revision:1,effective_on:effective,entries,filename,original_base64:original,published_at:''};};
 document.getElementById('root').style.display='none';const host=document.createElement('main');host.style.padding='16px';document.body.append(host);
 ReactDOM.createRoot(host).render(React.createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},React.createElement(SchoolTimetable,{orgId:'school-a',userId:'user-a',staff:[{staff_id:'staff-a',school_id:'T-001',display_name:'Teacher X'}],authority:true,editable:true})));

}
