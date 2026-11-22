# Simple Shop

A small demo shop that shows how to add kiku to a website: products to browse, a cart, and kiku to ask about them, look at photos, picture furniture and wall art in a room, and fill the cart.

## Run it

Needs Node.js 24.15 or newer.

```
npm install
npm start
```

Open http://localhost:3000. `npm test` runs the tests.

## Add kiku

**1. Show kiku.** Put the tag where kiku should appear, and the script once per page (see `page.html`):

```html
<kiku-button label="Ask about products"></kiku-button>

<script src="https://cdn.akropolys.cloud/kiku/2.2.46/kiku.js"
        data-key="YOUR_PUBLIC_KEY" data-voice="true" data-vision="true" defer></script>
```

The public key is safe in the page. Keys made before late 2026 also need `data-site-id="YOUR_SITE_ID"`.

**2. Send your products.** Copy `.env.example` to `.env`, add your two keys and the shop's public address, then:

```
npm run send-products
```

Run it again whenever products change. The private key stays on your computer or server and proves the products came from you.

**3. Let kiku use the cart (optional).** In Shell, add the cart actions listed at `/api/actions`. kiku runs them in the shopper's browser, so the cart is theirs.

## Files

- `products.js` – the products. Keep their order: kiku knows each product by its ID.
- `cart.js` – the cart, kept in a browser cookie.
- `server.js` – serves the shop and its small API.
- `send-products.js` – sends the products to kiku.
- `page.html` – the page, with the tag and the script.
- `public/` – the page’s scripts, styles and pictures.

## Deploy

On Vercel it works as is. Run `npm run send-products` with `BASE_URL` set to the Vercel address, so kiku gets links and pictures it can open.
