const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
const names=["stockUnit","lineUnit","stockRound","stockAddAmount","displayedLineQty","bulkReceipt","stockUsageMap","checkStockAvailability","applyStockDiff","returnOrderStockToInventory"];
const code=names.map(name=>{const i=html.indexOf('function '+name+'('),begin=html.lastIndexOf('\n',i);let next=html.indexOf('\n  function ',i+1),as=html.indexOf('\n  async function ',i+1);if(as>=0&&(next<0||as<next))next=as;return html.slice(begin+1,next);}).join('\n');

(async()=>{
const assert=require('node:assert/strict');
let item={id:'oil',unit:'l',quantity:200,costPrice:250},saved=0;
const getStockItemById=id=>id==='oil'?item:null,saveStockItem=async()=>{saved++;return true;};
eval(code);
assert.deepEqual(bulkReceipt(200,1,50000),{quantity:200,costPrice:250,containerVolume:200});
assert.equal(bulkReceipt(200,2,50000).quantity,400);
assert.throws(()=>bulkReceipt(0,1,100));assert.throws(()=>bulkReceipt(200,1.5,100));assert.throws(()=>bulkReceipt(200,1,-1));
const line={type:'part',stockItemId:'oil',unit:'l',qty:4.5,price:325};
assert(checkStockAvailability(null,[line]).ok);await applyStockDiff(null,[line]);assert.equal(item.quantity,195.5);
const old={lines:[line]},edited={...line,qty:5};await applyStockDiff(old,[edited]);assert.equal(item.quantity,195);
await returnOrderStockToInventory({lines:[edited]});assert.equal(item.quantity,200);
assert(!checkStockAvailability(null,[{...line,qty:201}]).ok);
assert.equal(displayedLineQty(line),'4.5 л');assert.equal(stockUnit({}),'шт.');
assert.equal(stockAddAmount(item,0.5),0.5);
item.quantity=.3;assert(checkStockAvailability(null,[{...line,qty:.1},{...line,qty:.2}]).ok);await applyStockDiff(null,[{...line,qty:.1},{...line,qty:.2}]);assert.equal(item.quantity,0);
console.log('PASS barrel conversion, fractional write-off, edit delta, return, insufficient stock, precision and units');
})().catch(e=>{console.error(e);process.exitCode=1;});