const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=readFileSync('index.html','utf8');
for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(m[1]);
function source(name){const start=html.indexOf('  async function '+name+'('); const end=html.indexOf('\n  }',start)+4; return html.slice(start,end);}
(async()=>{
 let calls=0, fail=false;
 const rows=Array.from({length:1201},(_,i)=>({value:JSON.stringify({id:String(i),name:String(i)})}));
 const ctx=vm.createContext({console:{warn(){},error(){}},state:{clients:[{id:'old'}]},showToast(){},getSB:()=>({from:()=>({select(){return this},like(){return this},order(){return this},async range(a,b){calls++; return fail&&a>0?{error:Error('network')}:{data:rows.slice(a,Math.min(b+1,a+200))};}})})});
 vm.runInContext(source('loadStoredItems')+'\n'+source('loadClients'),ctx);
 assert.equal((await ctx.loadStoredItems('client:')).length,1201);
 assert.equal(calls,8); // also tests server cap below requested page size
 fail=true; assert.equal(await ctx.loadClients(),false); assert.equal(ctx.state.clients[0].id,'old');
 fail=false; assert.equal(await ctx.loadClients(),true); assert.equal(ctx.state.clients.length,1201);
 const started=[],resolvers={};let migrated=0,seeded=0;
 const boot={renderCurrentView(){},startRealtimeSync(){},migrateLegacyOrdersToClients:async()=>migrated++,seedDefaultPriceListIfNeeded:async()=>seeded++};
 for(const n of ['Company','Staff','Orders','Clients','Cars','PriceList','StockItems','StockMarkup','Stickers']) boot['load'+n]=()=>{started.push(n);return new Promise(r=>resolvers[n]=r)};
 vm.createContext(boot);vm.runInContext(source('init'),boot);const ready=boot.init();
 assert.equal(started.length,9);resolvers.Stickers(true);await Promise.resolve();assert.equal(migrated,0);
 for(const [n,r] of Object.entries(resolvers))r(n!=='Clients');await ready;assert.equal(migrated,0);assert.equal(seeded,1);
 console.log('PASS: inline syntax, 1201 records with server page cap, atomic failure preservation, parallel startup, migration failure guard');
})().catch(e=>{console.error(e);process.exit(1)});
