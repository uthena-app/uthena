/* ============================================================
   Uthena v4 — Cart page JS
   Reads from localStorage (set by main.js addToCart), renders
   line items, computes totals, handles remove / clear.
   ============================================================ */

(() => {
  'use strict';

  const CART_KEY = 'uthena-demo-cart';

  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
    catch { return []; }
  }
  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }

  const fmt = (cents) => '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  function render() {
    const cart = getCart();
    const page = document.getElementById('cartPage');
    const linesEl = document.getElementById('cartLines');
    const sub = document.getElementById('cartSub');

    if (cart.length === 0) {
      page.classList.remove('has-items');
      sub.textContent = 'Your cart is empty. Find a course your audience will buy.';
      return;
    }
    page.classList.add('has-items');
    sub.textContent = `${cart.length} item${cart.length !== 1 ? 's' : ''} in your cart · Your cart is saved to your account.`;

    linesEl.innerHTML = cart.map(item => `
      <div class="cart-line" data-id="${item.id}" data-tier="${item.tier}">
        <a class="thumb" href="p/${item.slug}.html"><img src="assets/${item.thumb}" alt="" /></a>
        <div class="info">
          <a class="ttl" href="p/${item.slug}.html" style="color: var(--heading);">${item.title}</a>
          <div class="meta">
            <span>${item.tier} License</span>
            <span>·</span>
            <span>Lifetime access</span>
            <span>·</span>
            <span>14-day refund</span>
          </div>
          <div class="tier-pick">
            <span class="t-faint t-xs">Change tier:</span>
            <select class="tier-select">
              <option value="PLR" ${item.tier === 'PLR' ? 'selected' : ''}>PLR — $${(item.price/100).toFixed(0)}</option>
              <option value="MRR" ${item.tier === 'MRR' ? 'selected' : ''}>MRR — $${((item.price + 4000)/100).toFixed(0)}</option>
            </select>
          </div>
        </div>
        <div class="right">
          <div class="price t-num">$${(item.price/100).toFixed(0)}</div>
          <button class="rm" data-remove>Remove</button>
        </div>
      </div>
    `).join('');

    // wire up tier change
    linesEl.querySelectorAll('.tier-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const line = e.target.closest('.cart-line');
        const id = line.dataset.id;
        const oldTier = line.dataset.tier;
        const newTier = e.target.value;
        const cart = getCart();
        const item = cart.find(c => c.id === id && c.tier === oldTier);
        if (item) {
          // simulate price change
          item.price = newTier === 'MRR' ? item.price + 4000 : item.price - 4000;
          item.tier = newTier;
          line.dataset.tier = newTier;
          saveCart(cart);
          render();
        }
      });
    });
    // wire up remove
    linesEl.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', e => {
        const line = e.target.closest('.cart-line');
        const id = line.dataset.id;
        const tier = line.dataset.tier;
        const cart = getCart().filter(c => !(c.id === id && c.tier === tier));
        saveCart(cart);
        // re-sync header badge via the global
        if (window.dispatchEvent) window.dispatchEvent(new Event('storage'));
        render();
      });
    });

    // totals
    const subtotal = cart.reduce((s, i) => s + i.price, 0);
    document.getElementById('subtotal').textContent = fmt(subtotal);
    document.getElementById('total').textContent = fmt(subtotal);
    document.getElementById('discount').textContent = '−$0';
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    document.getElementById('clearCart').addEventListener('click', () => {
      if (cart_count() === 0) return;
      if (confirm('Clear all items from your cart?')) {
        saveCart([]);
        if (window.dispatchEvent) window.dispatchEvent(new Event('storage'));
        render();
      }
    });
    document.getElementById('applyCoupon').addEventListener('click', () => {
      const code = document.getElementById('couponInput').value.trim().toUpperCase();
      if (!code) return;
      const sub = cart_total();
      let pct = 0;
      if (code === 'WELCOME10') pct = 0.10;
      else if (code === 'FOUNDER')  pct = 0.25;
      else if (code === 'LAUNCH')   pct = 0.15;
      else { alert('Demo: try WELCOME10, FOUNDER, or LAUNCH.'); return; }
      const disc = Math.round(sub * pct);
      document.getElementById('discount').textContent = '−' + fmt(disc);
      document.getElementById('total').textContent = fmt(sub - disc);
    });
  });

  // helpers
  function cart_count() { return getCart().length; }
  function cart_total() { return getCart().reduce((s, i) => s + i.price, 0); }
})();
