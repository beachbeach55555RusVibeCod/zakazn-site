const SUPABASE_URL = 'https://gpxsygljqplztlzeieab.supabase.co';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function authorized(request, env) {
  const auth = request.headers.get('authorization') || '';
  return !!env.CHATGPT_API_SECRET && auth === 'Bearer ' + env.CHATGPT_API_SECRET;
}

async function sb(env, path, init = {}) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  const headers = new Headers(init.headers || {});
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set('authorization', 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { ...init, headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + (typeof body === 'string' ? body : JSON.stringify(body)));
  return body;
}

async function listKv(env, prefix) {
  const like = encodeURIComponent(prefix + '*');
  const rows = await sb(env, 'kv_store?select=key,value&key=like.' + like + '&limit=5000');
  return (rows || []).map(r => {
    let value = r.value;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch (_) {}
    }
    return { key: r.key, value };
  });
}

function norm(s) { return String(s || '').trim().toLowerCase(); }
function digits(s) { return String(s || '').replace(/\D/g, '').slice(-10); }
function plate(s) { return String(s || '').toUpperCase().replace(/[\s-]/g, ''); }
function vin(s) { return String(s || '').toUpperCase().replace(/\s/g, ''); }
function uid(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomUUID().slice(0, 8); }
function today() { return new Date().toISOString().slice(0, 10); }

async function putKv(env, key, value) {
  await sb(env, 'kv_store?on_conflict=key', {
    method: 'POST',
    headers: { 'prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value: JSON.stringify(value) })
  });
}

async function search(env, q) {
  const [clients, cars, orders] = await Promise.all([
    listKv(env, 'client:'), listKv(env, 'car:'), listKv(env, 'order:')
  ]);
  const nq = norm(q), dq = digits(q), pq = plate(q), vq = vin(q);
  const match = obj => {
    if (!q) return true;
    const hay = Object.values(obj || {}).filter(v => typeof v === 'string' || typeof v === 'number').join(' ').toLowerCase();
    return hay.includes(nq) ||
      (dq && digits(obj && obj.phone) === dq) ||
      (pq && plate(obj && obj.plate) === pq) ||
      (vq && vin(obj && obj.vin) === vq);
  };
  return {
    clients: clients.map(x => x.value).filter(match).slice(0, 20),
    cars: cars.map(x => x.value).filter(match).slice(0, 20),
    orders: orders.map(x => x.value).filter(match).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0, 30)
  };
}

async function createOrder(env, input) {
  if (!input || input.confirmed !== true) return json({ error: 'confirmation_required' }, 409);
  const [clientsRows, carsRows, ordersRows] = await Promise.all([
    listKv(env, 'client:'), listKv(env, 'car:'), listKv(env, 'order:')
  ]);
  const clients = clientsRows.map(x => x.value), cars = carsRows.map(x => x.value), orders = ordersRows.map(x => x.value);
  let client = input.clientId ? clients.find(c => c.id === input.clientId) : null;
  if (!client && input.clientPhone) client = clients.find(c => digits(c.phone) === digits(input.clientPhone));
  if (!client && input.clientName) {
    const n = norm(input.clientName);
    const matches = clients.filter(c => norm(c.name) === n || norm(c.orgName) === n);
    if (matches.length === 1) client = matches[0];
  }
  if (!client && (input.clientName || input.clientPhone)) {
    client = { id: uid('client'), name: input.clientName || '', phone: input.clientPhone || '', createdAt: Date.now() };
    await putKv(env, 'client:' + client.id, client);
  }

  let car = input.vehicleId ? cars.find(c => c.id === input.vehicleId) : null;
  if (!car && (input.plate || input.vin)) car = cars.find(c => (input.vin && vin(c.vin) === vin(input.vin)) || (input.plate && plate(c.plate) === plate(input.plate)));
  if (!car && (input.carMake || input.carModel || input.plate || input.vin)) {
    car = { id: uid('car'), clientId: client && client.id || null, carMake: input.carMake || '', carModel: input.carModel || '', vin: input.vin || '', plate: input.plate || '', createdAt: Date.now() };
    await putKv(env, 'car:' + car.id, car);
  }

  const year = new Date().getFullYear();
  let max = 0;
  for (const o of orders) {
    const m = String(o.orderNumber || '').match(/^(\d+)-(\d{4})$/);
    if (m && Number(m[2]) === year) max = Math.max(max, Number(m[1]));
  }
  const orderNumber = String(max + 1).padStart(4, '0') + '-' + year;
  const clientRate = Number(client && client.hourRate) || 0;
  const lines = (input.lines || []).map((l, i) => {
    const type = l.type === 'part' ? 'part' : 'work';
    const price = Number(l.price) || 0, qty = Number(l.qty) || 1;
    const line = { id: l.id || uid('line') + '_' + i, type, name: String(l.name || ''), qty, price };
    if (type === 'work') {
      line.assignees = Array.isArray(l.assignees) ? l.assignees : [];
      if (clientRate > 0) { line.hourRate = clientRate; line.normHours = Math.round((price / clientRate) * 100) / 100; }
    }
    return line;
  });
  const now = Date.now();
  const order = {
    id: uid('order'), orderNumber, status: 'new',
    dateIn: input.dateIn || today(), dateOut: input.dateOut || '',
    clientId: client && client.id || null, vehicleId: car && car.id || null,
    clientName: input.clientName || (client && (client.name || client.orgName)) || '',
    clientPhone: input.clientPhone || (client && client.phone) || '',
    carMake: input.carMake || (car && car.carMake) || '',
    carModel: input.carModel || (car && car.carModel) || '',
    vin: input.vin || (car && car.vin) || '', plate: input.plate || (car && car.plate) || '',
    mileage: input.mileage || '', master: input.master || '', complaint: input.complaint || '',
    notes: input.notes || '', lines, createdAt: now, updatedAt: now
  };
  await putKv(env, 'order:' + order.id, order);
  return json({ ok: true, order });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/health') return json({ ok: true, service: 'zakaz123-api' });
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
    try {
      if (request.method === 'GET' && url.pathname === '/api/search') return json(await search(env, url.searchParams.get('q') || ''));
      if (request.method === 'POST' && url.pathname === '/api/orders') return await createOrder(env, await request.json());
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'server_error', message: e && e.message ? e.message : String(e) }, 500);
    }
  }
};
