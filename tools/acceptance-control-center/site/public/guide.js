(function(){
  window.AtlasGuidance={
    roleRows:[
      ['Read supplier price history',true,true,true,true,false],
      ['Record supplier quote',true,true,true,false,false],
      ['Save / post receiving GRN',true,true,true,false,false],
      ['Modify existing rate history',false,false,false,false,false],
      ['Read another organization’s data',false,false,false,false,false]
    ],
    policyNotes:[
      {title:'No production writes',description:'This dashboard only stores verification evidence in its own database. Atlas OS production remains untouched.'},
      {title:'Real credentials, staging only',description:'Authenticated browser/API tests must use approved staging accounts and actual issued Supabase sessions; simulated SQL roles cannot replace these tests.'},
      {title:'Changed commit = new verification',description:'Evidence on a previous main commit becomes stale after a merge. Re-run critical authenticated checks against the new main SHA.'},
      {title:'Industrial load test excluded',description:'The 200-entry Demo Mode test stays paused and does not count toward release readiness.'}
    ],
    flowGroups:[
      {id:'auth',name:'Authenticate',sub:'Real Supabase session',matches:['AUTH-01','ROLE-01'],eyebrow:'01 / IDENTIFY'},
      {id:'receive',name:'Receive stock',sub:'Draft → post → stock',matches:['GRN-01','GRN-02','STOCK-01'],eyebrow:'02 / GOODS IN'},
      {id:'price',name:'Record prices',sub:'Quote → timeline → safeguards',matches:['QUOTE-01','PRICE-01','SAFE-01'],eyebrow:'03 / PRICING'},
      {id:'secure',name:'Verify controls',sub:'Replay, tenant, audit',matches:['DUP-01','TENANT-01','AUDIT-01','IMMUT-01'],eyebrow:'04 / GUARDRails'}
    ],
    sections:[
      {key:'overview',label:'Overview',icon:'◈'},
      {key:'matrix',label:'Acceptance matrix',icon:'▦'},
      {key:'workflows',label:'Workflow lab',icon:'⇄'},
      {key:'security',label:'Security & roles',icon:'⬡'},
      {key:'migrations',label:'Migrations 001–048',icon:'▥'},
      {key:'evidence',label:'Runs & evidence',icon:'◷'},
      {key:'releases',label:'Release train',icon:'↗'}
    ]
  };
})();