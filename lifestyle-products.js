const photo = (category, slug) => `https://cdn.dummyjson.com/product-images/${category}/${slug}/thumbnail.webp`;

export const lifestyleProducts = [
  { name: 'Blue Check Shirt', description: 'A blue and black checked long-sleeve shirt for casual or smart-casual outfits.', price_cents: 2999, image_url: photo('mens-shirts', 'blue-&-black-check-shirt') },
  { name: 'Plaid Shirt', description: 'A classic long-sleeve plaid shirt for everyday casual wear.', price_cents: 3499, image_url: photo('mens-shirts', 'man-plaid-shirt') },
  { name: 'Short Sleeve Shirt', description: 'A relaxed short-sleeve shirt for warm days and casual outfits.', price_cents: 1999, image_url: photo('mens-shirts', 'man-short-sleeve-shirt') },
  { name: 'Floral Evening Dress', description: 'A long dark floral dress for an evening event or special occasion.', price_cents: 12999, image_url: photo('womens-dresses', "black-women's-gown") },
  { name: 'Tartan Dress', description: 'A dress in a classic tartan pattern for a smart everyday look.', price_cents: 3999, image_url: photo('tops', 'tartan-dress') },
  { name: 'Blue Dress', description: 'A blue dress for casual outings and warm days.', price_cents: 2999, image_url: photo('tops', 'blue-frock') },
  { name: 'Red and Black High-Top Sneakers', description: 'Red and black high-top sneakers for casual outfits.', price_cents: 14999, image_url: photo('mens-shoes', 'nike-air-jordan-1-red-and-black') },
  { name: 'Retro Trainers', description: 'Retro-style trainers for everyday casual wear.', price_cents: 8999, image_url: photo('mens-shoes', 'puma-future-rider-trainers') },
  { name: 'Off-White and Red Sneakers', description: 'Off-white and red sports-style sneakers for casual outfits.', price_cents: 11999, image_url: photo('mens-shoes', 'sports-sneakers-off-white-&-red') },
  { name: 'Black Heeled Sandals', description: 'Black open-toe heeled sandals for special occasions and evening outfits.', price_cents: 7999, image_url: photo('womens-shoes', 'calvin-klein-heel-shoes') },
  { name: 'Gold Dress Shoes', description: 'Gold shoes for parties, celebrations and other special occasions.', price_cents: 4999, image_url: photo('womens-shoes', 'golden-shoes-woman') },
  { name: 'Upholstered Sofa', description: 'An upholstered sofa for a living room seating area.', price_cents: 249999, image_url: photo('furniture', 'annibale-colombo-sofa') },
  { name: 'Wooden Bed Frame', description: 'A wooden bed frame and curved headboard for a bedroom.', price_cents: 189999, image_url: photo('furniture', 'annibale-colombo-bed') },
  { name: 'Cherry Bedside Table', description: 'A cherry-finish bedside table with storage for a bedroom.', price_cents: 29999, image_url: photo('furniture', 'bedside-table-african-cherry') },
  { name: 'Office Chair', description: 'An upholstered office and conference chair for a desk or workspace.', price_cents: 49999, image_url: photo('furniture', 'knoll-saarinen-executive-conference-chair') },
  { name: 'Family Photo Frame', description: 'A decorative family-tree photo frame to display family photographs.', price_cents: 2999, image_url: photo('home-decoration', 'family-tree-photo-frame') },
  { name: 'Table Lamp', description: 'A decorative table lamp for a living room or bedside table.', price_cents: 4999, image_url: photo('home-decoration', 'table-lamp') },
  { name: 'Botanical Wall Print', description: 'A framed botanical leaf print in green and cream for a wall or gallery display.', price_cents: 3900, image_url: '/images/wall-botanical.svg' },
  { name: 'Abstract Terracotta Wall Art', description: 'A framed abstract art print with terracotta, cream and dark brown shapes.', price_cents: 4900, image_url: '/images/wall-abstract.svg' },
  { name: 'Mountain Landscape Wall Print', description: 'A framed landscape print of mountains and a sunset in muted earth tones.', price_cents: 4500, image_url: '/images/wall-landscape.svg' },
  { name: 'Geometric Wall Art', description: 'A framed geometric print with arches and circles in blue, sand and rust.', price_cents: 4200, image_url: '/images/wall-geometric.svg' }
];
