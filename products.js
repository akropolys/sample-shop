import { ingredients } from './ingredients.js';
import { lifestyleProducts } from './lifestyle-products.js';

const unsplash = (photo) => `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=800&q=80`;

const everyday = [
  { name: 'Everyday Backpack', description: 'A simple backpack for your daily essentials.', price_cents: 3900, image_url: unsplash('photo-1553062407-98eeb64c6a62') },
  { name: 'Ceramic Mug', description: 'A comfortable cup for your morning coffee or tea.', price_cents: 1200, image_url: unsplash('photo-1514228742587-6b1558fcca3d') },
  { name: 'Wireless Headphones', description: 'Over-ear headphones for music, work, and quiet moments.', price_cents: 5900, image_url: unsplash('photo-1505740420928-5e560c06d30e') },
  { name: 'Red Sneakers', description: 'Light everyday sneakers with a little color.', price_cents: 4900, image_url: unsplash('photo-1542291026-7eec264c27ff') }
];

// Keep this order: kiku stores each product under its ID.
export const products = [...everyday, ...ingredients, ...lifestyleProducts].map((product, index) => ({ id: index + 1, ...product }));

export const productById = (id) => products.find((product) => product.id === id);
