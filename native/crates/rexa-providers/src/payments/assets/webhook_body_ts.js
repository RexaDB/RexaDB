async function claimEvent(stripeEventId, type, payload) {
  var existing = await sbGet('webhook_event', 'select=id,status&id=eq.' + encodeURIComponent(stripeEventId) + '&limit=1');
  if (existing.length > 0 && existing[0].status === 'processed') return 'duplicate';
  if (existing.length > 0) {
    await sbPatch('webhook_event', 'id=eq.' + encodeURIComponent(stripeEventId), { status: 'processing', error: null, payload: payload });
    return 'retry';
  }
  await sbInsert('webhook_event', [{ id: stripeEventId, type: type, payload: payload, status: 'processing', received_at: nowIso(), stripe_event_id: stripeEventId }]);
  return 'new';
}
async function finishEvent(stripeEventId, status, error) {
  await sbPatch('webhook_event', 'id=eq.' + encodeURIComponent(stripeEventId), { status: status, error: error, processed_at: nowIso() });
}
async function ensureCustomerRow(customerId, email, name, stripeCustomerId) {
  var rows = await sbGet('customer', 'select=id,email,name,stripe_customer_id&id=eq.' + encodeURIComponent(customerId) + '&limit=1');
  if (rows.length === 0) {
    await sbInsert('customer', [{ id: customerId, email: email || null, name: name || null, created_at: nowIso(), updated_at: nowIso(), stripe_customer_id: stripeCustomerId || null }]);
    return;
  }
  var patch = { updated_at: nowIso() };
  if (email && !rows[0].email) patch.email = email;
  if (name && !rows[0].name) patch.name = name;
  if (stripeCustomerId && rows[0].stripe_customer_id !== stripeCustomerId) patch.stripe_customer_id = stripeCustomerId;
  await sbPatch('customer', 'id=eq.' + encodeURIComponent(customerId), patch);
}
async function findCustomerByStripe(stripeCustomerId) {
  var rows = await sbGet('customer', 'select=id&stripe_customer_id=eq.' + encodeURIComponent(stripeCustomerId) + '&limit=1');
  return rows.length > 0 ? rows[0].id : null;
}
async function resolveProductInternal(priceId, metadataInternal) {
  if (metadataInternal) return metadataInternal;
  if (!priceId) throw new Error('cannot map subscription to a plan: no price on the Stripe subscription (run sync-products first)');
  var rows = await sbGet('product', 'select=internal_id&stripe_price_id=eq.' + encodeURIComponent(priceId) + '&limit=1');
  if (rows.length === 0) throw new Error('unknown Stripe price ' + priceId + ' (run sync-products first)');
  return rows[0].internal_id;
}
function mapSubStatus(st) {
  if (st === 'active' || st === 'trialing' || st === 'past_due' || st === 'unpaid' || st === 'paused') return st;
  if (st === 'canceled' || st === 'incomplete_expired') return st;
  return st || 'active';
}
async function upsertSubscriptionFromStripe(sub) {
  var stripeSubId = sub.id;
  var stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id) || null;
  if (!stripeCustomerId) throw new Error('stripe subscription ' + stripeSubId + ' has no customer');
  var customerId = await findCustomerByStripe(stripeCustomerId);
  if (!customerId) {
    var meta = sub.metadata || {};
    customerId = meta.paykit_customer_id || null;
  }
  if (!customerId) throw new Error('no paykit customer for stripe customer ' + stripeCustomerId);
  var item = sub.items && sub.items.data && sub.items.data[0];
  var priceId = item && item.price ? item.price.id : null;
  var productInternal = await resolveProductInternal(priceId, (sub.metadata || {}).paykit_product_internal_id);
  var status = mapSubStatus(sub.status);
  var ended = !!sub.ended_at || sub.status === 'canceled';
  var row = {
    customer_id: customerId, product_internal_id: productInternal, status: status,
    canceled: !!sub.cancel_at_period_end || status === 'canceled',
    cancel_at_period_end: !!sub.cancel_at_period_end,
    started_at: isoFromUnix(sub.start_date || sub.created), trial_ends_at: isoFromUnix(sub.trial_end),
    current_period_start_at: isoFromUnix(item ? item.current_period_start : sub.current_period_start),
    current_period_end_at: isoFromUnix(item ? item.current_period_end : sub.current_period_end),
    canceled_at: isoFromUnix(sub.canceled_at), ended_at: sub.ended_at ? isoFromUnix(sub.ended_at) : (status === 'canceled' ? nowIso() : null),
    quantity: (item && item.quantity) || 1, updated_at: nowIso(),
    stripe_subscription_id: stripeSubId, stripe_subscription_schedule_id: sub.schedule || null,
  };
  var existing = await sbGet('subscription', 'select=id&stripe_subscription_id=eq.' + encodeURIComponent(stripeSubId) + '&limit=1');
  if (existing.length > 0) { await sbPatch('subscription', 'id=eq.' + encodeURIComponent(existing[0].id), row); }
  else { row.id = 'sub_' + stripeSubId; row.created_at = nowIso(); await sbInsert('subscription', [row]); }
  await ensureCustomerRow(customerId, null, null, stripeCustomerId);
  await recomputeEntitlements(customerId);
  log('subscription.synced', { customer: customerId, stripeSub: stripeSubId, status: status });
  return customerId;
}
async function handleCheckoutCompleted(session) {
  var meta = session.metadata || {};
  var customerId = session.client_reference_id || meta.paykit_customer_id || null;
  var stripeCustomerId = typeof session.customer === 'string' ? session.customer : (session.customer && session.customer.id) || null;
  if (!customerId && stripeCustomerId) customerId = await findCustomerByStripe(stripeCustomerId);
  if (!customerId) throw new Error('checkout session ' + session.id + ' has no paykit customer reference');
  var details = session.customer_details || {};
  await ensureCustomerRow(customerId, session.customer_email || details.email || null, details.name || null, stripeCustomerId);
  await sbUpsert('metadata', [{ id: 'md_' + session.id, type: 'checkout_session', data: session, created_at: nowIso(), stripe_checkout_session_id: session.id }], 'id');
  var stripeSubId = typeof session.subscription === 'string' ? session.subscription : (session.subscription && session.subscription.id) || null;
  if (stripeSubId) {
    var sub = await stripeGet('/v1/subscriptions/' + encodeURIComponent(stripeSubId));
    return await upsertSubscriptionFromStripe(sub);
  }
  await recomputeEntitlements(customerId);
  return customerId;
}
async function handleInvoiceSucceeded(session, eventType) {
  var inv = session;
  var stripeCustomerId = typeof inv.customer === 'string' ? inv.customer : (inv.customer && inv.customer.id) || null;
  if (!stripeCustomerId) throw new Error('invoice ' + inv.id + ' has no customer');
  var customerId = await findCustomerByStripe(stripeCustomerId);
  if (!customerId) throw new Error('no paykit customer for stripe customer ' + stripeCustomerId);
  var stripeSubId = typeof inv.subscription === 'string' ? inv.subscription : (inv.subscription && inv.subscription.id) || null;
  var subRow = null;
  if (stripeSubId) { var r = await sbGet('subscription', 'select=id&stripe_subscription_id=eq.' + encodeURIComponent(stripeSubId) + '&limit=1'); if (r.length > 0) subRow = r[0].id; }
  var amount = inv.amount_paid != null ? inv.amount_paid : (inv.amount_due || 0);
  var row = { id: 'in_' + inv.id, customer_id: customerId, subscription_id: subRow, type: 'subscription', status: eventType === 'invoice.payment_failed' ? 'failed' : 'paid', amount: amount, currency: (inv.currency || 'usd').toLowerCase(), hosted_url: inv.hosted_invoice_url || null, period_start_at: isoFromUnix(inv.period_start), period_end_at: isoFromUnix(inv.period_end), updated_at: nowIso(), stripe_invoice_id: inv.id, stripe_payment_id: inv.payment_intent || null };
  var existing = await sbGet('invoice', 'select=id&stripe_invoice_id=eq.' + encodeURIComponent(inv.id) + '&limit=1');
  if (existing.length > 0) await sbPatch('invoice', 'id=eq.' + encodeURIComponent(existing[0].id), row);
  else { row.created_at = nowIso(); await sbInsert('invoice', [row]); }
  return customerId;
}
async function handlePaymentMethod(pm, remove) {
  var stripeCustomerId = typeof pm.customer === 'string' ? pm.customer : (pm.customer && pm.customer.id) || null;
  if (remove) {
    await sbDelete('payment_method', 'stripe_payment_method_id=eq.' + encodeURIComponent(pm.id));
    return null;
  }
  if (!stripeCustomerId) return null;
  var customerId = await findCustomerByStripe(stripeCustomerId);
  if (!customerId) return null;
  var card = pm.card || {};
  var row = { customer_id: customerId, updated_at: nowIso(), stripe_payment_method_id: pm.id, type: pm.type || (card.brand ? 'card' : null), brand: card.brand || null, last4: card.last4 || null, expiry_month: card.exp_month || null, expiry_year: card.exp_year || null };
  var existing = await sbGet('payment_method', 'select=id&stripe_payment_method_id=eq.' + encodeURIComponent(pm.id) + '&limit=1');
  if (existing.length > 0) await sbPatch('payment_method', 'id=eq.' + encodeURIComponent(existing[0].id), row);
  else { row.id = 'pm_' + pm.id; row.created_at = nowIso(); row.is_default = false; await sbInsert('payment_method', [row]); }
  return customerId;
}
async function handleStripeCustomer(obj) {
  var meta = obj.metadata || {};
  var customerId = meta.paykit_customer_id || null;
  if (!customerId) customerId = await findCustomerByStripe(obj.id);
  if (!customerId) return null;
  await sbPatch('customer', 'id=eq.' + encodeURIComponent(customerId), { email: obj.email || null, name: obj.name || null, updated_at: nowIso(), stripe_customer_id: obj.id, stripe_synced_email: obj.email || null, stripe_synced_name: obj.name || null });
  return customerId;
}
async function dispatchEvent(event) {
  var type = event.type;
  var obj = (event.data && event.data.object) || {};
  if (type === 'checkout.session.completed') return await handleCheckoutCompleted(obj);
  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') return await upsertSubscriptionFromStripe(obj);
  if (type === 'invoice.payment_succeeded' || type === 'invoice.payment_failed') return await handleInvoiceSucceeded(obj, type);
  if (type === 'payment_method.attached' || type === 'payment_method.updated') return await handlePaymentMethod(obj, false);
  if (type === 'payment_method.detached') return await handlePaymentMethod(obj, true);
  if (type === 'customer.created' || type === 'customer.updated') return await handleStripeCustomer(obj);
  log('webhook.ignored', { type: type });
  return null;
}
Deno.serve(async function(req) {
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!env('STRIPE_SECRET_KEY') || !env('STRIPE_WEBHOOK_SECRET')) { log('env.missing', {}); return json({ error: 'Server is misconfigured (missing Stripe secrets).' }, 500); }
    if (!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) { log('env.missing', {}); return json({ error: 'Server is misconfigured.' }, 500); }
    var raw = await req.text();
    var sig = req.headers.get('stripe-signature') || '';
    var valid = await verifyStripeSignature(raw, sig, env('STRIPE_WEBHOOK_SECRET'));
    if (!valid) return json({ error: 'Invalid Stripe signature.' }, 401);
    var event = null;
    try { event = JSON.parse(raw); } catch (_e) { return json({ error: 'Invalid JSON.' }, 400); }
    if (!event || !event.id || !event.type) return json({ error: 'Not a Stripe event.' }, 400);
    var claim = await claimEvent(event.id, event.type, event);
    if (claim === 'duplicate') return json({ received: true, deduped: true });
    try {
      await dispatchEvent(event);
      await finishEvent(event.id, 'processed', null);
      log('webhook.processed', { type: event.type });
      return json({ received: true });
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      log('webhook.failed', { type: event.type, error: msg });
      await finishEvent(event.id, 'failed', msg);
      return json({ error: 'Webhook handler failed.' }, 500);
    }
  } catch (err) {
    log('request.unhandled', { error: err && err.message ? err.message : String(err) });
    return json({ error: 'Something went wrong.' }, 500);
  }
});