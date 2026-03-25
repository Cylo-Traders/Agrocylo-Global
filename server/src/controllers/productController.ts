import { Request, Response } from "express";
import Database from "better-sqlite3";

const db = new Database("./dev.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    location TEXT NOT NULL,
    image_url TEXT,
    farmer_address TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

export const createProduct = (req: Request, res: Response) => {
  const { product_name, category, quantity, price, location, image_url, farmer_address } = req.body;
  if (!product_name || !category || !quantity || !price || !location || !farmer_address) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const stmt = db.prepare(`
    INSERT INTO products (product_name, category, quantity, price, location, image_url, farmer_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(product_name, category, quantity, price, location, image_url, farmer_address);
  res.status(201).json({ id: result.lastInsertRowid, ...req.body });
};

export const getProducts = (req: Request, res: Response) => {
  const products = db.prepare("SELECT * FROM products").all();
  res.json(products);
};

export const getProductById = (req: Request, res: Response) => {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
};
