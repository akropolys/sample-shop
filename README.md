# Simple Shop

A small shop made with plain HTML, CSS, browser JavaScript, Node.js, Express, SQLite, Stripe Checkout, and Kiku. No frontend framework and no build step. The npm dependencies are Express, Stripe, and the server helpers from the Akropolys SDK. React is not installed in the shop; the Kiku CDN embed brings its own runtime.

## Run

Requires Node.js 24.15 or newer. From PowerShell:

```powershell
cd C:\Users\user\Desktop\simple-shop
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm start
```

Open http://localhost:3000. The CMS is http://localhost:3000/admin.html.

`npm run dev` restarts the server when server files change. Refresh the browser after editing frontend files. `npm test` runs the account, cart, authorization, CMS, signed identity, catalogue, and checkout tests using isolated databases and mocked Stripe calls.

## Dummy accounts

| Account | Email | Password | Initial user ID |
| --- | --- | --- | --- |
| Customer | buyer@example.com | buyer1234 | 2 |
| Admin | admin@example.com | admin1234 | 1 |

You can create more accounts in the shop. No email verification or email service is involved. Each account gets its own numeric user ID and a password hash. Sessions use an HTTP-only cookie. The current user ID appears in the account section and beside checkout.

Guests can browse and check out. Sign in to post comments and see your own orders. The admin can add, edit, hide, and restore products, delete user comments, and view accounts and orders. Hidden products stay in the database so older orders keep their history. Product pictures can use an HTTPS URL or a bundled `/images/filename.jpg` path.

## Stripe checkout

The supplied Stripe key is configured in the ignored `.env` and uses **live payments**. To use test cards, replace it with a test key first. Automated tests use a mocked Stripe client and do not make payments.

1. Copy `.env.example` to `.env` if you have not already.
2. Add your Stripe **test** secret key as `STRIPE_SECRET_KEY=sk_test_...`.
3. Keep `BASE_URL=http://localhost:3000` while using the default port. If you change the port, update both values.
4. Restart `npm start`.
5. Add products to the cart and choose **Checkout with Stripe**.
6. On Stripe, use test card `4242 4242 4242 4242`, a future expiry date, and any three-digit CVC.

No publishable key is needed for this hosted Checkout flow. Without a secret key, products, accounts, comments, the cart, and the CMS work; checkout stays disabled. There is no fake payment-success mode.

For payment updates even when the buyer closes the browser, install the Stripe CLI and run:

```powershell
stripe login
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET` in `.env`, then restart the shop server while keeping the listener running. Webhooks verify Stripe's signature. Returning from Stripe also verifies the Checkout Session on the server before recording payment or clearing the cart. Visiting a success URL alone does not mark an order paid.

Prices and checkout items always come from the cart in SQLite. Stripe metadata includes `order_id` and `user_id`; signed-in buyers get their numeric ID as a string, and guests get `guest`. In SQLite, guest orders have a null `user_id`. Client-supplied user IDs, prices, and checkout items are ignored; identity comes from the existing account or guest session cookie.

## Kiku and signed ingestion

The supplied `sample-shop` configuration is in `.env`. These names are used as environment variables in plain Node.js; the `NEXT_PUBLIC_` prefix does not introduce Next.js:

```dotenv
NEXT_PUBLIC_AKROPOLYS_SITE_ID=sample-shop
NEXT_PUBLIC_AKROPOLYS_API_TOKEN=your-public-browser-token
NEXT_PUBLIC_AKROPOLYS_PUBLIC_KEY_ID=your-public-key-id
AKROPOLYS_PRIVATE_KEY="your-multiline-private-key"
AKROPOLYS_VOICE=false
```

The browser loads the documented versioned script at `https://cdn.akropolys.cloud/kiku/2.2.35/kiku.js` once, waits for its load event, then awaits automatic `Kiku.ready`. The loader supplies its own CSS and runtime. Set `AKROPOLYS_VOICE=true` and restart to enable the voice button.

Kiku uses the supported `data-api-url` option to send API requests through this shop's `/api/akropolys` route. That route streams requests to the fixed Akropolys API, preserves shopper proofs, and excludes shop cookies. This works around the deployed API's missing `X-Akropolys-Shopper-Proof` CORS allowance. Site actions use the visitor browser and the shop cookies, so local endpoints can run on localhost with the browser-action backend and Kiku build. A small compatibility rule inside the widget's isolated style root uses `overflow: clip` to prevent its fixed panel from scrolling above the viewport when the input receives focus.

The existing `/api/products` loading flow publishes its loaded products through `createIngestClient` from `@akropolys/sdk/server` and `ingestBatch(records, signed, { batchSize: 25 })`. Rendering and shop requests do not wait for indexing. This is the only catalogue-publishing path. Batch ingestion needs Growth, Pro, or Business. A rejected submission is logged and appears in the admin's Akropolys status.

Records retain the SQLite product ID, full description, price, currency, product ID, image, and product anchor URL. Hidden products are republished with `available: false` so existing records stop claiming they are for sale. The bundled demo pictures use their public HTTPS sources in catalogue records. For new pictures, prefer public HTTPS image URLs.

After login, the browser calls `/api/kiku/identity`; the server signs the session's user ID with `signUser`. The browser calls `Kiku.updateIdentity({ shopperId, userProof })`. Logout updates Kiku with `{}`. The private key never appears in public configuration or responses. Guests keep Kiku's anonymous identity. Enable **Signed user IDs only** in Shell if you want Akropolys to require these proofs.

Opening the shop or refreshing its product data submits the catalogue. A queued result means accepted for processing; it is not proof of finished indexing. Check the CMS's Akropolys section and ask Kiku about a known product such as Ceramic Mug.

## Server carts and Kiku site actions

Carts live in SQLite. Guests have a private cart cookie; each signed-in account has its own persistent cart. Login merges the guest cart into that account. Logout returns to a separate guest cart. The page refreshes its cart every three seconds while visible, so an action performed by Kiku appears without a page reload. Redux and Zustand are not needed for this plain JavaScript app.

`GET /api/actions` returns ready-to-copy action definitions and JSON Schemas using the configured `BASE_URL`.

| Action | Method | Endpoint | Inputs |
| --- | --- | --- | --- |
| `get_cart` | GET | `/api/cart` | none |
| `add_cart_item` | POST | `/api/cart/items` | `product_id`, `quantity` to add |
| `update_cart_item` | PATCH | `/api/cart/items/{product_id}` | `product_id`, final `quantity` |
| `remove_cart_item` | DELETE | `/api/cart/items/{product_id}` | `product_id` |
| `clear_cart` | DELETE | `/api/cart` | none |
| `checkout` | POST | `/api/checkout` | none |

In Shell, select `sample-shop` and add these definitions under **Agents → Actions**. Use each endpoint's exact method and `fields` JSON Schema. These cart actions support guests, so leave **Require sign-in** off.

Kiku 2.2.33 calls the existing cart and checkout APIs from the visitor's browser. Signed-in shoppers use the HttpOnly `shop_session` cookie; guests use `shop_guest`. There is no separate action login endpoint, token exchange, `actionAuth` adapter or header callback. The API determines cart ownership from the cookies and ignores client-supplied `user_id` and `cart_id` values. Sign-in proof at `/api/kiku/identity` remains separate: it identifies the customer to Akropolys, not to the shop API.

Open the shop through the address in `BASE_URL`, and use that same origin in Shell's action definitions. Browser actions work with local endpoints on a development site; a public tunnel is not needed for these action calls. The widget uses the published Kiku 2.2.33 CDN embed with browser-action support.

The checkout action returns a `checkout_url` for the buyer to open. It does not charge a card. Payment is recorded only after Stripe verification. Paid quantities are removed once; products added after checkout remain in the cart. For live payments, register the public `/api/stripe/webhook` endpoint in Stripe and put its signing secret in `STRIPE_WEBHOOK_SECRET`.

## Vercel deployment

The root `index.js` exports the Express app for Vercel, and product images and browser files are in `public/` for Vercel's static hosting. Import this Git repository as a Vercel project. Set `BASE_URL` to the stable public HTTPS project domain, then add the Akropolys variables and Stripe variables from `.env.example` in Vercel's Production environment. Keep `AKROPOLYS_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` server-side; only the `NEXT_PUBLIC_AKROPOLYS_*` values are browser configuration. Update the Stripe webhook to the public domain's `/api/stripe/webhook` URL.

**The Vercel entry point currently opens SQLite at `/tmp/shop.sqlite`, which is temporary function storage.** Data may disappear after a cold start or differ between function instances. This deployment setup is suitable for checking the hosted UI and Kiku connection; it is not ready for real production orders, accounts, or carts until SQLite is replaced with a persistent shared database. Do not enable the live Stripe key for real purchases while using this temporary database.

Example local action test from PowerShell, using a dummy account:

```powershell
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod http://localhost:3000/api/auth/login -Method Post -ContentType application/json -Body '{"email":"buyer@example.com","password":"buyer1234"}' -WebSession $session
Invoke-RestMethod http://localhost:3000/api/cart/items -Method Post -ContentType application/json -Body '{"product_id":2,"quantity":1}' -WebSession $session
```

## Files and data

- `server.js`: HTTP API, accounts, sessions, CMS routes, and Stripe.
- `db.js`: SQLite tables and initial products/accounts.
- `cart.js`: server carts using the existing account and guest cookies.
- `akropolys.js`: signed catalogue batches and shopper proofs.
- `akropolys-proxy.js`: same-origin requests to the fixed Akropolys API.
- `site-actions.js`: Shell action definitions and JSON Schemas.
- `public/`: plain HTML, CSS, JavaScript, and four bundled product photos.
- `data/shop.sqlite`: the real SQLite database, created automatically on first start.
- `test/shop.test.js`: integration tests using a separate in-memory database and a mocked Stripe client, with real Stripe webhook signature verification. These tests do not make payments.

SQLite contains `users`, `sessions`, `products`, `comments`, `carts`, `cart_items`, `orders`, and `order_items`. Restarting preserves your data. To reset the dummy data, stop the server and remove only this project's `data` folder, then start it again. `ADMIN_EMAIL` and `ADMIN_PASSWORD` control initial admin creation; changing the password setting does not change an account already stored in the database.

This project is a local demo. It has no shipping calculation, tax calculation, inventory tracking, or email delivery. All prices are USD. Keep real credentials out of Git; `.env` and runtime data are ignored.

## References

- [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe webhook signatures](https://docs.stripe.com/events/manage-webhook-endpoints#signature-errors)
- [Node.js SQLite](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html)
- [Akropolys JavaScript embed](https://akropolys.cloud/docs/javascript/)
- [Akropolys batch ingestion](https://akropolys.cloud/docs/batch-ingestion/)
- [Akropolys signed user IDs](https://akropolys.cloud/docs/provider/)
- [Akropolys site actions](https://akropolys.cloud/docs/actions/)
- Product photos from Unsplash: [backpack](https://images.unsplash.com/photo-1553062407-98eeb64c6a62), [mug](https://images.unsplash.com/photo-1514228742587-6b1558fcca3d), [headphones](https://images.unsplash.com/photo-1505740420928-5e560c06d30e), [sneakers](https://images.unsplash.com/photo-1542291026-7eec264c27ff).


## Free action-hook demo

Open `/action-demo.html` (also linked as **Free action demo** in the shop).
The test runner exercises the endpoints without Kiku. No Stripe account, card,
cart items or money are required. Nothing in this flow creates real orders,
changes the cart, or calls Stripe. The normal `/api/checkout` remains unchanged.

`GET /api/demo/actions` returns the four definitions, including schemas and hooks;
they are also included in `/api/actions`.

| Action | Method | Path | Input |
| --- | --- | --- | --- |
| `demo_before` | GET | `/api/demo/before` | none |
| `demo_checkout` | POST | `/api/demo/checkout` | none |
| `demo_after` | POST | `/api/demo/after` | `demo_id` from checkout |
| `demo_on_return` | GET | `/api/demo/on-return` | `demo_id` query parameter |

In Shell, save the helpers first, then `demo_checkout`. Set its **Before** to
`demo_before`, **After success** to `demo_after`, and **On return** to
`demo_on_return`. Enable Kiku access for all four; Require sign-in stays off.
Ask Kiku in chat: **Start the free demo checkout.** Open its link, select
**Complete demo — $0** or **Cancel demo**, then switch back to the same chat tab.
Use the matching browser origin from BASE_URL throughout.

Creation of a demo session is the main action's successful outcome: the after
hook records that creation, not payment. The on-return hook reports `pending`,
`completed`, or `cancelled`. Returning without choosing does not imply success.
Inspect `/api/demo/events` or refresh the demo page's activity table to see actual
endpoint calls. The runner calls these APIs directly; it does not prove Kiku's
orchestration is deployed. Chat return hooks require the matching backend and
widget support described in the action-timings implementation.

Demo sessions and events use separate SQLite tables and an HttpOnly browser
cookie. Repeat after-success requests are idempotent; a finished outcome cannot
be changed. Other browser sessions cannot read or complete your demo.
