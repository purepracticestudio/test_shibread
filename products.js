// ═══════════════════════════════════════════════════════
//  products.js — 動態商品載入 v2.2  2026-06
// ═══════════════════════════════════════════════════════

const STOCK_API_URL = 'https://script.google.com/macros/s/AKfycbwUyoUOQKOxCfzZtJhDwSIhaBuuMM9VMAl52XjIcL78iXDZZbjFV8bTA8T--5JJfWacSQ/exec';

// 全域商品陣列（cart.js 也會使用這個陣列）
let PRODUCTS = [];

// ═══════════════════════════════════════
//  1. 從 Apps Script 讀取商品資料
// ═══════════════════════════════════════
function loadProducts() {
  return new Promise((resolve) => {
    const callbackName = 'productsCallback_' + Date.now();
    const script = document.createElement('script');

    window[callbackName] = function(data) {
      try {
        if (data.error) {
          console.warn('商品資料錯誤:', data.error);
          resolve({ deliveryDate: '' });
          return;
        }
        const raw = data.products || [];

        // 只取 active: true 的商品，
        // 並重新指定 id = 0, 1, 2... 讓 cart.js 可以正確比對
        PRODUCTS = raw
          .filter(p => p.active === true)
          .map((p, idx) => ({ ...p, id: idx }));

        resolve({ deliveryDate: data.deliveryDate || '' });
      } catch(e) {
        console.warn('商品資料解析失敗', e);
        resolve({ deliveryDate: '' });
      } finally {
        delete window[callbackName];
        if (document.body.contains(script)) document.body.removeChild(script);
      }
    };

    script.src = STOCK_API_URL + '?action=products&callback=' + callbackName;
    script.onerror = function() {
      console.warn('商品資料讀取失敗');
      delete window[callbackName];
      resolve({ deliveryDate: '' });
    };
    document.body.appendChild(script);
    setTimeout(() => resolve({ deliveryDate: '' }), 8000);
  });
}

// ═══════════════════════════════════════
//  2. 讀取即時庫存
//     PRODUCTS[i].id 現在是 0,1,2...
//     但庫存工作表的 key 是原始 D 欄值（也是 0,1,2...）
//     需要用原始 stockId 比對，所以在 loadProducts 時保留 stockId
// ═══════════════════════════════════════
function loadStocks() {
  if (!STOCK_API_URL) return Promise.resolve();
  return new Promise((resolve) => {
    const callbackName = 'stockCallback_' + Date.now();
    const script = document.createElement('script');

    window[callbackName] = function(data) {
      try {
        PRODUCTS.forEach(p => {
          // stockId 是原始 D 欄值（字串），庫存回傳的 key 也是字串
          const key = String(p.stockId);
          if (data[key] !== undefined) p.stock = Number(data[key]);
        });
      } catch(e) {
        console.warn('庫存資料解析失敗', e);
      } finally {
        delete window[callbackName];
        if (document.body.contains(script)) document.body.removeChild(script);
      }
      resolve();
    };

    script.src = STOCK_API_URL + '?callback=' + callbackName;
    script.onerror = function() {
      console.warn('庫存讀取失敗，使用預設值');
      delete window[callbackName];
      resolve();
    };
    document.body.appendChild(script);
    setTimeout(resolve, 5000);
  });
}

// ═══════════════════════════════════════
//  3. 更新頁面日期文字
// ═══════════════════════════════════════
function applyDeliveryDate(dateStr) {
  if (!dateStr) return;

  const navLink = document.querySelector('.nav-links a[href="#products"]');
  if (navLink) navLink.textContent = dateStr + ' 預定商品';

  const mobileLink = document.querySelector('.mobile-menu a[href="#products"]');
  if (mobileLink) mobileLink.textContent = dateStr + ' 預定商品';

  const sectionTitle = document.querySelector('#products .section-title');
  if (sectionTitle) sectionTitle.textContent = dateStr + ' 預定商品';

  const noticeDate = document.getElementById('delivery-date-display');
  if (noticeDate) noticeDate.textContent = dateStr;
}

// ═══════════════════════════════════════
//  4. 渲染商品卡片
// ═══════════════════════════════════════
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  const loading = document.getElementById('productsLoading');
  if (loading) loading.style.display = 'none';

  if (PRODUCTS.length === 0) {
    grid.innerHTML = '<p style="text-align:center;color:var(--muted);padding:3rem 1rem;grid-column:1/-1;">目前沒有上架中的商品，敬請期待！</p>';
    return;
  }

  grid.innerHTML = PRODUCTS.map(p => {
    const stock     = p.stock ?? 99;
    const isSoldOut = stock <= 0;
    const isLow     = stock > 0 && stock <= 3;

    const stockBadge = isSoldOut
      ? `<div class="stock-badge stock-badge--out">已售完</div>`
      : isLow
        ? `<div class="stock-badge stock-badge--low">⚡ 僅剩 ${stock} 顆</div>`
        : '';

    const badgeHTML = p.badgeSvg
      ? `<div class="product-badge product-badge--new">
           <svg width="36" height="36" viewBox="0 0 36 36">
             <circle cx="18" cy="18" r="17" fill="#725752" stroke="none"/>
             <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
             <text x="18" y="14" text-anchor="middle" font-family="'IM Fell English',Georgia,serif"
               font-style="italic" font-size="7" fill="#E3B5A4" letter-spacing="0.5">New</text>
             <line x1="10" y1="17" x2="26" y2="17" stroke="rgba(227,181,164,0.5)" stroke-width="0.6"/>
             <text x="18" y="24" text-anchor="middle" font-family="'Noto Serif TC',serif"
               font-size="5.5" fill="rgba(255,255,255,0.9)" letter-spacing="1">新 品</text>
           </svg>
         </div>`
      : p.badge
        ? `<div class="product-badge">${p.badge}</div>`
        : '';

    const imgHTML = p.image
      ? `<img src="${p.image}" alt="${p.name}" class="product-photo" loading="lazy">`
      : `<div class="bread-illustration"></div>`;

    const qtyHTML = isSoldOut ? '' : `
      <div class="qty-row">
        <button class="qty-btn" onclick="changeQty(${p.id}, -1)">−</button>
        <span class="qty-val" id="qty-${p.id}">1</span>
        <button class="qty-btn" onclick="changeQty(${p.id}, 1)">+</button>
      </div>`;

    const btnHTML = isSoldOut
      ? `<button class="add-to-cart add-to-cart--soldout" disabled>已售完</button>`
      : `<button class="add-to-cart" onclick="addToCart(${p.id})">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
             <line x1="3" y1="6" x2="21" y2="6"/>
             <path d="M16 10a4 4 0 01-8 0"/>
           </svg>
           加入購物車
         </button>`;

    return `
      <div class="product-card${isSoldOut ? ' product-card--soldout' : ''} reveal">
        <div class="product-img">
          ${imgHTML}
          ${badgeHTML}
          ${stockBadge}
        </div>
        <div class="product-body">
          <p class="product-tag">${p.tag}</p>
          <h3 class="product-name">${p.name}</h3>
          <p class="product-price">$${p.price} <small>/ 顆</small></p>
          <p class="product-desc">${p.desc}</p>
          <p class="product-ingredients">成份：${p.ingredients}</p>
          ${qtyHTML}
          ${btnHTML}
        </div>
      </div>`;
  }).join('');

  attachRevealObserver();
}

// ═══════════════════════════════════════
//  5. 主流程
// ═══════════════════════════════════════
(async function init() {
  const loading = document.getElementById('productsLoading');
  if (loading) loading.style.display = 'flex';

  try {
    const { deliveryDate } = await loadProducts();
    applyDeliveryDate(deliveryDate);
    await loadStocks();
    renderProducts();
  } catch(e) {
    console.error('商品初始化失敗', e);
    renderProducts();
  } finally {
    const loading = document.getElementById('productsLoading');
    if (loading) loading.style.display = 'none';
  }
})();
