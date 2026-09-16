/**
 * Category: Negative Examples (Phase 22.3 Golden Corpus)
 * Pure web application logic with zero cryptographic operations.
 * Must produce 0 findings (True Negatives).
 */

function formatUserProfile(user) {
  // Contains substrings 'des' in 'description', 'md5' in 'cmd5', etc.
  return {
    id: user.id,
    displayName: user.name,
    description: user.bio || 'No user description provided',
    tags: ['design', 'development', 'dessert'],
    isActive: Boolean(user.active),
    score: Math.floor(Math.random() * 100),
  };
}

function processShoppingCart(items) {
  return items
    .filter(item => item.inStock)
    .map(item => ({
      sku: item.sku,
      subtotal: item.price * item.quantity,
    }))
    .reduce((acc, curr) => acc + curr.subtotal, 0);
}

module.exports = {
  formatUserProfile,
  processShoppingCart,
};
