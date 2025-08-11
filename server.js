require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  store: new SQLiteStore(),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Helpers
function formatVND(n) {
  return new Intl.NumberFormat('vi-VN').format(n) + '₫';
}
app.locals.formatVND = formatVND;

// Middleware attach cart
app.use((req, res, next) => {
  if (!req.session.cart) req.session.cart = []; // items: {id, name, price, qty}
  res.locals.cart = req.session.cart;
  res.locals.cartCount = req.session.cart.reduce((s, i) => s + i.qty, 0);
  next();
});

// ---------------- Public routes ----------------
app.get('/', (req, res) => {
  db.all('SELECT * FROM products', (err, products) => {
    if (err) return res.status(500).send('DB error');
    res.render('index', { products });
  });
});

app.get('/product/:id', (req, res) => {
  db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, product) => {
    if (err || !product) return res.status(404).send('Không tìm thấy sản phẩm');
    res.render('product', { product });
  });
});

app.post('/cart/add', (req, res) => {
  const { product_id, qty } = req.body;
  const q = Math.max(1, parseInt(qty || '1', 10));
  db.get('SELECT * FROM products WHERE id = ?', [product_id], (err, p) => {
    if (err || !p) return res.status(404).send('Sản phẩm không tồn tại');
    if (p.stock <= 0) return res.redirect('/?oos=' + p.id);
    const existing = req.session.cart.find(i => i.id == p.id);
    if (existing) existing.qty += q;
    else req.session.cart.push({ id: p.id, name: p.name, price: p.price, qty: q });
    res.redirect('/cart');
  });
});

app.get('/cart', (req, res) => {
  const total = req.session.cart.reduce((s, i) => s + i.price * i.qty, 0);
  res.render('cart', { total });
});

app.post('/cart/update', (req, res) => {
  const { id, qty } = req.body;
  const q = Math.max(0, parseInt(qty || '0', 10));
  req.session.cart = req.session.cart.map(i => i.id == id ? { ...i, qty: q } : i).filter(i => i.qty > 0);
  res.redirect('/cart');
});

app.post('/cart/clear', (req, res) => {
  req.session.cart = [];
  res.redirect('/cart');
});

app.get('/checkout', (req, res) => {
  if (req.session.cart.length === 0) return res.redirect('/cart');
  const total = req.session.cart.reduce((s, i) => s + i.price * i.qty, 0);
  res.render('checkout', { total });
});

app.post('/checkout', (req, res) => {
  if (req.session.cart.length === 0) return res.redirect('/');
  const { name, email, phone, address } = req.body;
  const total = req.session.cart.reduce((s, i) => s + i.price * i.qty, 0);
  const created_at = new Date().toISOString();
  db.run('BEGIN TRANSACTION');
  db.run('INSERT INTO orders (customer_name, email, phone, address, total, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email, phone, address, total, created_at],
    function(err){
      if (err) { db.run('ROLLBACK'); return res.status(500).send('DB error'); }
      const orderId = this.lastID;
      // Insert items & decrement stock
      let remaining = req.session.cart.length, failed = false;
      req.session.cart.forEach(item => {
        db.run('INSERT INTO order_items (order_id, product_id, qty, price) VALUES (?, ?, ?, ?)',
          [orderId, item.id, item.qty, item.price], (e)=>{
            if (e) failed = true;
          });
        db.run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
          [item.qty, item.id, item.qty], (e)=>{
            if (e) failed = True
          });
        remaining--;
        if (remaining === 0) finalize();
      });

      function finalize(){
        if (failed) { db.run('ROLLBACK'); return res.status(500).send('DB error'); }
        db.run('COMMIT');
        // Build invoice HTML
        const rows = req.session.cart.map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${i.price}</td><td>${i.qty*i.price}</td></tr>`).join('');
        const html = `
          <h2>Hóa đơn #${orderId}</h2>
          <p>Khách hàng: ${name}</p>
          <p>Email: ${email}</p>
          <p>Điện thoại: ${phone || ''}</p>
          <p>Địa chỉ: ${address}</p>
          <table border="1" cellpadding="6" cellspacing="0">
            <thead><tr><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td colspan="3"><b>Tổng</b></td><td><b>${total}</b></td></tr></tfoot>
          </table>
          <p>Ngày đặt: ${new Date(created_at).toLocaleString('vi-VN')}</p>
        `;
        const mailOptions = {
          from: process.env.GMAIL_USER,
          to: [email, process.env.SHOP_NOTIFICATION_EMAIL].filter(Boolean),
          subject: `Xác nhận đơn hàng #${orderId}`,
          html
        };
        transporter.sendMail(mailOptions).catch(console.error);

        req.session.cart = [];
        res.render('success', { orderId });
      }
    }
  );
});

// ---------------- Admin auth ----------------
function requireAdmin(req, res, next){
  if (!req.session.adminUser) return res.redirect('/admin/login');
  next();
}

app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM admin_users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.render('admin/login', { error: 'Sai tài khoản hoặc mật khẩu' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.render('admin/login', { error: 'Sai tài khoản hoặc mật khẩu' });
    req.session.adminUser = { id: user.id, username: user.username };
    res.redirect('/admin');
  });
});

app.post('/admin/logout', (req, res) => {
  req.session.adminUser = null;
  res.redirect('/admin/login');
});

// ---------------- Admin dashboard ----------------
app.get('/admin', requireAdmin, (req, res) => {
  db.get('SELECT COUNT(*) as count, COALESCE(SUM(total),0) as revenue FROM orders', (err, stats) => {
    if (err) stats = { count: 0, revenue: 0 };
    db.get('SELECT COALESCE(SUM(qty),0) as items_sold FROM order_items', (err2, s2) => {
      db.all('SELECT * FROM products ORDER BY id DESC', (e3, products) => {
        res.render('admin/dashboard', {
          user: req.session.adminUser,
          ordersCount: stats.count || 0,
          revenue: stats.revenue || 0,
          itemsSold: (s2 && s2.items_sold) || 0,
          products: products || []
        });
      });
    });
  });
});

app.get('/admin/orders', requireAdmin, (req, res) => {
  db.all('SELECT * FROM orders ORDER BY id DESC', (err, orders) => {
    res.render('admin/orders', { orders: orders || [] });
  });
});

app.get('/admin/orders/:id', requireAdmin, (req, res) => {
  db.get('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, order) => {
    if (!order) return res.redirect('/admin/orders');
    db.all('SELECT oi.*, p.name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE order_id = ?', [order.id], (e2, items) => {
      res.render('admin/order_detail', { order, items: items || [] });
    });
  });
});

app.get('/admin/products', requireAdmin, (req, res) => {
  db.all('SELECT * FROM products ORDER BY id DESC', (err, products) => {
    res.render('admin/products', { products: products || [], error: null });
  });
});

app.post('/admin/products', requireAdmin, (req, res) => {
  const { name, description, price, stock, image } = req.body;
  db.run('INSERT INTO products (name, description, price, stock, image) VALUES (?, ?, ?, ?, ?)',
    [name, description, parseInt(price||0,10), parseInt(stock||0,10), image || ''],
    (err)=>{
      if (err) console.error(err);
      res.redirect('/admin/products');
    });
});

app.post('/admin/products/:id', requireAdmin, (req, res) => {
  const { name, description, price, stock, image } = req.body;
  db.run('UPDATE products SET name=?, description=?, price=?, stock=?, image=? WHERE id=?',
    [name, description, parseInt(price||0,10), parseInt(stock||0,10), image || '', req.params.id],
    (err)=>{
      if (err) console.error(err);
      res.redirect('/admin/products');
    });
});

app.post('/admin/products/:id/delete', requireAdmin, (req, res) => {
  db.run('DELETE FROM products WHERE id=?', [req.params.id], (err)=>{
    if (err) console.error(err);
    res.redirect('/admin/products');
  });
});

// 404
app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
