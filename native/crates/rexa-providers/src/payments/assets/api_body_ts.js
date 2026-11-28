async function getAuthUserId(req) {
  var auth = req.headers.get('Authorization') || '';
  if (auth.indexOf('Bearer ') !== 0) return null;
  var anon = pubKey();
  if (!anon) return null;
  try {
    var res = await fetch(env('SUPABASE_URL') + '/auth/v1/user', { headers: { 'apikey': anon, 'Authorization': auth } });
    if (!res.ok) return null;
    var user = await res.json();
    return (user && user.id) || null;
  } catch (_e) { return null; }
}
async function resolveCustomerId(authId, requested) {
  var id = (requested && String(requested)) || authId;
  if (!id) throw new Error('No customer. Sign in first.');
  if (requested && requested !== authId) { var err = new Error('Forbidden.'); err.status = 403; throw err; }
  return id;
}
async function getAdminEmail(userId) {
  try {
  var key = svcKey();
    var res = await fetch(env('SUPABASE_URL') + '/auth/v1/admin/users/' + encodeURIComponent(userId), { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    if (!res.ok) return null;
    var u = await res.json();
    return (u && u.email) || null;
  } catch (_e) { return null; }
}
async function findEntitlementFeature(id) {
  var queries = ['lookup_key=' + encodeURIComponent(id), 'lookup_keys[]=' + encodeURIComponent(id)];
  for (var q = 0; q < queries.length; q++) {
    try {
      var found = await stripeGet('/v1/entitlements/features?' + queries[q] + '&limit=1');
      if (found && found.data && found.data.length > 0) return found.data[0];
      return null;
    } catch (e) {
      var msg = e && e.message ? e.message : '';
      if (msg.indexOf('parameter_unknown') !== -1 && q + 1 < queries.length) continue;
      throw e;
    }
  }
  return null;
}
async function syncProductsInternal() {
  var results = [];
  for (var f = 0; f < PAYKIT_DATA.features.length; f++) {
    var feat = PAYKIT_DATA.features[f];
    await sbUpsert('feature', [{ id: feat.id, type: feat.type, created_at: nowIso(), updated_at: nowIso() }], 'id');
  }
  var entMap = {};
  for (var f = 0; f < PAYKIT_DATA.features.length; f++) {
    var feat = PAYKIT_DATA.features[f];
    var ent = await findEntitlementFeature(feat.id);
    if (!ent) {
      ent = await stripePost('/v1/entitlements/features', { lookup_key: feat.id, name: feat.description || feat.id });
    }
    entMap[feat.id] = ent.id;
  }
  for (var p = 0; p < PAYKIT_DATA.plans.length; p++) {
    var plan = PAYKIT_DATA.plans[p];
    var iid = internalId(plan.id);
    var existing = await sbGet('product', 'select=internal_id,price_amount,price_interval,stripe_product_id,stripe_price_id&internal_id=eq.' + encodeURIComponent(iid) + '&limit=1');
    var row = existing.length > 0 ? existing[0] : null;
    var stripeProductId = row ? row.stripe_product_id : null;
    var stripePriceId = row ? row.stripe_price_id : null;
    var cents = plan.priceAmount != null ? Math.round(Number(plan.priceAmount) * 100) : null;
    var interval = plan.priceInterval || 'month';
    if (!plan.default && !stripeProductId) {
      var prod = await stripePost('/v1/products', { name: plan.name, 'metadata[paykit_plan_id]': plan.id, 'metadata[paykit_hash]': PAYKIT_HASH });
      stripeProductId = prod.id;
    }
    if (!plan.default && cents != null && (!stripePriceId || (row && (row.price_amount !== cents || row.price_interval !== interval)))) {
      var price = await stripePost('/v1/prices', { product: stripeProductId, unit_amount: cents, currency: (plan.priceCurrency || 'usd').toLowerCase(), 'recurring[interval]': interval, 'metadata[paykit_plan_id]': plan.id });
      stripePriceId = price.id;
    }
    var full = { internal_id: iid, id: plan.id, version: 1, name: plan.name, group: plan.group || 'base', is_default: !!plan.default, price_amount: cents, price_interval: cents != null ? interval : null, price_currency: cents != null ? (plan.priceCurrency || 'usd').toLowerCase() : null, hash: PAYKIT_HASH, updated_at: nowIso(), stripe_product_id: stripeProductId, stripe_price_id: stripePriceId };
    if (row) await sbPatch('product', 'internal_id=eq.' + encodeURIComponent(iid), full);
    else { full.created_at = nowIso(); await sbInsert('product', [full]); }
    await sbDelete('product_feature', 'product_internal_id=eq.' + encodeURIComponent(iid));
    if (plan.includes.length > 0) {
      var links = [];
      for (var k = 0; k < plan.includes.length; k++) { var inc = plan.includes[k]; links.push({ product_internal_id: iid, feature_id: inc.featureId, limit: inc.limit != null ? inc.limit : null, reset_interval: inc.reset || null, created_at: nowIso(), updated_at: nowIso() }); }
      await sbInsert('product_feature', links);
    }
    var attachedFeatures = [];
    if (stripeProductId) {
      var listed = await stripeGet('/v1/products/' + encodeURIComponent(stripeProductId) + '/features?limit=100');
      var haveEnt = {};
      var listedData = (listed && listed.data) || [];
      for (var a = 0; a < listedData.length; a++) {
        var ef = listedData[a].entitlement_feature;
        haveEnt[typeof ef === 'string' ? ef : (ef && ef.id)] = true;
      }
      for (var k = 0; k < plan.includes.length; k++) {
        var eid = entMap[plan.includes[k].featureId];
        if (eid && !haveEnt[eid]) {
          await stripePost('/v1/products/' + encodeURIComponent(stripeProductId) + '/features', { entitlement_feature: eid });
          haveEnt[eid] = true;
          attachedFeatures.push(eid);
        }
      }
    }
    results.push({ plan: plan.id, internalId: iid, stripeProductId: stripeProductId, stripePriceId: stripePriceId, featuresAttached: attachedFeatures });
  }
  return results;
}
async function ensureStripeCustomer(customerId, email, name) {
  var rows = await sbGet('customer', 'select=id,email,name,stripe_customer_id&id=eq.' + encodeURIComponent(customerId) + '&limit=1');
  var row = rows.length > 0 ? rows[0] : null;
  if (!row) {
    await sbInsert('customer', [{ id: customerId, email: email || null, name: name || null, created_at: nowIso(), updated_at: nowIso() }]);
    row = { id: customerId, stripe_customer_id: null };
  }
  if (row.stripe_customer_id) return row.stripe_customer_id;
  var params = { 'metadata[paykit_customer_id]': customerId };
  if (email || row.email) params.email = email || row.email;
  if (name || row.name) params.name = name || row.name;
  var c = await stripePost('/v1/customers', params);
  await sbPatch('customer', 'id=eq.' + encodeURIComponent(customerId), { stripe_customer_id: c.id, stripe_synced_email: c.email || null, updated_at: nowIso() });
  return c.id;
}
async function actionSubscribe(authId, body) {
  var plan = findPlan(body.planId);
  if (!plan) { var e = new Error('Unknown plan.'); e.status = 400; throw e; }
  var customerId = await resolveCustomerId(authId, body.customerId);
  var email = await getAdminEmail(customerId);
  await ensureStripeCustomer(customerId, email || body.email || null, body.name || null);
  var iid = internalId(plan.id);
  if (plan.default) {
    var active = await sbGet('subscription', 'select=id&customer_id=eq.' + encodeURIComponent(customerId) + '&canceled=eq.false&order=updated_at.desc&limit=5');
    if (active.length > 0) {
      await sbPatch('subscription', 'id=eq.' + encodeURIComponent(active[0].id), { cancel_at_period_end: true, canceled: true, scheduled_product_id: iid, updated_at: nowIso() });
      return { active: false, scheduled: true, message: 'Paid plan stays active until period end, then moves to ' + plan.id + '.' };
    }
    await recomputeEntitlements(customerId);
    return { active: true, plan: plan.id };
  }
  var products = await sbGet('product', 'select=stripe_price_id&internal_id=eq.' + encodeURIComponent(iid) + '&limit=1');
  if (products.length === 0 || !products[0].stripe_price_id) await syncProductsInternal();
  products = await sbGet('product', 'select=stripe_price_id&internal_id=eq.' + encodeURIComponent(iid) + '&limit=1');
  if (products.length === 0 || !products[0].stripe_price_id) throw new Error('Plan has no Stripe price (sync-products failed).');
  var stripeCustomerId = await ensureStripeCustomer(customerId, email || body.email || null, body.name || null);
  var successUrl = body.successUrl || '';
  var cancelUrl = body.cancelUrl || successUrl || '';
  if (!successUrl) { var se = new Error('successUrl is required for paid plans.'); se.status = 400; throw se; }
  var session = await stripePost('/v1/checkout/sessions', {
    mode: 'subscription', customer: stripeCustomerId, 'line_items[0][price]': products[0].stripe_price_id, 'line_items[0][quantity]': 1,
    success_url: successUrl, cancel_url: cancelUrl, client_reference_id: customerId,
    'metadata[paykit_customer_id]': customerId, 'metadata[paykit_product_internal_id]': iid,
    'subscription_data[metadata][paykit_customer_id]': customerId, 'subscription_data[metadata][paykit_product_internal_id]': iid,
  });
  await sbUpsert('metadata', [{ id: 'md_' + session.id, type: 'checkout_session', data: session, created_at: nowIso(), stripe_checkout_session_id: session.id }], 'id');
  return { paymentUrl: session.url, checkoutSessionId: session.id };
}
async function lazyReset(row) {
  if (!row.next_reset_at) return row;
  if (Date.now() < Date.parse(row.next_reset_at)) return row;
  var feat = findFeature(row.feature_id);
  var planRows = await sbGet('product_feature', 'select=limit,reset_interval&feature_id=eq.' + encodeURIComponent(row.feature_id) + '&limit=1');
  var limit = row.limit != null ? row.limit : (planRows.length > 0 ? planRows[0].limit : null);
  var reset = planRows.length > 0 ? (planRows[0].reset_interval || 'month') : 'month';
  if (feat && feat.type !== 'metered') return row;
  var patched = await sbPatch('entitlement', 'id=eq.' + encodeURIComponent(row.id), { balance: limit, next_reset_at: new Date(Date.now() + resetSeconds(reset) * 1000).toISOString(), updated_at: nowIso() });
  return patched.length > 0 ? patched[0] : row;
}
async function actionCheck(authId, body) {
  if (!body.featureId) { var e1 = new Error('featureId is required.'); e1.status = 400; throw e1; }
  var customerId = await resolveCustomerId(authId, body.customerId);
  var feat = findFeature(body.featureId);
  var rows = await sbGet('entitlement', 'select=id,feature_id,limit,balance,next_reset_at&customer_id=eq.' + encodeURIComponent(customerId) + '&feature_id=eq.' + encodeURIComponent(body.featureId) + '&limit=1');
  if (rows.length === 0) return { allowed: false, balance: null };
  var row = await lazyReset(rows[0]);
  if (!feat || feat.type === 'boolean') return { allowed: true, balance: null };
  var limit = row.limit;
  var remaining = row.balance == null ? limit : row.balance;
  return { allowed: remaining == null || remaining > 0, balance: { remaining: remaining, limit: limit, resetAt: row.next_reset_at } };
}
async function actionReport(authId, body) {
  if (!body.featureId) { var e2 = new Error('featureId is required.'); e2.status = 400; throw e2; }
  var amount = body.amount != null ? Number(body.amount) : 1;
  if (!isFinite(amount) || amount <= 0) { var e3 = new Error('amount must be a positive number.'); e3.status = 400; throw e3; }
  var customerId = await resolveCustomerId(authId, body.customerId);
  var rows = await sbGet('entitlement', 'select=id,feature_id,limit,balance,next_reset_at&customer_id=eq.' + encodeURIComponent(customerId) + '&feature_id=eq.' + encodeURIComponent(body.featureId) + '&limit=1');
  if (rows.length === 0) return { allowed: false, balance: null };
  var row = await lazyReset(rows[0]);
  var limit = row.limit;
  var remaining = row.balance == null ? limit : row.balance;
  if (remaining == null) return { allowed: true, balance: { remaining: null, limit: limit, resetAt: row.next_reset_at } };
  var next = Math.max(0, remaining - amount);
  var patched = await sbPatch('entitlement', 'id=eq.' + encodeURIComponent(row.id), { balance: next, updated_at: nowIso() });
  var r = patched.length > 0 ? patched[0] : row;
  return { allowed: (r.balance != null ? r.balance : 0) > 0, balance: { remaining: r.balance, limit: limit, resetAt: r.next_reset_at } };
}
async function actionPlan(authId, body) {
  var customerId = await resolveCustomerId(authId, body.customerId);
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
  if (!plan) return { planId: null, planName: null, isDefault: false, status: 'none', entitlements: [] };
  var rows = await sbGet('entitlement', 'select=feature_id,limit,balance,next_reset_at&customer_id=eq.' + encodeURIComponent(customerId));
  var entitlements = [];
  for (var k = 0; k < rows.length; k++) {
    var r = rows[k];
    var feat = findFeature(r.feature_id);
    entitlements.push({ featureId: r.feature_id, type: feat ? feat.type : 'unknown', limit: r.limit, balance: r.balance, resetAt: r.next_reset_at });
  }
  return { planId: plan.id, planName: plan.name, isDefault: !!plan.default, status: chosen ? chosen.status : 'none', entitlements: entitlements };
}
async function sbCount(table) {
  try {
    var res = await fetch(sbBase() + '/' + table + '?select=id', { method: 'HEAD', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'count=exact' }) });
    var range = res.headers.get('content-range') || '';
    var m = range.match(/\/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
  } catch (_e) { return null; }
}
Deno.serve(async function(req) {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
    if (!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) return json({ error: 'Server is misconfigured.' }, 500);
    var url = new URL(req.url);
    var action = url.searchParams.get('action') || '';
    var body = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch (_e) { body = {}; } }
    if (!action && body.action) action = String(body.action);
    if (!action && url.pathname.split('/').pop() !== 'paykit-api') action = url.pathname.split('/').pop() || '';
    if (action === 'status') {
      var customers = await sbCount('customer');
      var subs = await sbCount('subscription');
      var events = await sbCount('webhook_event');
      return json({ ok: true, draftHash: PAYKIT_HASH, schemaVersion: PAYKIT_SCHEMA, templateVersion: PAYKIT_TEMPLATE_VERSION, plans: PAYKIT_DATA.plans.map(function(p) { return { id: p.id, name: p.name, group: p.group, default: !!p.default }; }), counts: { customers: customers, subscriptions: subs, events: events }, stripeConfigured: !!env('STRIPE_SECRET_KEY') });
    }
    var authId = await getAuthUserId(req);
    // RexaDB sidecar admin path: calls bearing the service_role key may run
    // sync-products (one-click Sync in the app) without a user session.
    // The key never leaves the server / sidecar — it is compared here only.
    // Distinct 401 codes (never the key itself) tell the app exactly why:
    // plain Unauthorized = pre-admin-path bundle; admin-key-mismatch =
    // live bundle whose env key differs; no-service-key-env = env lacks it.
    var reqKey = req.headers.get('apikey') || '';
    var adminKey = svcKey() || '';
    var isAdmin = !!adminKey && safeEqual(reqKey, adminKey);
    if (!authId && !isAdmin && action === 'sync-products') {
      // Owner-proof fallback: a valid Management API token for THIS project
      // also authorizes sync. Covers key-format divergence (masked/rotated
      // secrets the caller can never reproduce byte-for-byte). The ref is
      // derived from this function's own URL, so a token for project B
      // presented to project A fails closed. Validated live; nothing stored.
      var mgmtToken = req.headers.get('x-rexadb-mgmt') || '';
      if (mgmtToken) {
        try {
          var refHost = String(env('SUPABASE_URL') || '');
          var ref = refHost.replace('https://', '').replace('http://', '').split('.')[0].split('/')[0];
          if (ref) {
            var ctrl = new AbortController();
            var timer = setTimeout(function() { ctrl.abort(); }, 15000);
            var chk = await fetch('https://api.supabase.com/v1/projects/' + ref, { headers: { 'Authorization': 'Bearer ' + mgmtToken }, signal: ctrl.signal });
            clearTimeout(timer);
            if (chk.status === 200 || chk.status === 201) isAdmin = true;
          }
        } catch (_e) { /* fall through to 401 below */ }
      }
    }
    if (!authId && !(isAdmin && action === 'sync-products')) {
      if (action === 'sync-products' && reqKey) {
        if (!adminKey) return json({ error: 'Unauthorized.', code: 'no-service-key-env' }, 401);
        // Owner-only diagnostics: lengths in the response, prefixes in the
        // dashboard logs — never key material. Length divergence (e.g. 40
        // vs 200+ chars) exposes legacy-JWT vs new-format key mismatches.
        log('sync.auth', { reqLen: reqKey.length, envLen: adminKey.length, reqPrefix: reqKey.slice(0, 4), envPrefix: adminKey.slice(0, 4) });
        return json({ error: 'Unauthorized.', code: 'admin-key-mismatch', detail: { reqLen: reqKey.length, envLen: adminKey.length } }, 401);
      }
      return json({ error: 'Unauthorized.' }, 401);
    }
    if (action === 'upsert-customer') {
      var cid = await resolveCustomerId(authId, body.customerId);
      var em = body.email || (await getAdminEmail(cid));
      await ensureStripeCustomer(cid, em, body.name || null);
      await recomputeEntitlements(cid);
      return json({ ok: true, customerId: cid });
    }
    if (action === 'subscribe') return json(Object.assign({ ok: true }, await actionSubscribe(authId, body)));
    if (action === 'check') return json(Object.assign({ ok: true }, await actionCheck(authId, body)));
    if (action === 'report') return json(Object.assign({ ok: true }, await actionReport(authId, body)));
    if (action === 'plan') return json(Object.assign({ ok: true }, await actionPlan(authId, body)));
    if (action === 'sync-products') {
      if (!env('STRIPE_SECRET_KEY')) return json({ error: 'Missing STRIPE_SECRET_KEY.' }, 500);
      try {
        return json({ ok: true, products: await syncProductsInternal() });
      } catch (err) {
        var syncErr = err && err.message ? err.message : String(err);
        log('sync.failed', { error: syncErr });
        if (isAdmin) return json({ ok: false, error: syncErr }, 500);
        throw err;
      }
    }
    if (action === 'list-customers') {
      var cl = await sbGet('customer', 'select=id,email,name,stripe_customer_id,created_at&order=created_at.desc&limit=50');
      return json({ ok: true, customers: cl });
    }
    if (action === 'list-subscriptions') {
      var sl = await sbGet('subscription', 'select=id,customer_id,product_internal_id,status,cancel_at_period_end,current_period_end_at,stripe_subscription_id,updated_at&order=updated_at.desc&limit=50');
      return json({ ok: true, subscriptions: sl });
    }
    return json({ error: 'Unknown action. Use status|upsert-customer|subscribe|check|report|plan|sync-products|list-customers|list-subscriptions.' }, 404);
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    var status = err && err.status ? err.status : 500;
    log('api.failed', { error: msg });
    return json({ error: status === 500 ? 'Something went wrong.' : msg }, status);
  }
});