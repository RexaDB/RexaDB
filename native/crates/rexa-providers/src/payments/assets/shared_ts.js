function log(step, data) {
  try { console.log(JSON.stringify({ ts: new Date().toISOString(), step: step, data: data || null })); }
  catch (_e) { console.log('[paykit] ' + step); }
}
function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: corsHeaders() });
}
function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}
function env(name) { return Deno.env.get(name) || ''; }
// Supabase API keys: new sb_ names first, legacy JWT names as fallback.
// (The service_role *Postgres role* still exists — only the key format
// was deprecated. Grants in paykit-sql.ts target the role, unaffected.)
function svcKey() { return env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'); }
function pubKey() { return env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY'); }
function nowIso() { return new Date().toISOString(); }
function isoFromUnix(sec) {
  var n = Number(sec);
  if (!isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}
function resetSeconds(reset) {
  if (reset === 'day') return 86400;
  if (reset === 'week') return 604800;
  if (reset === 'year') return 31536000;
  return 2592000;
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function sbBase() { return env('SUPABASE_URL') + '/rest/v1'; }
function sbHeaders() {
  var key = svcKey();
  return { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Accept-Profile': 'paykit', 'Content-Profile': 'paykit' };
}
async function sbGet(table, query) {
  var res = await fetch(sbBase() + '/' + table + '?' + query, { headers: sbHeaders() });
  if (!res.ok) { var t = await res.text().catch(function() { return res.statusText; }); throw new Error('db select ' + table + ' failed (' + res.status + '): ' + t); }
  return await res.json();
}
async function sbInsert(table, rows) {
  var res = await fetch(sbBase() + '/' + table, { method: 'POST', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=representation' }), body: JSON.stringify(rows) });
  if (!res.ok) { var t = await res.text().catch(function() { return res.statusText; }); throw new Error('db insert ' + table + ' failed (' + res.status + '): ' + t); }
  return await res.json();
}
async function sbUpsert(table, rows, onConflict) {
  var res = await fetch(sbBase() + '/' + table + '?on_conflict=' + encodeURIComponent(onConflict), { method: 'POST', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify(rows) });
  if (!res.ok) { var t = await res.text().catch(function() { return res.statusText; }); throw new Error('db upsert ' + table + ' failed (' + res.status + '): ' + t); }
  return await res.json();
}
async function sbPatch(table, query, patch) {
  var res = await fetch(sbBase() + '/' + table + '?' + query, { method: 'PATCH', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=representation' }), body: JSON.stringify(patch) });
  if (!res.ok) { var t = await res.text().catch(function() { return res.statusText; }); throw new Error('db update ' + table + ' failed (' + res.status + '): ' + t); }
  return await res.json();
}
async function sbDelete(table, query) {
  var res = await fetch(sbBase() + '/' + table + '?' + query, { method: 'DELETE', headers: sbHeaders() });
  if (!res.ok) { var t = await res.text().catch(function() { return res.statusText; }); throw new Error('db delete ' + table + ' failed (' + res.status + '): ' + t); }
  return true;
}
async function stripeGet(path) {
  var res = await fetch('https://api.stripe.com' + path, { headers: { 'Authorization': 'Bearer ' + env('STRIPE_SECRET_KEY') } });
  var body = await res.json().catch(function() { return null; });
  if (!res.ok) throw new Error('stripe GET ' + path + ' failed (' + res.status + '): ' + JSON.stringify((body && body.error) || body));
  return body;
}
async function stripePost(path, params) {
  var form = new URLSearchParams();
  Object.keys(params).forEach(function(k) {
    var v = params[k];
    if (v === undefined || v === null) return;
    form.append(k, String(v));
  });
  var res = await fetch('https://api.stripe.com' + path, { method: 'POST', headers: { 'Authorization': 'Bearer ' + env('STRIPE_SECRET_KEY'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  var body = await res.json().catch(function() { return null; });
  if (!res.ok) throw new Error('stripe POST ' + path + ' failed (' + res.status + '): ' + JSON.stringify((body && body.error) || body));
  return body;
}
async function verifyStripeSignature(raw, header, secret) {
  try {
    var parts = String(header || '').split(',');
    var t = ''; var sigs = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.indexOf('t=') === 0) t = p.slice(2);
      else if (p.indexOf('v1=') === 0) sigs.push(p.slice(3));
    }
    if (!t || sigs.length === 0) return false;
    var now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(t, 10)) > 300) return false;
    var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    var mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + raw));
    var bytes = new Uint8Array(mac);
    var hex = '';
    for (var j = 0; j < bytes.length; j++) { var h = bytes[j].toString(16); hex += h.length === 1 ? '0' + h : h; }
    for (var k = 0; k < sigs.length; k++) { if (safeEqual(hex, sigs[k])) return true; }
    return false;
  } catch (_e) { return false; }
}
function findPlan(planId) {
  for (var i = 0; i < PAYKIT_DATA.plans.length; i++) { if (PAYKIT_DATA.plans[i].id === planId) return PAYKIT_DATA.plans[i]; }
  return null;
}
function findFeature(featureId) {
  for (var i = 0; i < PAYKIT_DATA.features.length; i++) { if (PAYKIT_DATA.features[i].id === featureId) return PAYKIT_DATA.features[i]; }
  return null;
}
function internalId(planId) { return planId + ':v1'; }
async function recomputeEntitlements(customerId) {
  var subs = await sbGet('subscription', 'select=id,product_internal_id,status,canceled,ended_at,updated_at&customer_id=eq.' + encodeURIComponent(customerId) + '&order=updated_at.desc&limit=20');
  var chosen = null;
  for (var i = 0; i < subs.length; i++) {
    var s = subs[i];
    if ((s.status === 'active' || s.status === 'trialing') && !s.canceled && !s.ended_at) { chosen = s; break; }
  }
  var plan = null;
  if (chosen) {
    for (var p = 0; p < PAYKIT_DATA.plans.length; p++) { if (internalId(PAYKIT_DATA.plans[p].id) === chosen.product_internal_id) { plan = PAYKIT_DATA.plans[p]; break; } }
  }
  if (!plan) {
    for (var d = 0; d < PAYKIT_DATA.plans.length; d++) { if (PAYKIT_DATA.plans[d].default) { plan = PAYKIT_DATA.plans[d]; break; } }
  }
  await sbDelete('entitlement', 'customer_id=eq.' + encodeURIComponent(customerId));
  if (!plan) return { plan: null };
  var rows = [];
  for (var k = 0; k < plan.includes.length; k++) {
    var inc = plan.includes[k];
    var feat = findFeature(inc.featureId);
    if (!feat) continue;
    var row = { id: customerId + '__' + inc.featureId, customer_id: customerId, subscription_id: chosen ? chosen.id : null, feature_id: inc.featureId, limit: null, balance: null, next_reset_at: null, created_at: nowIso(), updated_at: nowIso() };
    if (feat.type === 'metered') {
      row.limit = inc.limit;
      row.balance = inc.limit;
      row.next_reset_at = new Date(Date.now() + resetSeconds(inc.reset || 'month') * 1000).toISOString();
    }
    rows.push(row);
  }
  if (rows.length > 0) await sbInsert('entitlement', rows);
  return { plan: plan.id };
}