/* ============================================================
   Uthena v4 — Demo JS
   Self-contained vanilla JS for the clickable demo. Powers:
   - Theme toggle (dark/light) — persisted in localStorage
   - Cart state — add, change tier, remove, count badge
   - PDP tabs, license selector, curriculum accordion
   - Catalog filter chips, sort, view toggle
   ============================================================ */

(() => {
  'use strict';

  /* ---------- Theme toggle ---------- */
  const THEME_KEY = 'uthena-demo-theme';
  const root = document.documentElement;

  function setTheme(theme) {
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    localStorage.setItem(THEME_KEY, theme);
    const btn = document.querySelector('.theme-toggle .theme-label');
    if (btn) btn.textContent = theme === 'light' ? 'Light' : 'Dark';
  }

  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY) || 'dark';
    setTheme(stored);
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const current = localStorage.getItem(THEME_KEY) || 'dark';
        setTheme(current === 'dark' ? 'light' : 'dark');
      });
    });
  }

  /* ---------- Cart state (localStorage) ---------- */
  const CART_KEY = 'uthena-demo-cart';

  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
    catch { return []; }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    syncCartBadge();
  }

  function addToCart(item) {
    const cart = getCart();
    const existing = cart.find(c => c.id === item.id && c.tier === item.tier);
    if (existing) {
      // already in cart, no-op for PLR (quantity always 1)
    } else {
      cart.push({ ...item, addedAt: Date.now() });
    }
    saveCart(cart);
    showToast(`Added "${item.title}" to cart`);
  }

  function removeFromCart(id, tier) {
    const cart = getCart().filter(c => !(c.id === id && c.tier === tier));
    saveCart(cart);
  }

  function changeCartTier(id, oldTier, newTier) {
    const cart = getCart();
    const item = cart.find(c => c.id === id && c.tier === oldTier);
    if (!item) return;
    const conflict = cart.find(c => c.id === id && c.tier === newTier);
    if (conflict) {
      // remove the old, the existing one stays
      saveCart(cart.filter(c => !(c.id === id && c.tier === oldTier)));
    } else {
      item.tier = newTier;
      saveCart(cart);
    }
  }

  function cartCount() { return getCart().length; }

  function syncCartBadge() {
    const n = cartCount();
    document.querySelectorAll('.nav-cart-link .ct').forEach(el => {
      el.textContent = n;
      el.classList.toggle('has-items', n > 0);
    });
  }

  /* ---------- Toast ---------- */
  function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.innerHTML = `<span class="icn">✓</span><span>${msg}</span>`;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ---------- PDP: license selector ---------- */
  function initLicenseSelector() {
    document.querySelectorAll('.license-group .opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const group = opt.closest('.license-group');
        group.querySelectorAll('.opt').forEach(o => o.classList.remove('sel'));
        opt.classList.add('sel');
        const input = opt.querySelector('input');
        if (input) input.checked = true;
        // Update price shown
        const price = opt.dataset.price;
        const priceEl = document.querySelector('.pinfo .price-row b');
        if (priceEl && price) {
          priceEl.textContent = '$' + Number(price).toLocaleString();
        }
        const cta = document.querySelector('.pinfo .actions .btn-primary');
        if (cta && price) {
          cta.innerHTML = `Add to cart — $${Number(price).toLocaleString()} <span class="arrow">→</span>`;
        }
      });
    });
  }

  /* ---------- PDP: tabs ---------- */
  function initTabs() {
    document.querySelectorAll('[data-tabs]').forEach(tabs => {
      const buttons = tabs.querySelectorAll('button');
      const panels = document.querySelectorAll(`[data-tab-panel]`);
      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          buttons.forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          const target = btn.dataset.target;
          panels.forEach(p => {
            p.style.display = p.dataset.tabPanel === target ? '' : 'none';
          });
        });
      });
    });
  }

  /* ---------- Catalog: filter pills & sort (visual only) ---------- */
  function initCatalogFilter() {
    document.querySelectorAll('.cat-top .pill .x').forEach(x => {
      x.addEventListener('click', e => {
        const pill = e.target.closest('.pill');
        if (pill) pill.remove();
      });
    });
  }

  /* ---------- Add-to-cart buttons ---------- */
  function initAddToCart() {
    document.querySelectorAll('[data-add-to-cart]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const data = JSON.parse(btn.dataset.addToCart);
        addToCart(data);
        // tiny button confirmation
        const orig = btn.innerHTML;
        btn.innerHTML = '<span style="color:#001A14;font-weight:600;">Added ✓</span>';
        btn.disabled = true;
        setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1600);
      });
    });
  }

  /* ---------- Init all ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    syncCartBadge();
    initLicenseSelector();
    initTabs();
    initCatalogFilter();
    initAddToCart();
  });
})();
