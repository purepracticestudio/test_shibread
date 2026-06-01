// ═══════════════════════════════════════════════════════
//  products.js — 動態商品載入
//  v2.0  2026-06
//
//  【業者操作說明】
//  所有商品設定皆在 Google Sheets「預定商品」工作表管理。
//  網站程式碼不需要修改。
//
//  Google Sheets 欄位說明：
//  A: 網站預定更新日期（格式 yyyy/MM/dd HH:mm，留空表示立即依 C 欄決定）
//  B: 預定日期（出貨/送貨日，格式 MM/dd，顯示給客戶）
//  C: 開關 → 上架 / 下架 / 停售
//  D: 商品名稱
//  E: 價格
//  F: 麵糰小標
//  G: 描述
//  H: 成份
//  I: 標籤（人氣指定款 / 大人和小孩最愛 / New / 無）
//  J: 圖片網址（Netlify 路徑，例如 images/img_01.jpg）
// ═══════════════════════════════════════════════════════

// ── Apps Script 部署網址 ──
const STOCK_API_URL = 'https://script.google.com/macros/s/AKfycbz5xrSYvw6MNUUWJxGaOcXYA3qXfejnhqb6sUTY_ZQejfCnWUyogwT0qmBNsw0aOwrhxA/exec';

// 全域商品陣列（由 loadProducts() 填入）
let PRODUCTS = [];

// ═══════════════════════════════════════
//  1. 從 Apps Script 讀取商品資料
// ═══════════════════════════════════════
function loadProducts() {
  return new Promise((resolve) => {
    const callbackName = 'productsCallback_' + Date.now();
    const script       = document.createElement('script');

    window[callbackName] = function(data) {
      try {
        if (data.error) {
          console.warn('商品資料錯誤:', data.error);
          resolve({ deliveryDate: '', products: [] });
          return;
        }
        // 填入全域陣列
        PRODUCTS = data.products || [];
        resolve({ deliveryDate: data.deliveryDate || '', products: PRODUCTS });
      } catch(e) {
        console.warn('商品資料解析失敗', e);
        resolve({ deliveryDate: '', products: [] });
      } finally {
        delete window[callbackName];
        if (document.body.contains(script)) document.body.removeChild(script);
      }
    };

    script.src = STOCK_API_URL + '?action=products&callback=' + callbackName;
    script.onerror = function() {
      console.warn('商品資料讀取失敗');
      delete window[callbackName];
      resolve({ deliveryDate: '', products: [] });
    };
    document.body.appendChild(script);

    // 8 秒 timeout
    setTimeout(() => resolve({ deliveryDate: '', products: PRODUCTS }), 8000);
  });
}

// ═══════════════════════════════════════
//  2. 從 Apps Script 讀取即時庫存（沿用原架構）
// ═══════════════════════════════════════
function loadStocks() {
  if (!STOCK_API_URL) return Promise.resolve();
  return new Promise((resolve) => {
    const callbackName = 'stockCallback_' + Date.now();
    const script       = document.createElement('script');

    window[callbackName] = function(data) {
      try {
        PRODUCTS.forEach(p => {
          if (data[p.id] !== undefined) p.stock = Number(data[p.id]);
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
//  3. 更新頁面上的日期文字（nav / section title / notice）
// ═══════════════════════════════════════
function applyDeliveryDate(dateStr) {
  if (!dateStr) return;

  // nav desktop
  const navLink = document.querySelector('.nav-links a[href="#products"]');
  if (navLink) navLink.textContent = dateStr + ' 預定商品';

  // nav mobile
  const mobileLink = document.querySelector('.mobile-menu a[href="#products"]');
  if (mobileLink) mobileLink.textContent = dateStr + ' 預定商品';

  // section title
  const sectionTitle = document.querySelector('#products .section-title');
  if (sectionTitle) sectionTitle.textContent = dateStr + ' 預定商品';

  // notice 預訂並製作日
  const noticeDate = document.getElementById('delivery-date-display');
  if (noticeDate) noticeDate.textContent = dateStr;
}

// ═══════════════════════════════════════
//  4. 渲染商品卡片
// ═══════════════════════════════════════
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  // 只顯示 active: true 的商品
  const activeProducts = PRODUCTS.filter(p => p.active !== false);

  if (activeProducts.length === 0) {
    grid.innerHTML = '<p style="text-align:center;color:var(--muted);padding:3rem 1rem;">目前沒有上架中的商品，敬請期待！</p>';
    return;
  }

  grid.innerHTML = activeProducts.map(p => {
    const isFeatured = p.featured;
    const stock      = p.stock ?? 99;
    const isSoldOut  = stock <= 0;
    const isLow      = stock > 0 && stock <= 3;

    // ── 庫存狀態標示 ──
    const stockBadge = isSoldOut
      ? `<div class="stock-badge stock-badge--out">已售完</div>`
      : isLow
        ? `<div class="stock-badge stock-badge--low">⚡ 僅剩 ${stock} 顆</div>`
        : '';

    // ── 商品 badge ──
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

    // ── 圖片 ──
    const imgHTML = p.image
      ? `<img src="${p.image}" alt="${p.name}" class="product-photo" loading="lazy">`
      : `<div class="bread-illustration"></div>`;

    // ── 數量控制 ──
    const qtyHTML = isSoldOut ? '' : `
      <div class="qty-row">
        <button class="qty-btn" onclick="changeQty(${p.id}, -1)">−</button>
        <span class="qty-val" id="qty-${p.id}">1</span>
        <button class="qty-btn" onclick="changeQty(${p.id}, 1)">+</button>
      </div>`;

    // ── 加入購物車按鈕 ──
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
      <div class="product-card${isFeatured ? ' product-card--featured' : ''}${isSoldOut ? ' product-card--soldout' : ''} reveal">
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
//  5. 主流程：載入商品 → 套用日期 → 載入庫存 → 渲染
// ═══════════════════════════════════════
(async function init() {
  // 顯示 loading
  const loading = document.getElementById('productsLoading');
  if (loading) loading.style.display = 'flex';

  try {
    // Step A：讀取商品資料（含 deliveryDate）
    const { deliveryDate } = await loadProducts();

    // Step B：套用日期到 nav / title / notice
    applyDeliveryDate(deliveryDate);

    // Step C：讀取即時庫存
    await loadStocks();

    // Step D：渲染
    renderProducts();

  } catch(e) {
    console.error('商品初始化失敗', e);
    renderProducts(); // 嘗試渲染（即使失敗也不讓畫面空白）
  } finally {
    if (loading) loading.style.display = 'none';
  }
})();
