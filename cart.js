// ═══════════════════════════════════════
//  cart.js — 購物車邏輯
// ═══════════════════════════════════════

// ── 運費設定 ──
const SHIPPING_FEES = {
  local_delivery: 0,
  pickup:         0,
  seven:          129,
};

// ── 最少訂購數量 ──
const MIN_ORDER_QTY = 3;

// ── 狀態 ──
let cart = [];
let pageQty = {};

// ── 商品頁數量控制 ──
function changeQty(productId, delta) {
  if (pageQty[productId] === undefined) pageQty[productId] = 1;
  pageQty[productId] = Math.max(1, pageQty[productId] + delta);
  const el = document.getElementById('qty-' + productId);
  if (el) el.textContent = pageQty[productId];
}

// ── 加入購物車（含庫存檢查）──
function addToCart(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;

  const qty      = pageQty[productId] || 1;
  const existing = cart.find(i => i.id === productId);
  const inCart   = existing ? existing.qty : 0;
  const stock    = product.stock ?? 99;

  // 庫存檢查
  if (inCart + qty > stock) {
    const canAdd = stock - inCart;
    if (canAdd <= 0) {
      showStockToast(`「${product.name}」庫存已達上限（${stock} 顆）`);
      return;
    }
    // 只加到庫存上限
    existing ? existing.qty = stock : cart.push({ ...product, qty: stock });
    showStockToast(`「${product.name}」最多只能加 ${stock} 顆`);
    pageQty[productId] = 1;
    const el = document.getElementById('qty-' + productId);
    if (el) el.textContent = 1;
    renderCart();
    openCart();
    return;
  }

  if (existing) { existing.qty += qty; }
  else { cart.push({ ...product, qty }); }
  pageQty[productId] = 1;
  const el = document.getElementById('qty-' + productId);
  if (el) el.textContent = 1;
  renderCart();
  openCart();
}
// ── 購物車開關 ──
function openCart() {
  document.getElementById('cartOverlay').classList.add('open');
  document.getElementById('cartDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cartOverlay').classList.remove('open');
  document.getElementById('cartDrawer').classList.remove('open');
  document.body.style.overflow = '';
}

// ── 購物車內數量調整（含庫存上限檢查）──
function ciQty(index, delta) {
  const item    = cart[index];
  const product = PRODUCTS.find(p => p.id === item.id);
  const stock   = product ? (product.stock ?? 99) : 99;
  const newQty  = item.qty + delta;

  if (delta > 0 && newQty > stock) {
    // 超過庫存，顯示提示
    showStockToast(`「${item.name}」庫存僅剩 ${stock} 顆`);
    item.qty = stock; // 設定為上限
    renderCart();
    return;
  }

  cart[index].qty = Math.max(1, newQty);
  renderCart();
}

// ── 庫存提示（取代 alert，不打斷操作）──
function showStockToast(msg) {
  let toast = document.getElementById('stockToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'stockToast';
    toast.style.cssText = [
      'position:fixed', 'bottom:90px', 'left:50%', 'transform:translateX(-50%)',
      'background:#725752', 'color:#fff', 'padding:10px 20px',
      'font-family:Noto Serif TC,serif', 'font-size:0.82rem',
      'border-radius:2px', 'z-index:9999', 'opacity:0',
      'transition:opacity 0.3s', 'pointer-events:none',
      'white-space:nowrap'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}
function removeItem(index) {
  cart.splice(index, 1);
  renderCart();
}

// ── 計算金額 ──
function getSubtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}
function getShipping() {
  // 運費在結帳時才計算，購物車只顯示小計
  return 0;
}
function getTotal() { return getSubtotal(); }

// ── 取貨方式標籤 ──
function getShippingLabel(method) {
  const labels = {
    local_delivery: '送貨到府（限新竹）',
    pickup:         '自取（竹北東興國小）',
    seven:          '7-11 冷凍店到店',
  };
  return labels[method] || method;
}

// ── 更新金額顯示 ──
function updateTotals() {
  const sub = getSubtotal();
  const el = document.getElementById('subtotalEl');
  if (el) el.textContent = '$' + sub;
  const totalEl = document.getElementById('totalEl');
  if (totalEl) totalEl.textContent = '$' + sub;
}

// ── 總顆數 ──
function getTotalQty() {
  return cart.reduce((s, i) => s + i.qty, 0);
}

// ── 渲染購物車 ──
function renderCart() {
  const totalQty = getTotalQty();
  const cc = document.getElementById('cartCount');
  cc.textContent = totalQty;
  totalQty ? cc.classList.add('show') : cc.classList.remove('show');

  const itemsEl  = document.getElementById('cartItemsEl');
  const footerEl = document.getElementById('cartFooterEl');

  if (!cart.length) {
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <div style="font-size:2.5rem;opacity:0.35;margin-bottom:1rem">🍞</div>
        <p>購物車是空的<br>快去挑選喜歡的麵包吧</p>
      </div>`;
    footerEl.style.display = 'none';
    return;
  }

  footerEl.style.display = 'block';

  itemsEl.innerHTML = cart.map((item, idx) => {
    const product  = PRODUCTS.find(p => p.id === item.id);
    const stock    = product ? (product.stock ?? 99) : 99;
    const atLimit  = item.qty >= stock;
    const isLow    = stock > 0 && stock <= 3;
    const isSoldOut = stock <= 0;

    // 庫存提示文字（僅剩 X 顆 或 已售完，沒有則隱藏）
    const stockHint = isSoldOut
      ? `<div class="cart-stock-hint cart-stock-hint--out">已售完</div>`
      : isLow
        ? `<div class="cart-stock-hint cart-stock-hint--low">⚡ 僅剩 ${stock} 顆</div>`
        : '';

    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">$${item.price} / 顆</div>
          ${stockHint}
        </div>
        <div class="cart-item-right">
          <div class="cart-item-qty">
            <button class="ci-qty-btn" onclick="ciQty(${idx}, -1)">−</button>
            <span class="ci-qty-val">${item.qty}</span>
            <button class="ci-qty-btn" onclick="ciQty(${idx}, 1)"
              ${atLimit ? 'disabled style="opacity:0.35;cursor:not-allowed"' : ''}>+</button>
          </div>
          <div class="cart-item-subtotal">$${item.price * item.qty}</div>
          <button class="cart-item-remove" onclick="removeItem(${idx})" title="移除">✕</button>
        </div>
      </div>`;
  }).join('');

  updateTotals();

  // 最少3顆提示 & 結帳按鈕狀態
  const warn = document.getElementById('cartMinWarn');
  const btn  = document.getElementById('checkoutBtn');
  const underMin = totalQty < MIN_ORDER_QTY;

  if (warn) warn.style.display = underMin ? 'block' : 'none';
  if (btn) {
    btn.disabled = underMin;
    btn.style.opacity = underMin ? '0.45' : '1';
    btn.style.cursor  = underMin ? 'not-allowed' : 'pointer';
    btn.textContent   = underMin
      ? `還差 ${MIN_ORDER_QTY - totalQty} 顆才成單`
      : '前往結帳 →';
  }
}

// ── 初始化購物車 ──
function initCart() {
  document.getElementById('cartToggle').addEventListener('click', openCart);
  renderCart();
}
