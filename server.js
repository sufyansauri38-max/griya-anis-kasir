const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const APP_PIN = process.env.APP_PIN;
const JWT_SECRET = process.env.JWT_SECRET;

if (!DATABASE_URL || !APP_PIN || !JWT_SECRET) {
  console.error('Konfigurasi wajib: DATABASE_URL, APP_PIN, JWT_SECRET');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      buy_price BIGINT NOT NULL DEFAULT 0 CHECK (buy_price >= 0),
      sell_price BIGINT NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
      stock NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (stock >= 0),
      min_stock NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sales (
      id BIGSERIAL PRIMARY KEY,
      invoice TEXT UNIQUE NOT NULL,
      subtotal BIGINT NOT NULL,
      total BIGINT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'Tunai',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id BIGSERIAL PRIMARY KEY,
      sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      qty NUMERIC(14,2) NOT NULL,
      unit TEXT NOT NULL,
      price BIGINT NOT NULL,
      cost BIGINT NOT NULL,
      line_total BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_logs (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id),
      change_qty NUMERIC(14,2) NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
  `);
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sesi berakhir. Silakan masuk kembali.' });
  }
}
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, app: 'Griya Anis Kasir' }); }
  catch { res.status(503).json({ ok: false }); }
});
app.post('/api/login', loginLimiter, async (req, res) => {
  const pin = String(req.body.pin || '');
  if (pin.length < 4 || pin.length > 12 || !bcrypt.compareSync(pin, bcrypt.hashSync(APP_PIN, 10))) {
    return res.status(401).json({ error: 'PIN tidak sesuai.' });
  }
  const token = jwt.sign({ role: 'owner' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/login') return next();
  return auth(req, res, next);
});

app.get('/api/products', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { rows } = await pool.query(
    `SELECT id, barcode, name, unit, buy_price, sell_price, stock, min_stock
     FROM products
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR barcode ILIKE '%' || $1 || '%')
     ORDER BY name LIMIT 500`, [q]);
  res.json(rows);
});
app.post('/api/products', async (req, res) => {
  const { barcode, name, unit='pcs', buy_price=0, sell_price=0, stock=0, min_stock=0 } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Nama produk wajib diisi.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO products(barcode,name,unit,buy_price,sell_price,stock,min_stock)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,barcode,name,unit,buy_price,sell_price,stock,min_stock`,
      [barcode || null, String(name).trim(), unit, Number(buy_price), Number(sell_price), Number(stock), Number(min_stock)]);
    res.json(rows[0]);
  } catch (e) {
    res.status(e.code === '23505' ? 409 : 400).json({ error: e.code === '23505' ? 'Barcode sudah digunakan produk lain.' : 'Data produk tidak valid.' });
  }
});
app.put('/api/products/:id', async (req, res) => {
  const { barcode, name, unit='pcs', buy_price=0, sell_price=0, min_stock=0 } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Nama produk wajib diisi.' });
  try {
    const { rows } = await pool.query(
      `UPDATE products SET barcode=$1,name=$2,unit=$3,buy_price=$4,sell_price=$5,min_stock=$6,updated_at=NOW()
       WHERE id=$7 RETURNING id,barcode,name,unit,buy_price,sell_price,stock,min_stock`,
      [barcode || null, String(name).trim(), unit, Number(buy_price), Number(sell_price), Number(min_stock), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Produk tidak ditemukan.' });
    res.json(rows[0]);
  } catch (e) { res.status(400).json({ error: e.code === '23505' ? 'Barcode sudah digunakan.' : 'Data tidak valid.' }); }
});
app.post('/api/stock', async (req, res) => {
  const { product_id, qty, note='Stok masuk' } = req.body;
  const n = Number(qty);
  if (!product_id || !Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Jumlah stok harus lebih dari 0.' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const upd = await c.query('UPDATE products SET stock=stock+$1,updated_at=NOW() WHERE id=$2 RETURNING id,stock', [n, product_id]);
    if (!upd.rows.length) throw new Error('Produk tidak ditemukan.');
    await c.query('INSERT INTO stock_logs(product_id,change_qty,note) VALUES($1,$2,$3)', [product_id,n,String(note).slice(0,200)]);
    await c.query('COMMIT');
    res.json({ ok: true, stock: upd.rows[0].stock });
  } catch (e) { await c.query('ROLLBACK'); res.status(400).json({ error: e.message }); }
  finally { c.release(); }
});
app.post('/api/sales', async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const payment = ['Tunai','Transfer','QRIS'].includes(req.body.payment_method) ? req.body.payment_method : 'Tunai';
  if (!items.length) return res.status(400).json({ error: 'Keranjang masih kosong.' });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let total = 0;
    const checked = [];
    for (const item of items) {
      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Jumlah barang tidak valid.');
      const p = await c.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [item.product_id]);
      if (!p.rows.length) throw new Error('Produk tidak ditemukan.');
      const product = p.rows[0];
      if (Number(product.stock) < qty) throw new Error(`Stok ${product.name} tidak mencukupi. Tersedia ${product.stock}.`);
      const price = Number(product.sell_price);
      const line = Math.round(price * qty);
      total += line;
      checked.push({ product, qty, price, line });
    }
    const invoice = 'GA-' + Date.now().toString(36).toUpperCase();
    const sale = await c.query('INSERT INTO sales(invoice,subtotal,total,payment_method) VALUES($1,$2,$2,$3) RETURNING id,invoice,total,created_at',
      [invoice,total,payment]);
    for (const it of checked) {
      await c.query('UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2', [it.qty,it.product.id]);
      await c.query(`INSERT INTO sale_items(sale_id,product_id,product_name,qty,unit,price,cost,line_total)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [sale.rows[0].id,it.product.id,it.product.name,it.qty,it.product.unit,it.price,it.product.buy_price,it.line]);
      await c.query('INSERT INTO stock_logs(product_id,change_qty,note) VALUES($1,$2,$3)',
        [it.product.id,-it.qty,'Penjualan '+invoice]);
    }
    await c.query('COMMIT');
    res.json({ ok:true, sale:sale.rows[0] });
  } catch (e) { await c.query('ROLLBACK'); res.status(400).json({ error:e.message }); }
  finally { c.release(); }
});
app.get('/api/reports/summary', async (req,res) => {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS transactions,
      COALESCE(SUM(total),0)::bigint AS revenue,
      COALESCE(SUM((SELECT SUM(si.qty*(si.price-si.cost)) FROM sale_items si WHERE si.sale_id=s.id)),0)::bigint AS gross_profit
    FROM sales s WHERE created_at::date = CURRENT_DATE`);
  const low = await pool.query('SELECT COUNT(*)::int AS count FROM products WHERE stock <= min_stock');
  res.json({ ...rows[0], low_stock: low.rows[0].count });
});
app.get('/api/reports/sales', async (req,res) => {
  const { rows } = await pool.query(`
    SELECT s.id,s.invoice,s.total,s.payment_method,s.created_at,
      COALESCE(json_agg(json_build_object('name',si.product_name,'qty',si.qty,'unit',si.unit,'price',si.price,'line_total',si.line_total))
      FILTER (WHERE si.id IS NOT NULL),'[]') AS items
    FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id
    GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100`);
  res.json(rows);
});
app.get('/api/export', async (req,res) => {
  const products = await pool.query('SELECT * FROM products ORDER BY name');
  const sales = await pool.query('SELECT * FROM sales ORDER BY created_at DESC LIMIT 1000');
  res.json({ exported_at:new Date().toISOString(), products:products.rows, sales:sales.rows });
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Griya Anis Kasir berjalan pada port ${PORT}`));
}).catch(err => { console.error('Gagal menyiapkan database:', err); process.exit(1); });
