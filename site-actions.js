// The cart actions to add for this site in Shell, so kiku can manage the cart.
const productId = { type: 'integer', minimum: 1, description: 'The product_id from a catalogue record or cart item.' };
const quantity = { type: 'integer', minimum: 1, maximum: 99 };
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function siteActions(baseUrl) {
  const action = (method, path, description, fields, hooks) => ({ url: `${baseUrl}${path}`, method, description, fields, requiresSignIn: false, ...(hooks ? { hooks } : {}) });
  return {
    get_cart: action('GET', '/api/cart', 'Read the visitor’s current cart, quantities, current prices, and total.', schema()),
    add_cart_item: action('POST', '/api/cart/items', 'Add a product to the visitor’s cart. Quantity is the number to add, not the final quantity. Use the product_id from the catalogue.', schema({ product_id: productId, quantity }, ['product_id', 'quantity'])),
    update_cart_item: action('PATCH', '/api/cart/items/{product_id}', 'Set an existing cart product to the requested final quantity.', schema({ product_id: productId, quantity }, ['product_id', 'quantity'])),
    remove_cart_item: action('DELETE', '/api/cart/items/{product_id}', 'Remove all units of one product from the visitor’s cart.', schema({ product_id: productId }, ['product_id'])),
    clear_cart: action('DELETE', '/api/cart', 'Empty the cart only when the visitor explicitly asks to remove everything.', schema()),
    start_checkout: action('POST', '/api/checkout', 'Start checkout for the visitor’s current cart when they ask to check out or pay. Returns a secure payment link to show them. This is a test shop: the whole cart costs $1.', schema(), { onReturn: 'get_checkout_status' }),
    get_checkout_status: action('GET', '/api/checkout/{checkout_id}', 'Check whether a checkout was paid, using the checkout_id that start_checkout returned. Only "paid": true confirms payment; say if the test payment was refunded.', schema({ checkout_id: { type: 'string', description: 'The checkout_id returned by start_checkout.' } }, ['checkout_id']))
  };
}
