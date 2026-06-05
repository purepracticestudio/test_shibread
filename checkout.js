// ═══════════════════════════════════════
//  checkout.js — 結帳流程 & 訂單通知
//  通知方式：Make.com Webhook → Resend Email
//  v4：多種取貨方式 + 下單後補填末五碼 + 14天到期查詢 + 已付款狀態顯示
// ═══════════════════════════════════════

// ── 匯款資訊（請替換成真實帳號）──
const BANK_INFO = {
  bank:    '星展銀行（810）',
  branch:  '竹城分行',
  account: '3125838019',  // ← 替換成您的帳號
  holder:  '林文怡',      // ← 替換成戶名
};

// ── Make.com Webhook 網址 ──
const MAKE_WEBHOOK_URL      = 'https://hook.eu1.make.com/vvlzl4dslrov7wi6if5e7rts2gugo8eu';
const MAKE_BANKCODE_WEBHOOK = 'https://hook.eu1.make.com/vvlzl4dslrov7wi6if5e7rts2gugo8eu'; // 可設定獨立 Webhook

// ── Secret Token（需與 Apps Script 的 SECRET_TOKEN 一致）──
const SECRET_TOKEN = 'SB-BREAD-2025'; // ← 與 stock_api.gs 保持相同

// ── 訂單保留天數（超過後無法查詢，自動清除）──
const ORDER_EXPIRE_DAYS = 14;

function getShippingFee(method) { return SHIPPING_FEES[method] ?? 0; }

function getShippingLabel(method) {
  const labels = {
    local_delivery: '送貨到府（限新竹）',
    pickup:         '自取（竹北東興國小）',
    seven:          '7-11 冷凍店到店',
  };
  return labels[method] || method;
}

// ── 結帳狀態 ──
let checkoutStep = 1;
let formData = {};

// ══════════════════════════════════════
//  結帳 Modal 開關
// ══════════════════════════════════════
function openCheckout() {
  if (!cart.length) return;
  checkoutStep = 1;
  // 若 formData 已有資料（使用者修改購物車後重新開啟），保留不重置
  // 只有在完全沒有資料時才初始化（首次開啟）
  if (!formData.name && !formData.phone && !formData.email) {
    formData = {};
  }
  closeCart();
  renderCheckoutStep();
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';

  if (checkoutStep >= 3) {
    // 步驟 3、4（訂單已建立）→ 清除購物車與表單資料
    cart = [];
    formData = {};
    renderCart();
    checkoutStep = 1;
    // 重新讀取庫存並更新商品顯示（末五碼送出後庫存已扣）
    loadStocks().then(() => renderProducts());
  }
  // 步驟 1、2 關閉時：保留 formData，讓使用者修改購物車後重新開啟仍有資料
}

// openCheckout 時若 formData 已有資料（從購物車返回），直接繼續步驟 1
// 完全重置只在訂單完成後才發生

function getCurrentShipping() {
  return document.getElementById('shippingSelect')?.value || 'local_delivery';
}

// ══════════════════════════════════════
//  步驟指示列
// ══════════════════════════════════════
function stepsBarHTML() {
  const s = checkoutStep;
  const dot = (n) => s > n ? '✓' : n;
  const cls = (n) => s > n ? 'done' : s === n ? 'active' : '';
  return `
    <div class="steps">
      <div class="step ${cls(1)}"><div class="step-dot">${dot(1)}</div><div class="step-label">填寫資料</div></div>
      <div class="step ${cls(2)}"><div class="step-dot">${dot(2)}</div><div class="step-label">確認訂單</div></div>
      <div class="step ${cls(3)}"><div class="step-dot">${dot(3)}</div><div class="step-label">匯款資訊</div></div>
    </div>`;
}

// ══════════════════════════════════════
//  渲染各步驟
// ══════════════════════════════════════
function renderCheckoutStep() {
  const body = document.getElementById('modalBody');
  const sm = getCurrentShipping();

  // ── 步驟 1：填寫資料 ──
 if (checkoutStep === 1) {
    body.innerHTML = stepsBarHTML() + `
      <div style="background:#FFF8F0;border-left:3px solid #E3B5A4;padding:0.7rem 1rem;margin-bottom:1.2rem;font-size:0.78rem;color:#9B7B72;line-height:1.8">
        ⚠️ 請使用半形文字填寫（英文、數字請使用一般鍵盤輸入），避免使用全形字或特殊符號，以免影響訂單處理，建議直接手動輸入。
      </div>

      <div class="form-group">
        <label>姓名 <span class="req">*</span></label>
        <input class="form-input" id="fn" placeholder="請輸入姓名" value="${formData.name || ''}">
        <div class="form-err" id="en">請填寫姓名</div>
      </div>
      <div class="form-row2">
        <div class="form-group">
          <label>電話 <span class="req">*</span></label>
          <input class="form-input" id="fp" type="tel" placeholder="09xxxxxxxx" value="${formData.phone || ''}">
          <div class="form-err" id="ep">請填寫有效電話</div>
        </div>
        <div class="form-group">
          <label>Email <span class="req">*</span></label>
          <input class="form-input" id="fe" type="email" placeholder="your@email.com" value="${formData.email || ''}">
          <div class="form-err" id="ee">請填寫有效 Email</div>
        </div>
      </div>
      <div class="form-group">
        <label>取貨方式 <span class="req">*</span></label>
        <div class="radio-group">
          <label class="radio-opt ${sm === 'local_delivery' ? 'selected' : ''}"
            onclick="selectShipping(this, 'local_delivery')">
            <input type="radio" name="ship" value="local_delivery" ${sm === 'local_delivery' ? 'checked' : ''}>
            <div class="rot">
              <strong>🛵 送貨到府（免運費）</strong>
              <small>限新竹區域，出貨時間另行通知</small>
            </div>
          </label>
          <label class="radio-opt ${sm === 'pickup' ? 'selected' : ''}"
            onclick="selectShipping(this, 'pickup')">
            <input type="radio" name="ship" value="pickup" ${sm === 'pickup' ? 'checked' : ''}>
            <div class="rot">
              <strong>🏫 自取（竹北東興國小）</strong>
              <small>取件時間另行通知</small>
            </div>
          </label>
          <label class="radio-opt ${sm === 'seven' ? 'selected' : ''}"
            onclick="selectShipping(this, 'seven')">
            <input type="radio" name="ship" value="seven" ${sm === 'seven' ? 'checked' : ''}>
            <div class="rot">
              <strong>🏪 7-11 冷凍店到店（+$129）</strong>
              <small>外縣市適用 · 僅限已付款取件 · 無貨到付款</small>
            </div>
          </label>
        </div>
      </div>
      <div class="form-group" id="addrGrp" style="${sm === 'local_delivery' ? '' : 'display:none'}">
        <label>收件地址 <span class="req">*</span></label>
        <input class="form-input" id="fa" placeholder="新竹縣市 + 詳細地址" value="${formData.address || ''}">
        <div class="form-err" id="ea">請填寫新竹收件地址</div>
      </div>
      <div class="form-group" id="sevenGrp" style="${sm === 'seven' ? '' : 'display:none'}">
        <label>7-11 取件店名及地址 <span class="req">*</span></label>
        <input class="form-input" id="fss" placeholder="例如:竹陵店新竹市北區東大路二段174號"
          value="${formData.sevenStore || ''}">
        <div class="form-note">
          <a href="https://emap.pcsc.com.tw/emap.aspx" target="_blank"
            style="color:var(--primary);text-decoration:underline">🔍 查詢 7-11 門市與地址</a>
        </div>
        <div class="form-note" style="color:#c0675a;margin-top:0.3rem">
          ⚠️ 注意事項: <br>1.冷凍店到店需付款後才可取件，無貨到付款 <br> 2.請直接輸入店名及地址，勿複製貼上含有特殊符號的文字
        </div>
        <div class="form-err" id="ess">請填寫 7-11 取件店名及地址</div>
      </div>
      <div class="form-group">
        <label>備註 / 特殊需求</label>
        <textarea class="form-input" id="fno" placeholder="例如：指定口味、需求詢問...">${formData.note || ''}</textarea>
      </div>

      <!-- 社群聯繫方式（不用必填，單選）-->
      <div class="form-group">
        <label>社群聯繫方式 <span class="req"></span></label>
        <div class="form-note" style="margin-bottom:0.6rem">可選擇一項，方便我們聯繫確認出貨</div>
        <div class="radio-group">

          <!-- Instagram -->
          <label class="radio-opt ${formData.socialPlatform === 'ig' ? 'selected' : ''}"
            onclick="selectSocial(this, 'ig')">
            <input type="radio" name="social" value="ig" ${formData.socialPlatform === 'ig' ? 'checked' : ''}>
            <div class="rot" style="display:flex;align-items:center;gap:0.5rem">
              <strong>Instagram</strong>
            </div>
          </label>

          <!-- Threads -->
          <label class="radio-opt ${formData.socialPlatform === 'thread' ? 'selected' : ''}"
            onclick="selectSocial(this, 'thread')">
            <input type="radio" name="social" value="thread" ${formData.socialPlatform === 'thread' ? 'checked' : ''}>
            <div class="rot" style="display:flex;align-items:center;gap:0.5rem">
              <strong>Threads</strong>
            </div>
          </label>

          <!-- LINE -->
          <label class="radio-opt ${formData.socialPlatform === 'line' ? 'selected' : ''}"
            onclick="selectSocial(this, 'line')">
            <input type="radio" name="social" value="line" ${formData.socialPlatform === 'line' ? 'checked' : ''}>
            <div class="rot" style="display:flex;align-items:center;gap:0.5rem">
              <strong>LINE</strong> <p>建議先加入官方 LINE <a href="https://line.me/ti/p/~@shibread" target="_blank" class="footer-social-link">@shibread </a> 我們才可以聯繫到您</p>
            </div>
          </label>
        </div>

        <!-- 帳號輸入框（選後展開）-->
        <div id="social-input-wrap" style="${formData.socialPlatform ? '' : 'display:none'}" class="social-input-wrap" style="margin-top:0.8rem">
          <span class="social-prefix">@</span>
          <input class="form-input social-input" id="val-social"
            placeholder="${formData.socialPlatform === 'ig' ? '您的 IG 帳號' : formData.socialPlatform === 'thread' ? '您的 Threads 帳號' : '您的 LINE ID'}"
            value="${formData.socialId || ''}">
        </div>
        <div class="form-err" id="e-social">請選擇並填寫社群帳號</div>
      </div>

      <div class="modal-nav">
        <button class="btn-next btn-full" onclick="validateStep1()">下一步：確認訂單 →</button>
      </div>`;
    return;
  }

  // ── 步驟 2：確認訂單 ──
  if (checkoutStep === 2) {
    const sub = getSubtotal();
    const sh = getShippingFee(formData.ship);
    const tot = sub + sh;
    const shipLabel = getShippingLabel(formData.ship);
    body.innerHTML = stepsBarHTML() + `
      <div class="order-summary">
        <h4>📦 訂單明細</h4>
        ${cart.map(i => `
          <div class="sum-item">
            <span>${i.name} × ${i.qty}</span>
            <strong>$${i.price * i.qty}</strong>
          </div>`).join('')}
        <hr class="sum-div">
        <div class="sum-item"><span>商品小計</span><strong>$${sub}</strong></div>
        <div class="sum-item"><span>運費（${shipLabel}）</span><strong>${sh ? '$' + sh : '免費'}</strong></div>
        <hr class="sum-div">
        <div class="sum-total"><span>總計</span><span>$${tot}</span></div>
      </div>
      <div style="background:var(--cream);padding:1.1rem 1.3rem;margin-bottom:1.4rem;font-size:0.82rem;color:var(--mid);line-height:2;">
        <div style="color:var(--primary);font-weight:600;margin-bottom:0.4rem;">收件資訊</div>
        <div>姓名：${formData.name}</div>
        <div>電話：${formData.phone}</div>
        <div>Email：${formData.email}</div>
        <div>取貨方式：${shipLabel}</div>
        ${formData.ship === 'local_delivery' ? `<div>地址：${formData.address}</div>` : ''}
        ${formData.ship === 'seven' ? `<div>7-11 取件店：${formData.sevenStore}</div>` : ''}
        ${formData.note ? `<div>備註：${formData.note}</div>` : ''}
          <div style="margin-top:0.4rem;padding-top:0.4rem;border-top:1px solid rgba(227,181,164,0.3)">
          <div style="color:var(--primary);font-weight:600;margin-bottom:0.2rem">社群聯繫</div>
          <div>${formData.socialPlatform === 'ig' ? 'Instagram' : formData.socialPlatform === 'thread' ? 'Threads' : 'LINE'}：@${formData.socialId}</div>
        </div>
      </div>
      <div class="modal-nav">
        <button class="btn-back" onclick="checkoutStep=1;renderCheckoutStep()">← 修改資料</button>
        <button class="btn-next" id="confirmBtn" onclick="handleConfirmOrder(this)">確認並前往匯款 →</button>
      </div>`;
    return;
  }

  // ── 步驟 3：匯款資訊（末五碼非必填，可稍後查詢補填）需替換銀行帳號──
  if (checkoutStep === 3) {
    const sh = getShippingFee(formData.ship);
    const tot = getSubtotal() + sh;
    body.innerHTML = stepsBarHTML() + `
      <div class="success-wrap" style="margin-bottom:1.5rem">
        <div class="success-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#725752" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h3>訂單已建立！</h3>
        <p class="success-order">訂單編號：${formData.orderNo}</p>
        <p style="font-size:0.82rem;color:var(--mid);line-height:2">
          確認信已寄至 <strong style="color:var(--primary)">${formData.email}</strong><br>
          請於 <strong style="color:var(--primary)">48 小時內</strong> 完成匯款<br>
          匯款後可<strong style="color:var(--primary)">隨時回來補填末五碼</strong>
        </p>
      </div>

      <div class="transfer-box">
        <h4>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
          </svg>
          匯款資訊
        </h4>
        <div class="tr-row"><span class="tr-label">銀行</span><span class="tr-val">${BANK_INFO.bank}</span></div>
        <div class="tr-row"><span class="tr-label">分行</span><span class="tr-val">${BANK_INFO.branch}</span></div>
        <div class="tr-row">
          <span class="tr-label">帳號</span>
          <span class="tr-val">
            ${BANK_INFO.account}
            <button class="copy-btn" onclick="copyText('${BANK_INFO.account}', this)">複製</button>
          </span>
        </div>
        <div class="tr-row"><span class="tr-label">戶名</span><span class="tr-val">${BANK_INFO.holder}</span></div>
        <div class="tr-row"><span class="tr-label">匯款金額</span><span class="tr-amount">$${tot}</span></div>
      </div>

      <!-- 當場填末五碼區塊 -->
      <div class="bank-code-section">
        <div class="bank-code-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          已完成匯款？現在填入末五碼
        </div>
        <div class="form-group" style="margin-bottom:0.8rem">
          <input class="form-input" id="fbc" maxlength="5"
            placeholder="請輸入匯款帳號末 5 碼" inputmode="numeric"
            style="text-align:center;font-size:1.2rem;letter-spacing:0.3em">
          <div class="form-note">填入後我們會立即通知業者確認款項</div>
          <div class="form-err" id="ebc">請填寫 5 位數字</div>
        </div>
        <button class="btn-next btn-full" onclick="submitBankCode()">送出匯款末五碼 ✓</button>
      </div>

      <!-- 稍後補填區塊 -->
      <div class="later-section">
        <div class="later-divider"><span>或者</span></div>
        <div class="later-box">
          <p style="font-size:0.82rem;color:var(--mid);margin-bottom:1rem;line-height:1.9;text-align:center">
            先儲存訂單編號，匯款後再回來補填<br>
            <span style="font-size:0.82rem">查詢時需要：訂單編號 + Email 或電話</span>
          </p>
          <div class="order-ref-box">
            <span class="order-ref-label">您的訂單編號</span>
            <span class="order-ref-no">${formData.orderNo}</span>
            <button class="copy-btn" onclick="copyText('${formData.orderNo}', this)">複製</button>
          </div>
          <button class="btn-later" onclick="closeModal(); cart=[]; renderCart();">
            稍後補填，先關閉視窗
          </button>
        </div>
      </div>

      <div class="transfer-note">
        <strong>注意事項</strong><br>
        · 確認信已寄至您的 Email，信中含訂單編號與匯款帳號<br>
        · 請於 48 小時內完成匯款並補填末五碼<br>
        · 訂單查詢紀錄會於 <strong>到貨後</strong>和<strong>14天後</strong>自動清除，請盡早完成匯款<br>
        ${formData.ship === 'seven' ? '· 7-11 冷凍店到店僅限已付款取件，無貨到付款<br>' : ''}
        · 如有疑問請到 Line 官方帳號 <a href="https://line.me/ti/p/~@shibread" target="_blank" class="footer-social-link">@shibread </a> 詢問
      </div>`;
    return;
  }

  // ── 步驟 4：末五碼送出完成 ──
  if (checkoutStep === 4) {
    const expireDate = new Date(Date.now() + ORDER_EXPIRE_DAYS * 24 * 60 * 60 * 1000).toLocaleDateString('zh-TW');
    body.innerHTML = `
      <div class="success-wrap" style="padding:2.5rem 0">
        <div class="success-icon" style="background:rgba(74,124,89,0.12)">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h3>末五碼已送出！🍞</h3>
        <p class="success-order">訂單編號：${formData.orderNo}</p>
        <p style="font-size:0.85rem;color:var(--mid);line-height:2.2;margin-top:0.8rem">
          我們已收到您的匯款末五碼<br>
          確認款項後將以 <strong style="color:var(--primary)">Email或社群帳號</strong> 通知您出貨時間<br>
          感謝支持食麵包的每一顆手工麵包 ♡
        </p>
        <div style="background:rgba(227,181,164,0.12);border-left:3px solid var(--accent);padding:0.65rem 1rem;margin:1.2rem 0;font-size:0.74rem;color:var(--light-text);line-height:1.9;text-align:left">
          ⏱ 訂單查詢紀錄會於 <strong>到貨後</strong>和<strong style="color:var(--mid)">${expireDate}</strong> 自動清除（下單後 14 天）<br>
          到期前可透過「查詢訂單」確認付款狀態<br>
          如有疑問請到 Line 官方帳號 <a href="https://line.me/ti/p/~@shibread" target="_blank" class="footer-social-link">@shibread </a> 詢問
        </div>
        <div style="margin-top:1.2rem;display:flex;gap:1rem;justify-content:center;flex-wrap:wrap">
          <button onclick="closeLookup && openOrderLookup()"
            style="display:inline-flex;align-items:center;gap:0.4rem;background:var(--cream);color:var(--primary);border:1px solid rgba(114,87,82,0.3);padding:0.6rem 1.2rem;font-size:0.82rem;cursor:pointer;font-family:'Noto Serif TC',serif;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            查詢此訂單
          </button>
          <a href="https://www.instagram.com/shibread_traveler/" target="_blank"
            style="display:inline-flex;align-items:center;gap:0.5rem;color:var(--primary);font-size:0.82rem;text-decoration:none;border:1px solid rgba(114,87,82,0.3);padding:0.6rem 1.2rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>
            追蹤最新資訊
          </a>
          <button onclick="closeModal(); cart=[]; renderCart();"
            style="background:none;border:1px solid rgba(114,87,82,0.2);color:var(--mid);font-size:0.82rem;padding:0.6rem 1.2rem;cursor:pointer;font-family:'Noto Serif TC',serif;">
            關閉視窗
          </button>
        </div>
      </div>`;
  }
}

// ══════════════════════════════════════
//  訂單查詢 Modal（補填末五碼）
// ══════════════════════════════════════
function openOrderLookup() {
  document.getElementById('lookupOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  renderLookupStep('form');
}

function closeLookup() {
  document.getElementById('lookupOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function renderLookupStep(step) {
  const body = document.getElementById('lookupBody');
  if (!body) return;

  // ── 查詢表單 ──
  if (step === 'form') {
    body.innerHTML = `
      <div style="text-align:center;margin-bottom:1.5rem">
        <div style="width:48px;height:48px;background:rgba(114,87,82,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 0.8rem">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#725752" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </div>
        <h3 style="font-family:'Noto Serif TC', serif;font-size:1.1rem;color:var(--primary)">查詢訂單 / 補填末五碼</h3>
        <p style="font-size:0.82rem;color:var(--mid);margin-top:0.5rem;line-height:1.8">
          輸入下單時的訂單編號，以及 Email 或電話驗證身份
        </p>
      </div>
      <div class="form-group">
        <label>訂單編號 <span class="req">*</span></label>
        <input class="form-input" id="lk-order" placeholder="SBxxxxxxxx（見確認信）"
          style="text-transform:uppercase;letter-spacing:0.08em">
        <div class="form-err" id="lk-err-order">請填寫訂單編號</div>
      </div>
      <div class="form-group">
        <label>Email 或電話 <span class="req">*</span>（擇一填寫）</label>
        <input class="form-input" id="lk-contact" placeholder="your@email.com 或 09xxxxxxxx">
        <div class="form-note">請填寫下單時使用的 Email 或電話</div>
        <div class="form-err" id="lk-err-contact">請填寫 Email 或電話</div>
      </div>
      <div class="modal-nav">
        <button class="btn-back" onclick="closeLookup()">取消</button>
        <button class="btn-next" onclick="lookupOrder()">查詢訂單 →</button>
      </div>`;
    return;
  }

  // ── 找到訂單：區分已付款 / 未付款 / 已逾期 ──
  if (step === 'bankcode') {
    const od = window._lookupOrder;

    // 逾期取消：直接顯示取消畫面
    if (od.orderStatus === '已釋出') {
      body.innerHTML = `
        <div style="text-align:center;padding:2rem 0">
          <div style="width:48px;height:48px;background:rgba(192,103,90,0.12);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 0.8rem">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C0675A" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          </div>
          <h3 style="font-family:'Noto Serif TC', serif;font-size:1.1rem;color:#C0675A">訂單已逾期取消</h3>
          <div style="background:#FFF8F0;border-left:3px solid #E3B5A4;padding:1rem 1.2rem;margin:1.2rem 0;font-size:0.82rem;color:#9B7B72;line-height:2.2;text-align:left">
            <div>訂單編號：<strong style="color:#3A2C28">${od.orderNo}</strong></div>
            <div>商品：${od.cart}</div>
            <div>總金額：$${od.total}</div>
          </div>
          <p style="font-size:0.82rem;color:#9B7B72;line-height:2;margin-bottom:1.2rem">
            此訂單因超過 48 小時未完成匯款已自動取消。<br>
            若您還需要購買，歡迎重新訂購。<br>
            若有其他問題，請到官方 Line <strong><a href="https://line.me/ti/p/~@shibread" target="_blank" class="footer-social-link">@shibread </a> </strong> 私訊，謝謝。
          </p>
          <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap">
            <a href="https://www.shibread.com/" 
              style="display:inline-flex;align-items:center;background:#725752;color:#fff;padding:0.7rem 1.5rem;font-size:0.82rem;text-decoration:none;font-family:'Noto Serif TC',serif;">
              前往官網重新訂購
            </a>
            <button onclick="closeLookup()"
              style="background:none;border:1px solid rgba(114,87,82,0.2);color:#9B7B72;font-size:0.82rem;padding:0.7rem 1.2rem;cursor:pointer;font-family:'Noto Serif TC',serif;">
              關閉
            </button>
          </div>
        </div>`;
      return;
    }

   const expireDate = od.expireAt
   ? new Date(od.expireAt).toLocaleDateString('zh-TW')
  : '—';
const isPaid = !!od.bankCode;

    // 計算剩餘天數
    const daysLeft = Math.ceil((od.expireAt - Date.now()) / (1000 * 60 * 60 * 24));
    const expireNote = daysLeft <= 3
      ? `<span style="color:var(--warn,#c0675a)">⚠️ ⏱ 查詢紀錄將於下單後 14 天或收到貨後，自動清除 </span>`
      : `⏱ 查詢紀錄將於下單後 14 天或收到貨後，自動清除`;

    body.innerHTML = `
      <div style="text-align:center;margin-bottom:1.5rem">
        <div style="width:48px;height:48px;background:${isPaid ? 'rgba(74,124,89,0.12)' : 'rgba(114,87,82,0.1)'};border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 0.8rem">
          ${isPaid
            ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
            : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#725752" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`
          }
        </div>
        <h3 style="font-family:'Shippori Mincho',serif;font-size:1.1rem;color:var(--primary)">
          ${isPaid ? '訂單已付款 ✓' : '找到您的訂單'}
        </h3>
      </div>

      <!-- 訂單資訊卡 -->
      <div style="background:var(--cream);padding:1.1rem 1.3rem;margin-bottom:1.2rem;font-size:0.82rem;color:var(--mid);line-height:2.2;border-left:3px solid ${isPaid ? '#4A7C59' : 'var(--accent)'}">
        <div style="color:var(--primary);font-weight:600;margin-bottom:0.4rem">訂單資訊</div>
        <div>訂單編號：<strong style="color:var(--dark)">${od.orderNo}</strong></div>
        <div>訂購人：${od.name}</div>
        <div>商品：${od.cart}</div>
        <div>總金額：<strong style="color:var(--primary)">$${od.total}</strong></div>
        <div>取貨方式：${od.ship}</div>
        ${isPaid
          ? `<div style="margin-top:0.4rem;padding-top:0.4rem;border-top:1px solid rgba(227,181,164,0.4)">
               付款狀態：<strong style="color:#4A7C59">✓ 已送出末五碼</strong><br>
               末五碼：<strong style="color:var(--dark);letter-spacing:0.15em">${od.bankCode}</strong><br>
               付款時間：${od.paidAt || '—'}
             </div>`
             // 付款時間：${od.paidAt} 目前沒有欄位帶入
          : `<div>付款狀態：<span style="color:var(--warn,#c0675a)">⏳ 待付款</span></div>
             <div>銀行：${BANK_INFO.bank}</div>
             <div>匯款帳號：${BANK_INFO.account}</div>
             <div>⚠️ 若已經匯款並完成輸入匯款碼，請過幾分鐘後再重新搜尋訂單。</div>
             `
        }
      </div>

      <!-- 到期提示 -->
      <div style="background:rgba(227,181,164,0.12);border-left:3px solid var(--accent);padding:0.65rem 1rem;margin-bottom:1.2rem;font-size:0.74rem;color:var(--primary);line-height:1.8">
        ${expireNote}<br>
        如有疑問請到 Line 官方帳號<a href="https://line.me/ti/p/~@shibread" target="_blank" class="footer-social-link">@shibread </a> 詢問
      </div>

      ${isPaid
        ? `<!-- 已付款：不需再填 -->
           <div style="text-align:center;padding:0.5rem 0 1rem">
             <p style="font-size:0.82rem;color:var(--mid);line-height:1.9;margin-bottom:1.2rem">
               末五碼已送出，我們確認款項後，會以 Email 或 社群帳號 通知出貨時間
             </p>
             <button class="btn-next" style="padding:0.75rem 2rem" onclick="closeLookup()">關閉</button>
           </div>`
        : `<!-- 未付款：顯示填末五碼表單 -->
           <div class="bank-code-section" style="margin-bottom:0">
             <div class="bank-code-title">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
               已完成匯款？填入末五碼
             </div>
             <div class="form-group" style="margin-bottom:0.8rem">
               <input class="form-input" id="lk-bankcode" maxlength="5"
                 placeholder="請輸入末 5 碼" inputmode="numeric"
                 style="text-align:center;font-size:1.2rem;letter-spacing:0.3em">
               <div class="form-note">填入後我們會立即通知業者確認款項</div>
               <div class="form-err" id="lk-err-bank">請填寫 5 位數字</div>
             </div>
             <div class="modal-nav">
               <button class="btn-back" onclick="renderLookupStep('form')">← 重新查詢</button>
               <button class="btn-next" onclick="submitLookupBankCode()">送出末五碼 ✓</button>
             </div>
           </div>`
      }`;
    return;
  }

  // ── 補填末五碼完成 ──  // 付款時間：${od.paidAt} 目前沒有欄位帶入
  if (step === 'done') {
    const od = window._lookupOrder;
    body.innerHTML = `
      <div style="text-align:center;padding:2.5rem 0">
        <div style="width:56px;height:56px;background:rgba(74,124,89,0.12);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.2rem">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <h3 style="font-family:'Shippori Mincho',serif;font-size:1.1rem;color:var(--primary);margin-bottom:0.5rem">末五碼已送出！</h3>
        <p style="font-size:0.82rem;color:var(--mid);line-height:2.2">
          訂單編號：<strong style="color:var(--dark)">${od.orderNo}</strong><br>
          末五碼：<strong style="color:var(--dark);letter-spacing:0.15em">${od.bankCode}</strong><br>
          ${od.paidAt ? `付款時間：${od.paidAt || '—'}<br>` : ''}
          
          確認後我們會以 Email 或 社群帳號 通知出貨時間<br>
          感謝支持食麵包 ♡
        </p>
        
        <button onclick="closeLookup()"
          style="margin-top:1rem;background:var(--primary);color:#fff;border:none;padding:0.75rem 2rem;font-family:'Noto Serif TC',serif;font-size:0.85rem;cursor:pointer;">
          關閉
        </button>
      </div>`;
  }
}

// 查詢訂單：呼叫 Apps Script（跨裝置可用）
function lookupOrder() {
  const orderNo = document.getElementById('lk-order').value.trim().toUpperCase();
  const contact = document.getElementById('lk-contact').value.trim();
  let ok = true;

  if (!orderNo) { showErr('lk-err-order', true, '請填寫訂單編號'); ok = false; }
  else { showErr('lk-err-order', false); }
  if (!contact) { showErr('lk-err-contact', true, '請填寫 Email 或電話'); ok = false; }
  else { showErr('lk-err-contact', false); }
  if (!ok) return;

  // 顯示查詢中狀態
  const btn = document.querySelector('#lookupBody .btn-next');
  if (btn) { btn.disabled = true; btn.textContent = '查詢中...'; }

  // 用 JSONP 呼叫 Apps Script
  const callbackName = 'orderQuery_' + Date.now();
  const script = document.createElement('script');

  window[callbackName] = function(result) {
    delete window[callbackName];
    document.body.removeChild(script);
    if (btn) { btn.disabled = false; btn.textContent = '查詢訂單 →'; }

    if (!result.success) {
      const field = result.error.includes('Email') || result.error.includes('電話')
        ? 'lk-err-contact' : 'lk-err-order';
      showErr(field, true, result.error);
      return;
    }

    window._lookupOrder = result;
    showErr('lk-err-order', false);
    showErr('lk-err-contact', false);
    renderLookupStep('bankcode');
  };

  script.onerror = function() {
    delete window[callbackName];
    document.body.removeChild(script);
    if (btn) { btn.disabled = false; btn.textContent = '查詢訂單 →'; }
    showErr('lk-err-order', true, '查詢失敗，請稍後再試');
  };

  script.src = STOCK_API_URL
    + '?action=query'
    + '&orderNo=' + encodeURIComponent(orderNo)
    + '&contact=' + encodeURIComponent(contact)
    + '&token='   + encodeURIComponent(SECRET_TOKEN)
    + '&callback=' + callbackName;

  document.body.appendChild(script);
  setTimeout(() => {
    if (window[callbackName]) {
      delete window[callbackName];
      try { document.body.removeChild(script); } catch(e) {}
      if (btn) { btn.disabled = false; btn.textContent = '查詢訂單 →'; }
      showErr('lk-err-order', true, '查詢逾時，請稍後再試');
    }
  }, 8000);
}

// 送出查詢頁補填的末五碼
function submitLookupBankCode() {
  const code = document.getElementById('lk-bankcode').value.trim();
  if (!/^\d{5}$/.test(code)) {
    showErr('lk-err-bank', true, '請填寫 5 位數字');
    return;
  }
  showErr('lk-err-bank', false);

  const order = window._lookupOrder;
  order.bankCode = code;
  order.paidAt = new Date().toLocaleString('zh-TW');
  sendBankCodeNotify(order);
  renderLookupStep('done');
}

// ══════════════════════════════════════
//  社群平台切換（單選 radio）
// ══════════════════════════════════════
function selectSocial(labelEl, platform) {
  // 更新 radio-opt selected 樣式
  labelEl.closest('.radio-group').querySelectorAll('.radio-opt').forEach(o => o.classList.remove('selected'));
  labelEl.classList.add('selected');
  labelEl.querySelector('input').checked = true;

  // 展開輸入框並更新 placeholder
  const wrap  = document.getElementById('social-input-wrap');
  const input = document.getElementById('val-social');
  if (wrap)  wrap.style.display = 'flex';
  if (input) {
    const placeholders = { ig: '您的 IG 帳號', thread: '您的 Threads 帳號', line: '您的 LINE ID' };
    input.placeholder = placeholders[platform] || '您的帳號';
    input.focus();
  }
}

// ══════════════════════════════════════
//  取貨方式切換
// ══════════════════════════════════════
function selectShipping(labelEl, value) {
  labelEl.closest('.radio-group').querySelectorAll('.radio-opt').forEach(o => o.classList.remove('selected'));
  labelEl.classList.add('selected');
  labelEl.querySelector('input').checked = true;
  const addrGrp  = document.getElementById('addrGrp');
  const sevenGrp = document.getElementById('sevenGrp');
  if (addrGrp)  addrGrp.style.display  = value === 'local_delivery' ? '' : 'none';
  if (sevenGrp) sevenGrp.style.display = value === 'seven'          ? '' : 'none';
}

// ══════════════════════════════════════
//  表單驗證
// ══════════════════════════════════════
function showErr(id, show, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('show', show);
  if (msg) el.textContent = msg;
}

function validateStep1() {
  const name  = document.getElementById('fn').value.trim();
  const phone = document.getElementById('fp').value.trim().replace(/[-\s]/g, '');
  const email = document.getElementById('fe').value.trim();
  const ship  = document.querySelector('input[name="ship"]:checked')?.value || 'local_delivery';
  const addr  = (document.getElementById('fa')?.value || '').replace(/[\t\r\n]+/g, ' ').trim();
  const seven = (document.getElementById('fss')?.value || '').replace(/[\t\r\n]+/g, ' ').trim();
  const note  = document.getElementById('fno').value.trim();

  // 社群帳號（單選）
  const socialPlatform = document.querySelector('input[name="social"]:checked')?.value || '';
  const socialId       = document.getElementById('val-social')?.value.trim().replace(/^@/, '') || '';

  let ok = true;
  if (!name)                                          { showErr('en',  true, '請填寫姓名');               ok = false; } else { showErr('en',  false); }
  if (!/^09\d{8}$/.test(phone))                      { showErr('ep',  true, '請填寫有效電話');            ok = false; } else { showErr('ep',  false); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))    { showErr('ee',  true, '請填寫有效 Email');          ok = false; } else { showErr('ee',  false); }
  if (ship === 'local_delivery' && !addr)             { showErr('ea',  true, '請填寫新竹收件地址');         ok = false; } else { showErr('ea',  false); }
  if (ship === 'seven' && !seven)                     { showErr('ess', true, '請填寫 7-11 取件店名及地址'); ok = false; } else { showErr('ess', false); }
  showErr('e-social', false);//不必填寫
  //if (!socialPlatform || !socialId)                  { showErr('e-social', true, '請選擇並填寫社群帳號'); ok = false; } else { showErr('e-social', false); }


  if (ok) {
    formData = {
      name, phone, email, ship,
      address:        addr,
      sevenStore:     seven,
      note,
      socialPlatform,
      socialId,
    };

    // 顯示查詢中狀態
    const btn = document.querySelector('#modalBody .btn-next.btn-full');
    if (btn) { btn.disabled = true; btn.textContent = '確認中...'; }

    // 確認庫存後再進入步驟 2
    loadStocks().then(() => {
      let hasIssue = false;
      let messages = [];

      // 逐一檢查購物車商品庫存
      for (let i = cart.length - 1; i >= 0; i--) {
        const item = cart[i];
        const p = PRODUCTS.find(p => p.id === item.id);
        if (!p) continue;
        const stock = p.stock ?? 99;

        if (stock <= 0) {
          // 庫存為 0 → 移除商品，提示重新選擇
          messages.push(`「${item.name}」已售完，已從購物車移除，請重新選擇商品`);
          cart.splice(i, 1);
          hasIssue = true;
        } else if (item.qty > stock) {
          // 庫存不足 → 自動調整到庫存上限
          messages.push(`「${item.name}」庫存僅剩 ${stock} 顆，數量已自動調整`);
          item.qty = stock;
          hasIssue = true;
        }
      }

      if (hasIssue) {
        if (btn) { btn.disabled = false; btn.textContent = '下一步：確認訂單 →'; }
        alert(messages.join('\n'));
        renderProducts();
        renderCart();
        return;
      }

      checkoutStep = 2;
      renderCheckoutStep();
    }).catch(() => {
      if (btn) { btn.disabled = false; btn.textContent = '下一步：確認訂單 →'; }
      checkoutStep = 2;
      renderCheckoutStep();
    });
  }
}

// ══════════════════════════════════════
//  確認訂單 & 通知
// ══════════════════════════════════════

// 步驟 2 確認按鈕：顯示查詢中狀態後呼叫 confirmOrder
function handleConfirmOrder(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '確認中...'; }
  confirmOrder(btn);
}

function confirmOrder(btn) {
  loadStocks().then(() => {
    let hasIssue = false;
    let messages = [];

    for (let i = cart.length - 1; i >= 0; i--) {
      const item = cart[i];
      const p = PRODUCTS.find(p => p.id === item.id);
      if (!p) continue;
      const stock = p.stock ?? 99;

      if (stock <= 0) {
        messages.push(`「${item.name}」已售完，已從購物車移除，請重新選擇商品`);
        cart.splice(i, 1);
        hasIssue = true;
      } else if (item.qty > stock) {
        messages.push(`「${item.name}」庫存僅剩 ${stock} 顆，數量已自動調整`);
        item.qty = stock;
        hasIssue = true;
      }
    }

    if (hasIssue) {
      if (btn) { btn.disabled = false; btn.textContent = '確認並前往匯款 →'; }
      alert(messages.join('\n'));
      renderProducts();
      renderCart();
      checkoutStep = 1;
      renderCheckoutStep();
      return;
    }

    formData.orderNo = 'SB' + Date.now().toString().slice(-8);
    checkoutStep = 3;
    renderCheckoutStep();
    sendOrderCreatedNotify(); // 下單時立即寄確認信（不含末五碼）
  }).catch(() => {
    if (btn) { btn.disabled = false; btn.textContent = '確認並前往匯款 →'; }
  });
}


// 下單通知（寄確認信給客戶，業者僅收到待付款通知）
function sendOrderCreatedNotify() {
  const sub = getSubtotal();
  const sh  = getShippingFee(formData.ship);
  const tot = sub + sh;

  let shipDetail = getShippingLabel(formData.ship);
  if (formData.ship === 'local_delivery') shipDetail += `（${formData.address}）`;
  if (formData.ship === 'seven')          shipDetail += `（${formData.sevenStore}）`;

  const platformLabel = { ig: 'Instagram', thread: 'Threads', line: 'LINE' };
  const socialText = formData.socialPlatform
    ? `${platformLabel[formData.socialPlatform] || formData.socialPlatform}: @${formData.socialId}`
    : '—';

  const payload = {
    type:    'new_order',
    token:   SECRET_TOKEN,
    orderNo: formData.orderNo,
    name:    formData.name,
    phone:   formData.phone,
    email:   formData.email,
    ship:    shipDetail,
    note:    formData.note || '—',
    total:   tot,
    cart:    cart.map(i => `${i.name} x${i.qty} = $${i.price * i.qty}`).join('、'),
    social:  socialText,
  };

  // 存入 localStorage（14天到期），供訂單查詢比對
  const expireAt = Date.now() + ORDER_EXPIRE_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem('shibread_order_' + formData.orderNo, JSON.stringify({ ...payload, expireAt, bankCode: null, paidAt: null }));

  fetch(MAKE_WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  }).catch(err => console.error('下單通知失敗:', err));
}

// 當場送出末五碼
function submitBankCode() {
  const code = document.getElementById('fbc')?.value.trim();
  if (!code || !/^\d{5}$/.test(code)) {
    showErr('ebc', true, '請填寫 5 位數字');
    document.getElementById('fbc')?.classList.add('err');
    return;
  }
  showErr('ebc', false);
  formData.bankCode = code;

  const sub = getSubtotal();
  const sh  = getShippingFee(formData.ship);
  const tot = sub + sh;
  const platformLabel = { ig: 'Instagram', thread: 'Threads', line: 'LINE' };
  const socialText = formData.socialPlatform
    ? `${platformLabel[formData.socialPlatform] || formData.socialPlatform}: @${formData.socialId}`
    : '—';

  sendBankCodeNotify({
    ...formData,
    total:  tot,
    social: socialText,
    cart:   cart.map(i => `${i.name} x${i.qty} = $${i.price * i.qty}`).join('、'),
  });
  // 更新 localStorage 狀態為已付款（保留查詢紀錄）
  const existingOrder = localStorage.getItem('shibread_order_' + formData.orderNo);
  if (existingOrder) {
    const orderData = JSON.parse(existingOrder);
    orderData.bankCode = formData.bankCode;
    orderData.paidAt = new Date().toLocaleString('zh-TW');
    localStorage.setItem('shibread_order_' + formData.orderNo, JSON.stringify(orderData));
  }
  checkoutStep = 4;
  renderCheckoutStep();
}

// 末五碼通知（通知業者客戶已付款）
function sendBankCodeNotify(order) {
  // 取貨方式代碼轉中文
  const shipLabels = {
    local_delivery: '送貨到府（限新竹）',
    pickup:         '自取（竹北東興國小）',
    seven:          '7-11 冷凍店到店',
  };
  let shipDetail = shipLabels[order.ship] || order.ship;
  if (order.ship === 'local_delivery' && order.address) shipDetail += '（' + order.address + '）';
  if (order.ship === 'seven' && order.sevenStore) shipDetail += '（' + order.sevenStore + '）';

  fetch(MAKE_BANKCODE_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      type:     'bankcode_update',
      token:    SECRET_TOKEN,
      orderNo:  order.orderNo,
      name:     order.name,
      phone:    order.phone,
      email:    order.email,
      ship:     shipDetail,
      address:  order.address,
      bankCode: order.bankCode,
      note:     order.note,
      total:    order.total,
      cart:     order.cart,
      social:   order.social || '—',
    })
  }).catch(err => console.error('末五碼通知失敗:', err));
}

// ══════════════════════════════════════
//  複製文字
// ══════════════════════════════════════
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ 已複製';
    setTimeout(() => btn.textContent = '複製', 2000);
  }).catch(() => {});
}