
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
function fn(name){const start=html.indexOf('function '+name+'(');const end=html.indexOf('\n  function ',start+10);return html.slice(start,end);}
const ctx={state:{orders:[]},payrollSnapshots:[],payrollSnapshotMonth:'2026-11',Intl,Date,getCommissionPct:()=>80,getStaffById:()=>({name:'Changed'}),DEFAULT_COMMISSION_PCT:40};
vm.createContext(ctx);
['lineTotal','calcLineCommissions','payrollSourceOrders','localDateKey','salaryPeriodOrders','payrollOrdersForPeriod','aggregateCommissionsByStaff'].forEach(n=>vm.runInContext(fn(n),ctx));
ctx.payrollToday=()=> '2026-11-06';
const line={type:'work',qty:1,price:3000,assignees:['v'],payrollCommissions:[{staffId:'v',name:'Vadim',pct:40,amount:1200}]};
ctx.payrollSnapshots=[{month:'2026-10',orders:[{id:'old',status:'done',dateOut:'2026-10-30',lines:[line]}]}];
ctx.state.orders=[{id:'old',status:'done',dateOut:'2026-11-06',lines:[{type:'work',qty:1,price:90000,assignees:['v']}]},{id:'new',status:'done',dateOut:'2026-11-06',lines:[{type:'work',qty:1,price:1000,assignees:['v']}]},{id:'late-backdated',status:'done',dateOut:'2026-10-31',lines:[]}];
assert.equal(ctx.aggregateCommissionsByStaff(ctx.payrollOrdersForPeriod('2026-10')).v.amount,1200);
assert.equal(ctx.payrollOrdersForPeriod('2026-11').length,1);
assert.equal(ctx.aggregateCommissionsByStaff(ctx.payrollOrdersForPeriod('all')).v.amount,2000);
ctx.state.orders=[];assert.equal(ctx.payrollOrdersForPeriod('2026-10').length,1);
ctx.payrollSnapshots=null;assert.equal(ctx.payrollOrdersForPeriod('2026-10').length,0);
ctx.payrollSnapshots=[];ctx.payrollSnapshotMonth='2026-10';assert.equal(ctx.payrollSourceOrders().length,0);
console.log('PASS syntax, frozen amounts, changed rate, moved/deleted orders, no double counting, fail-closed loading, month rollover');
