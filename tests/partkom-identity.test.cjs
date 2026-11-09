const fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('function partkomIdentity('),html.indexOf('async function receivePartkomItem('));

const assert=require('node:assert/strict');
const state={stockItems:[{id:'old',sku:'AG696',brand:'GOODWILL',name:'Фильтр воздушный',partkomReceipts:['378421320|7|AG684']}]};
const api=new Function('state', source+';return {findStockItemForPartkom,partkomReceiptAlreadyReceived};')(state);
assert.equal(api.findStockItemForPartkom({sku:'AG684',brand:'GOODWILL',name:'Фильтр воздушный'}),null);
assert.equal(api.findStockItemForPartkom({sku:' ag 696 ',brand:'goodwill'}).id,'old');
assert.equal(api.findStockItemForPartkom({sku:'AG696',brand:'OTHER'}),null);
assert.equal(api.findStockItemForPartkom({sku:'',brand:'GOODWILL',name:'Фильтр воздушный'}),null);
assert.equal(api.partkomReceiptAlreadyReceived('378421320|7|AG684'),true);
assert.equal(api.partkomReceiptAlreadyReceived('new|1|AG684'),false);
state.stockItems.push({id:'new',sku:'AG684',brand:'GOODWILL',name:'Фильтр воздушный'});
assert.equal(api.findStockItemForPartkom({sku:'AG684',brand:'GOODWILL'}).id,'new');
console.log('PASS: distinct SKUs/brands, spacing, missing SKU and historical duplicate receipt');
