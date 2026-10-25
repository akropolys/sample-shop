const productId = { type: 'integer', minimum: 1, description: 'The product_id from a catalogue record or cart item.' };
const quantity = { type: 'integer', minimum: 1, maximum: 99 };
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function siteActions(baseUrl) {
  const action = (method, path, description, fields) => ({ url: `${baseUrl}${path}`, method, description, fields, requiresSignIn: false });
  return {
    get_cart: action('GET', '/api/cart', 'Read the visitor’s current cart, quantities, current prices, and total.', schema()),
    add_cart_item: action('POST', '/api/cart/items', 'Add a product to the visitor’s cart. Quantity is the number to add, not the final quantity. Use the product_id from the catalogue.', schema({ product_id: productId, quantity }, ['product_id', 'quantity'])),
    update_cart_item: action('PATCH', '/api/cart/items/{product_id}', 'Set an existing cart product to the requested final quantity.', schema({ product_id: productId, quantity }, ['product_id', 'quantity'])),
    remove_cart_item: action('DELETE', '/api/cart/items/{product_id}', 'Remove all units of one product from the visitor’s cart.', schema({ product_id: productId }, ['product_id'])),
    clear_cart: action('DELETE', '/api/cart', 'Empty the cart only when the visitor explicitly asks to remove everything.', schema()),
    checkout: action('POST', '/api/checkout', 'Create a Stripe Checkout link for the current cart when the visitor asks to check out. Return checkout_url for them to open. This does not complete or confirm payment.', schema())
  };
}
