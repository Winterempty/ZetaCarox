'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 2) throw new Error('Database is newer than this application. Use a matching release.');
  if (!version) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'THB', address TEXT NOT NULL DEFAULT '', timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok', version INTEGER NOT NULL DEFAULT 1);
    INSERT INTO settings(id,name) VALUES(1,'My business');
    CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff','viewer')), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE contacts(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('customer','supplier')), email TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL);
    CREATE TABLE products(id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>=0), cost INTEGER NOT NULL CHECK(cost>=0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), reorder INTEGER NOT NULL DEFAULT 5 CHECK(reorder>=0), active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE invoices(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES contacts(id), customer_name TEXT NOT NULL, customer_address TEXT NOT NULL, business_name TEXT NOT NULL, business_address TEXT NOT NULL, currency TEXT NOT NULL, issued TEXT NOT NULL, due TEXT NOT NULL, subtotal INTEGER NOT NULL, tax_bps INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0 CHECK(paid>=0 AND paid<=total), status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','void')), note TEXT NOT NULL);
    CREATE TABLE invoice_lines(id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), price INTEGER NOT NULL, cost INTEGER NOT NULL);
    CREATE TABLE payments(id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id), amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL, reference TEXT NOT NULL);
    CREATE TABLE purchases(id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL REFERENCES contacts(id), supplier_name TEXT NOT NULL, date TEXT NOT NULL, total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','received','cancelled')), note TEXT NOT NULL);
    CREATE TABLE purchase_lines(id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id), product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), cost INTEGER NOT NULL);
    CREATE TABLE expenses(id INTEGER PRIMARY KEY, date TEXT NOT NULL, category TEXT NOT NULL, payee TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), note TEXT NOT NULL, voided INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE movements(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, date TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id));
    CREATE TABLE audit(id INTEGER PRIMARY KEY, date TEXT NOT NULL, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE requests(user_id INTEGER NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,key));
    CREATE INDEX invoice_due ON invoices(status,due);
    CREATE INDEX movement_product ON movements(product_id,id);
    CREATE INDEX payment_invoice ON payments(invoice_id);
    PRAGMA user_version=1; COMMIT;`);
  if (version < 2) {
    // SQLite creates a consistent snapshot, including committed WAL data, before migration.
    if(version===1) db.prepare('VACUUM INTO ?').run(filename+'.before-v2-'+Date.now()+'.sqlite');
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE products ADD COLUMN barcode TEXT NOT NULL DEFAULT '';
      CREATE UNIQUE INDEX product_barcode ON products(barcode) WHERE barcode<>'';
      CREATE TABLE sales(id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), price INTEGER NOT NULL CHECK(price>=0), total INTEGER NOT NULL CHECK(total>=0), date TEXT NOT NULL, created TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), note TEXT NOT NULL DEFAULT '');
      CREATE INDEX sales_date ON sales(date);
      PRAGMA user_version=2; COMMIT;`);
  }
  try { fs.chmodSync(filename, 0o600); } catch {}
  return db;
}
module.exports = {openDatabase};
