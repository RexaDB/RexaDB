-- PostgreSQL mega seed script for stress-testing tools and editors.
-- WARNING: This creates millions of rows and can consume many GB of disk.
-- Target: PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP SCHEMA IF EXISTS rexadb_demo CASCADE;
CREATE SCHEMA rexadb_demo;
SET search_path TO rexadb_demo, public;

CREATE TYPE order_status AS ENUM ('draft', 'pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded');
CREATE DOMAIN email_addr AS text CHECK (POSITION('@' IN VALUE) > 1);

CREATE TABLE datatype_showcase (
  id bigserial PRIMARY KEY,
  c_smallint smallint,
  c_integer integer,
  c_bigint bigint,
  c_numeric numeric(20,6),
  c_real real,
  c_double double precision,
  c_serial serial,
  c_bigserial bigserial,
  c_money money,
  c_bool boolean,
  c_text text,
  c_varchar varchar(255),
  c_char char(10),
  c_bytea bytea,
  c_uuid uuid,
  c_json json,
  c_jsonb jsonb,
  c_xml xml,
  c_int_array integer[],
  c_text_array text[],
  c_date date,
  c_time time,
  c_timetz timetz,
  c_timestamp timestamp,
  c_timestamptz timestamptz,
  c_interval interval,
  c_bit bit(8),
  c_varbit varbit,
  c_inet inet,
  c_cidr cidr,
  c_macaddr macaddr,
  c_point point,
  c_line line,
  c_lseg lseg,
  c_box box,
  c_path path,
  c_polygon polygon,
  c_circle circle,
  c_tsvector tsvector,
  c_tsquery tsquery,
  c_int4range int4range,
  c_numrange numrange,
  c_tsrange tsrange,
  c_tstzrange tstzrange,
  c_daterange daterange,
  c_jsonpath jsonpath,
  c_pg_lsn pg_lsn,
  c_status order_status,
  c_email email_addr,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  email email_addr NOT NULL,
  display_name text NOT NULL,
  passwd_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  locale varchar(16) NOT NULL DEFAULT 'en-US',
  role text NOT NULL DEFAULT 'member',
  signup_ip inet,
  signup_source jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE warehouse (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code text NOT NULL,
  location point,
  capacity bigint NOT NULL DEFAULT 0,
  active_window tsrange,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE product (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  sku text NOT NULL,
  title text NOT NULL,
  description text,
  attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  price numeric(12,2) NOT NULL,
  weight_kg numeric(8,3),
  barcode bytea,
  vector_hint tsvector,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE TABLE inventory (
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  warehouse_id bigint NOT NULL REFERENCES warehouse(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0,
  reorder_threshold integer NOT NULL DEFAULT 10,
  bin_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_id, warehouse_id)
);

CREATE TABLE customer (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email email_addr,
  phone text,
  birth_date date,
  loyalty_points integer NOT NULL DEFAULT 0,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  geo point,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE address (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('billing', 'shipping', 'other')),
  line1 text NOT NULL,
  line2 text,
  city text NOT NULL,
  region text,
  postal_code text,
  country char(2) NOT NULL,
  geocode point,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
  billing_address_id bigint REFERENCES address(id) ON DELETE SET NULL,
  shipping_address_id bigint REFERENCES address(id) ON DELETE SET NULL,
  status order_status NOT NULL DEFAULT 'draft',
  currency char(3) NOT NULL DEFAULT 'USD',
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  active_window tstzrange,
  search_vector tsvector,
  placed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_item (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  qty integer NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  line_total numeric(14,2) GENERATED ALWAYS AS ((qty::numeric * unit_price)) STORED,
  attrs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_ref text NOT NULL,
  amount numeric(14,2) NOT NULL,
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  raw_response jsonb,
  UNIQUE (provider, provider_ref)
);

CREATE TABLE shipment (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  tracking_no text,
  carrier text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  route path,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier, tracking_no)
);

CREATE TABLE event_log (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id bigint,
  action text NOT NULL,
  payload jsonb NOT NULL,
  actor_user_id bigint,
  source_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  operation text NOT NULL,
  row_pk text,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION set_order_search_vector()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', coalesce(NEW.notes, '') || ' ' || coalesce(NEW.status::text, ''));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION recalc_order_total(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE orders o
  SET total_amount = COALESCE(x.total, 0),
      updated_at = now()
  FROM (
    SELECT order_id, SUM(line_total)::numeric(14,2) AS total
    FROM order_item
    WHERE order_id = p_order_id
    GROUP BY order_id
  ) AS x
  WHERE o.id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION trg_recalc_order_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_id bigint;
BEGIN
  target_id := COALESCE(NEW.order_id, OLD.order_id);
  PERFORM recalc_order_total(target_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION trg_audit_customer_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO audit_log(table_name, operation, row_pk, old_data, new_data)
  VALUES ('customer', TG_OP, COALESCE(NEW.id, OLD.id)::text, to_jsonb(OLD), to_jsonb(NEW));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION fn_top_customers(p_tenant_id bigint, p_limit integer DEFAULT 20)
RETURNS TABLE(customer_id bigint, customer_name text, order_count bigint, total_spend numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.full_name,
    COUNT(o.id) AS order_count,
    COALESCE(SUM(o.total_amount), 0)::numeric AS total_spend
  FROM customer c
  LEFT JOIN orders o ON o.customer_id = c.id
  WHERE c.tenant_id = p_tenant_id
  GROUP BY c.id, c.full_name
  ORDER BY total_spend DESC
  LIMIT p_limit;
$$;

CREATE TRIGGER trg_tenant_updated_at BEFORE UPDATE ON tenant FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_user_updated_at BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_product_updated_at BEFORE UPDATE ON product FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_customer_updated_at BEFORE UPDATE ON customer FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orders_search_vector BEFORE INSERT OR UPDATE OF notes, status ON orders FOR EACH ROW EXECUTE FUNCTION set_order_search_vector();
CREATE TRIGGER trg_order_item_recalc AFTER INSERT OR UPDATE OR DELETE ON order_item FOR EACH ROW EXECUTE FUNCTION trg_recalc_order_total();
CREATE TRIGGER trg_customer_audit AFTER INSERT OR UPDATE OR DELETE ON customer FOR EACH ROW EXECUTE FUNCTION trg_audit_customer_changes();

CREATE UNIQUE INDEX idx_app_user_tenant_email ON app_user (tenant_id, lower(email));
CREATE INDEX idx_customer_tenant_created ON customer (tenant_id, created_at DESC);
CREATE INDEX idx_customer_email_expr ON customer (lower(email));
CREATE INDEX idx_product_tenant_price ON product (tenant_id, price);
CREATE INDEX idx_product_attrs_gin ON product USING gin (attrs);
CREATE INDEX idx_product_tags_gin ON product USING gin (tags);
CREATE INDEX idx_inventory_low_stock_partial ON inventory (tenant_id, product_id) WHERE quantity <= reorder_threshold;
CREATE INDEX idx_orders_customer_status ON orders (customer_id, status);
CREATE INDEX idx_orders_search_vector_gin ON orders USING gin (search_vector);
CREATE INDEX idx_orders_active_window_gist ON orders USING gist (active_window);
CREATE INDEX idx_order_item_order_id ON order_item (order_id);
CREATE INDEX idx_event_log_created_brin ON event_log USING brin (created_at);
CREATE INDEX idx_event_log_payload_gin ON event_log USING gin (payload);

INSERT INTO datatype_showcase (
  c_smallint, c_integer, c_bigint, c_numeric, c_real, c_double, c_money, c_bool,
  c_text, c_varchar, c_char, c_bytea, c_uuid, c_json, c_jsonb, c_xml,
  c_int_array, c_text_array, c_date, c_time, c_timetz, c_timestamp, c_timestamptz, c_interval,
  c_bit, c_varbit, c_inet, c_cidr, c_macaddr, c_point, c_line, c_lseg, c_box, c_path, c_polygon, c_circle,
  c_tsvector, c_tsquery, c_int4range, c_numrange, c_tsrange, c_tstzrange, c_daterange, c_jsonpath, c_pg_lsn,
  c_status, c_email
)
SELECT
  12,
  12345,
  1234567890123,
  12345.678901,
  1.25,
  3.1415926535,
  99.99::money,
  true,
  'sample text',
  'varchar sample',
  'charval',
  decode('DEADBEEF', 'hex'),
  gen_random_uuid(),
  '{"a":1,"b":"x"}'::json,
  '{"nested":{"x":1},"tags":["a","b"]}'::jsonb,
  xmlparse(document '<root><node v="1"/></root>'),
  ARRAY[1,2,3,4],
  ARRAY['a','b','c'],
  current_date,
  current_time,
  current_time::timetz,
  now()::timestamp,
  now(),
  interval '3 days 4 hours',
  B'10101010',
  B'111000111'::varbit,
  '10.10.10.1'::inet,
  '10.10.0.0/16'::cidr,
  '08:00:2b:01:02:03'::macaddr,
  '(1.5,2.5)'::point,
  '{1,-1,0}'::line,
  '[(0,0),(3,4)]'::lseg,
  '(0,0),(5,5)'::box,
  '[(0,0),(2,2),(4,1)]'::path,
  '((0,0),(3,0),(3,3),(0,3))'::polygon,
  '<(2,2),3>'::circle,
  to_tsvector('english', 'the quick brown fox'),
  plainto_tsquery('english', 'quick fox'),
  int4range(1,100,'[]'),
  numrange(0.1, 9.9, '[)'),
  tsrange(now()::timestamp, (now() + interval '1 day')::timestamp, '[)'),
  tstzrange(now(), now() + interval '1 day', '[)'),
  daterange(current_date, current_date + 7, '[)'),
  '$.nested.x'::jsonpath,
  '0/16B6C50'::pg_lsn,
  'pending'::order_status,
  'demo@example.com'::email_addr
FROM generate_series(1, 10000);

INSERT INTO tenant(code, name, metadata)
SELECT
  format('TEN%03s', g),
  format('Tenant %s', g),
  jsonb_build_object('tier', (ARRAY['free','pro','enterprise'])[1 + (random() * 2)::int], 'seed', g)
FROM generate_series(1, 100) AS g;

INSERT INTO app_user (tenant_id, email, display_name, passwd_hash, is_active, locale, role, signup_ip, signup_source)
SELECT
  ((g - 1) % 100) + 1,
  format('user%08s@example.test', g),
  format('User %s', g),
  encode(digest(g::text, 'sha256'), 'hex'),
  (random() > 0.03),
  (ARRAY['en-US','tr-TR','de-DE','fr-FR'])[1 + (random() * 3)::int],
  (ARRAY['member','admin','analyst'])[1 + (random() * 2)::int],
  format('10.%s.%s.%s', (random() * 255)::int, (random() * 255)::int, (random() * 255)::int)::inet,
  jsonb_build_object('campaign', (ARRAY['ads','organic','referral'])[1 + (random() * 2)::int], 'source_id', g)
FROM generate_series(1, 200000) AS g;

INSERT INTO warehouse(tenant_id, code, location, capacity, active_window)
SELECT
  t.id,
  format('WH-%s-%s', t.id, w),
  point((random() * 1000)::int, (random() * 1000)::int),
  100000 + (random() * 900000)::bigint,
  tsrange(now() - interval '30 days', now() + interval '365 days', '[)')
FROM tenant t
CROSS JOIN generate_series(1, 20) AS w;

INSERT INTO product(tenant_id, sku, title, description, attrs, tags, price, weight_kg, barcode, vector_hint)
SELECT
  ((g - 1) % 100) + 1,
  format('SKU-%09s', g),
  format('Product %s', g),
  format('Description for product %s', g),
  jsonb_build_object('color', (ARRAY['red','green','blue','black','white'])[1 + (random() * 4)::int], 'size', (ARRAY['xs','s','m','l','xl'])[1 + (random() * 4)::int], 'fragile', random() > 0.8),
  ARRAY[(ARRAY['home','electronics','fashion','sports','toys'])[1 + (random() * 4)::int], (ARRAY['hot','new','clearance'])[1 + (random() * 2)::int]],
  round((random() * 5000 + 1)::numeric, 2),
  round((random() * 50)::numeric, 3),
  decode(lpad(to_hex(g), 16, '0'), 'hex'),
  to_tsvector('simple', format('product %s sku %s', g, g))
FROM generate_series(1, 500000) AS g;

INSERT INTO customer(tenant_id, full_name, email, phone, birth_date, loyalty_points, preferences, geo)
SELECT
  ((g - 1) % 100) + 1,
  format('Customer %s', g),
  format('customer%08s@example.test', g),
  format('+1-555-%04s-%04s', (g / 10000) % 10000, g % 10000),
  date '1960-01-01' + ((g % 22000) * interval '1 day'),
  (random() * 10000)::int,
  jsonb_build_object('newsletter', random() > 0.5, 'lang', (ARRAY['en','tr','es','de'])[1 + (random() * 3)::int]),
  point((random() * 1000)::int, (random() * 1000)::int)
FROM generate_series(1, 1000000) AS g;

INSERT INTO address(tenant_id, customer_id, type, line1, city, region, postal_code, country, geocode)
SELECT
  c.tenant_id,
  c.id,
  (ARRAY['billing','shipping'])[1 + (random() * 1)::int],
  format('%s Main St', c.id),
  (ARRAY['NYC','Berlin','Istanbul','Paris','SF'])[1 + (random() * 4)::int],
  (ARRAY['NY','BE','34','IDF','CA'])[1 + (random() * 4)::int],
  lpad((random() * 99999)::int::text, 5, '0'),
  (ARRAY['US','DE','TR','FR'])[1 + (random() * 3)::int],
  point((random() * 1000)::int, (random() * 1000)::int)
FROM customer c
WHERE c.id <= 1000000;

INSERT INTO orders(tenant_id, customer_id, billing_address_id, shipping_address_id, status, currency, discount_amount, tax_amount, notes, active_window, placed_at)
SELECT
  ((g - 1) % 100) + 1,
  ((random() * 999999)::bigint + 1),
  ((random() * 999999)::bigint + 1),
  ((random() * 999999)::bigint + 1),
  (ARRAY['draft','pending','paid','shipped','delivered','cancelled','refunded']::order_status[])[1 + (random() * 6)::int],
  (ARRAY['USD','EUR','TRY','GBP'])[1 + (random() * 3)::int],
  round((random() * 100)::numeric, 2),
  round((random() * 50)::numeric, 2),
  format('order note %s', g),
  tstzrange(now() - ((random() * 30)::int || ' days')::interval, now() + ((random() * 365)::int || ' days')::interval, '[)'),
  now() - ((random() * 365)::int || ' days')::interval
FROM generate_series(1, 2000000) AS g;

INSERT INTO order_item(order_id, tenant_id, product_id, qty, unit_price, attrs)
SELECT
  o.id,
  o.tenant_id,
  ((random() * 499999)::bigint + 1),
  ((random() * 5)::int + 1),
  round((random() * 500)::numeric + 1, 2),
  jsonb_build_object('gift_wrap', random() > 0.9, 'warehouse_slot', (random() * 1000)::int)
FROM orders o
CROSS JOIN generate_series(1, 2);

UPDATE orders o
SET total_amount = x.sum_total
FROM (
  SELECT order_id, round(sum(line_total)::numeric, 2) AS sum_total
  FROM order_item
  GROUP BY order_id
) AS x
WHERE x.order_id = o.id;

INSERT INTO payment(order_id, tenant_id, provider, provider_ref, amount, paid_at, status, raw_response)
SELECT
  o.id,
  o.tenant_id,
  (ARRAY['stripe','adyen','paypal'])[1 + (random() * 2)::int],
  format('pay_%s_%s', o.id, (random() * 999999)::int),
  o.total_amount,
  o.placed_at + ((random() * 120)::int || ' minutes')::interval,
  (ARRAY['pending','authorized','captured','failed'])[1 + (random() * 3)::int],
  jsonb_build_object('ok', random() > 0.03, 'risk_score', (random() * 100)::int)
FROM orders o
WHERE o.id % 2 = 0;

INSERT INTO shipment(order_id, tenant_id, tracking_no, carrier, shipped_at, delivered_at, route)
SELECT
  o.id,
  o.tenant_id,
  format('TRK%012s', o.id),
  (ARRAY['ups','fedex','dhl','local'])[1 + (random() * 3)::int],
  o.placed_at + ((random() * 72)::int || ' hours')::interval,
  o.placed_at + ((random() * 240)::int || ' hours')::interval,
  path(ARRAY[
    point((random() * 1000)::int, (random() * 1000)::int),
    point((random() * 1000)::int, (random() * 1000)::int),
    point((random() * 1000)::int, (random() * 1000)::int)
  ])
FROM orders o
WHERE o.id % 3 = 0;

INSERT INTO inventory(tenant_id, product_id, warehouse_id, quantity, reserved, reorder_threshold, bin_code)
SELECT
  p.tenant_id,
  p.id,
  ((p.tenant_id - 1) * 20) + ((random() * 19)::int + 1),
  (random() * 500)::int,
  (random() * 50)::int,
  (random() * 30)::int + 5,
  format('BIN-%s-%s', (random() * 999)::int, (random() * 99)::int)
FROM product p
WHERE p.id <= 200000;

INSERT INTO event_log(tenant_id, entity_type, entity_id, action, payload, actor_user_id, source_ip, created_at)
SELECT
  ((g - 1) % 100) + 1,
  (ARRAY['order','payment','shipment','inventory','user'])[1 + (random() * 4)::int],
  ((random() * 1999999)::bigint + 1),
  (ARRAY['create','update','delete','status_change','view'])[1 + (random() * 4)::int],
  jsonb_build_object('n', g, 'ok', random() > 0.01, 'meta', jsonb_build_object('a', (random() * 999)::int, 'b', md5(g::text))),
  ((random() * 199999)::bigint + 1),
  format('172.%s.%s.%s', (random() * 255)::int, (random() * 255)::int, (random() * 255)::int)::inet,
  now() - ((random() * 365)::int || ' days')::interval
FROM generate_series(1, 3000000) AS g;

ANALYZE;
