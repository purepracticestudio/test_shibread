// ═══════════════════════════════════════════════════════
//  食麵包 Traveler Bread — Google Apps Script
//  v2.0  2026-06  新增 action=products 動態商品端點
// ═══════════════════════════════════════════════════════

var SPREADSHEET_ID  = '1-1w0nO8FZQfbBoRt8Fqq2t5LD2cY1_zUY1W2Z09q5ug';
var PRODUCT_SHEET_ID = '1-1w0nO8FZQfbBoRt8Fqq2t5LD2cY1_zUY1W2Z09q5ug'; // 預定商品工作表所在的 Spreadsheet
var ORDER_SHEET     = '訂單資料';
var STOCK_SHEET     = '庫存';
var PRODUCT_SHEET   = '預定商品';
var OWNER_EMAILS    = 'lilayanashi@gmail.com, lessarystudio@gmail.com';

// ════════════════════════════
//  GET：路由分派
// ════════════════════════════
function doGet(e) {
  var action   = e.parameter.action   || '';
  var callback = e.parameter.callback || '';

  // ── 商品清單（新增端點）──
  if (action === 'products') {
    var result = getProducts();
    var json   = JSON.stringify(result);
    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 訂單查詢 ──
  if (action === 'query') {
    var orderNo = e.parameter.orderNo || '';
    var contact = e.parameter.contact || '';
    var result  = queryOrder(orderNo, contact);
    var json    = JSON.stringify(result);
    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 預設：即時庫存 ──
  try {
    var sheet  = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(STOCK_SHEET);
    var data   = sheet.getDataRange().getValues();
    var stocks = {};
    for (var i = 1; i < data.length; i++) {
      var pid = String(data[i][0]);
      var rem = Number(data[i][4]);
      if (pid !== '') stocks[pid] = Math.max(0, rem);
    }
    var json = JSON.stringify(stocks);
    if (callback) {
      return ContentService
        .createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ════════════════════════════
//  讀取「預定商品」工作表，回傳商品陣列
//
//  工作表欄位（第 1、2 列為標題列，從第 3 列起是資料）
//  A: 網站預定更新日期  yyyy/MM/dd HH:mm（業者設定的上架時間）
//  B: 預定日期（出貨日，格式 MM/dd，顯示給客戶）
//  C: 開關  上架 / 下架 / 停售
//  D: 商品名稱
//  E: 價格
//  F: 麵糰小標（tag）
//  G: 描述
//  H: 成份
//  I: 標籤 badge（人氣指定款/大人和小孩最愛/New/無）
//  J: 圖片網址
// ════════════════════════════
function getProducts() {
  try {
    var ss    = SpreadsheetApp.openById(PRODUCT_SHEET_ID);
    var sheet = ss.getSheetByName(PRODUCT_SHEET);
    if (!sheet) {
      return { error: '找不到「預定商品」工作表，請確認工作表名稱是否正確' };
    }

    var now  = new Date();
    var data = sheet.getDataRange().getValues();

    // 取得出貨日（B 欄，第一筆非空的資料列）
    // 第 1、2 列為標題列，從第 3 列（i=2）起是資料
    var deliveryDate = '';
    for (var i = 2; i < data.length; i++) {
      var bVal = String(data[i][1] || '').trim();
      if (bVal !== '') {
        // 若是 Date 物件自動轉換
        if (data[i][1] instanceof Date) {
          bVal = Utilities.formatDate(data[i][1], 'Asia/Taipei', 'MM/dd');
        }
        deliveryDate = bVal;
        break;
      }
    }

    var products = [];
    var idCounter = 0;

    for (var i = 2; i < data.length; i++) {
      var row = data[i];

      // 跳過完全空白列
      var dName = String(row[3] || '').trim();
      if (dName === '') continue;

      // ── A 欄：定時上架邏輯 ──
      var scheduleCell = row[0];
      var scheduleDate = null;
      if (scheduleCell instanceof Date) {
        scheduleDate = scheduleCell;
      } else {
        var schedStr = String(scheduleCell || '').trim();
        if (schedStr !== '') {
          // 支援 yyyy/MM/dd HH:mm 或 yyyy-MM-dd HH:mm
          schedStr = schedStr.replace(/-/g, '/');
          var parsed = new Date(schedStr);
          if (!isNaN(parsed.getTime())) scheduleDate = parsed;
        }
      }

      // ── C 欄：開關狀態 ──
      var switchVal = String(row[2] || '').trim();
      var cActive   = (switchVal === '上架');

      // 定時發布判斷：若 A 欄有值且 > 現在 → 強制隱藏
      var isScheduledFuture = (scheduleDate !== null && scheduleDate > now);
      var active = cActive && !isScheduledFuture;

      // ── 組裝商品物件 ──
      var priceRaw = row[4];
      var price    = (priceRaw !== '' && priceRaw !== null) ? Number(priceRaw) : 0;

      var badgeRaw = String(row[8] || '').trim();
      var badge    = null;
      var badgeSvg = false;
      if (badgeRaw === '人氣指定款') {
        badge = '人氣指定款 ★';
      } else if (badgeRaw === '大人和小孩最愛') {
        badge = '大人和小孩最愛 ♡';
      } else if (badgeRaw === 'New') {
        badgeSvg = true;
      }
      // 「無」或空白 → badge = null

      var imageRaw = String(row[9] || '').trim();

      products.push({
        id:          idCounter++,
        active:      active,
        name:        dName,
        tag:         String(row[5] || '').trim(),
        price:       price,
        desc:        String(row[6] || '').trim(),
        ingredients: String(row[7] || '').trim(),
        badge:       badge,
        badgeSvg:    badgeSvg,
        image:       imageRaw,
        stock:       15,     // 預設值，前端會用 loadStocks() 覆蓋
        featured:    false
      });
    }

    return {
      success:      true,
      deliveryDate: deliveryDate,
      products:     products
    };

  } catch(err) {
    return { error: err.message };
  }
}

// ════════════════════════════
//  查詢訂單（跨裝置）
// ════════════════════════════
function queryOrder(orderNo, contact) {
  if (!orderNo || !contact) {
    return { success: false, error: '請填寫訂單編號和聯絡資料' };
  }
  try {
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ORDER_SHEET);
    var data  = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[1]).toUpperCase() !== orderNo.toUpperCase()) continue;

      var sheetPhone = String(row[3]).replace(/^'+/, '').replace(/[-\s]/g,'');
      var emailMatch = contact.toLowerCase() === String(row[4]).toLowerCase();
      var phoneMatch = contact.replace(/[-\s]/g,'') === sheetPhone;

      if (!emailMatch && !phoneMatch) {
        return { success: false, error: 'Email 或電話與訂單不符，請重新確認' };
      }

      return {
        success:  true,
        orderNo:  String(row[1]),
        date:     String(row[0]),
        name:     String(row[2]),
        phone:    String(row[3]).replace(/^'+/, ''),
        email:    String(row[4]),
        social:   String(row[5]),
        ship:     String(row[6]),
        cart:     String(row[7]),
        total:    String(row[8]),
        bankCode: String(row[9]),
        note:     String(row[10]),
      };
    }
    return { success: false, error: '找不到此訂單，請確認訂單編號是否正確' };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ════════════════════════════
//  POST：Make.com 呼叫入口
// ════════════════════════════
function doPost(e) {
  try {
    var raw  = e.postData.contents.replace(/\t/g, ' ').replace(/\r/g, '');
    var body = JSON.parse(raw);
    var type = body.type || '';
    Logger.log('收到 type: ' + type);

    if (type === 'new_order') {
      sendCustomerConfirmEmail(body);
      sendOwnerNewOrderEmail(body);
      recordNewOrder(body);
      Logger.log('新訂單已寄信並寫入 Sheets');
    }

    if (type === 'bankcode_update') {
      sendOwnerPaymentEmail(body);
      updateBankCode(body);
      deductStock(body);
      Logger.log('付款通知已寄出，末五碼已更新，庫存已扣除');
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, type: type }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    Logger.log('錯誤: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ════════════════════════════
//  下單時寫入 Sheets（末五碼欄位留空）
// ════════════════════════════
function recordNewOrder(d) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(ORDER_SHEET);
  var now   = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm') + '';
  var phone = d.phone ? ("'" + d.phone) : '';
  sheet.appendRow([
    now,
    d.orderNo  || '',
    d.name     || '',
    phone,
    d.email    || '',
    d.social   || '',
    d.ship     || '',
    d.cart     || '',
    d.total    || '',
    '',
    d.note     || '',
  ]);
}

// ════════════════════════════
//  補填末五碼後更新 Sheets 該列
// ════════════════════════════
function updateBankCode(d) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ORDER_SHEET);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).toUpperCase() === String(d.orderNo).toUpperCase()) {
      sheet.getRange(i + 1, 10).setValue(d.bankCode || '');
      Logger.log('末五碼已更新：' + d.orderNo);
      return;
    }
  }
  Logger.log('找不到訂單：' + d.orderNo);
}

// ════════════════════════════
//  自動扣庫存（補填末五碼後）
//  從「預定商品」工作表動態讀取商品名稱與庫存ID對應
// ════════════════════════════
function deductStock(body) {
  var stockSheet   = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(STOCK_SHEET);
  var stockData    = stockSheet.getDataRange().getValues();
  var productSheet = SpreadsheetApp.openById(PRODUCT_SHEET_ID).getSheetByName(PRODUCT_SHEET);
  var productData  = productSheet.getDataRange().getValues();
  var cart         = body.cart || '';

  // 動態建立 商品名稱 → stock sheet 中的 id 對應
  var productMap = {};
  var idCounter  = 0;
  for (var i = 1; i < productData.length; i++) {
    var pName = String(productData[i][3] || '').trim();
    if (pName !== '') {
      productMap[pName] = String(idCounter);
      idCounter++;
    }
  }

  var names = Object.keys(productMap);
  for (var n = 0; n < names.length; n++) {
    var name  = names[n];
    var regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' x(\\d+)');
    var match = cart.match(regex);
    if (match) {
      var qty = parseInt(match[1]);
      var pid = productMap[name];
      for (var i = 1; i < stockData.length; i++) {
        if (String(stockData[i][0]) === pid) {
          var currentSold = Number(stockSheet.getRange(i + 1, 4).getValue()) || 0;
          stockSheet.getRange(i + 1, 4).setValue(currentSold + qty);
          break;
        }
      }
    }
  }
}

// ════════════════════════════
//  寄確認信給客戶（下單時）
// ════════════════════════════
function sendCustomerConfirmEmail(d) {
  var subject = '食麵包 訂單確認 — ' + d.orderNo;
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  var html =
    '<div style="font-family:sans-serif;max-width:500px;margin:0 auto;color:#3A2C28">' +
    '<h2 style="color:#725752;border-bottom:2px solid #E3B5A4;padding-bottom:8px">感謝您的訂購！</h2>' +
    '<table style="width:100%;border-collapse:collapse">' +
    row('訂單編號', '<b>' + d.orderNo + '</b>') +
    row('訂單日期', now) +
    row('訂購人',   d.name) +
    row('電話',     d.phone) +
    row('Email',   d.email) +
    row('取貨方式', d.ship) +
    row('商品',     d.cart) +
    row('總金額',   '<b style="color:#725752">$' + d.total + '</b>') +
    '</table>' +
    '<div style="background:#F5EDE3;padding:12px 16px;margin-top:16px;border-left:3px solid #E3B5A4">' +
    '<p style="margin:0;color:#725752">請於 <b>48 小時內</b> 完成匯款</p>' +
    '<ul style="margin:8px 0 0;color:#9B7B72;font-size:13px;padding-left:1.2rem;line-height:2">' +
    '<li style="color:#C45131">匯款資訊：星展銀行（810），帳號3125838019</li>' +
    '<li>匯款後請複製訂單編號，回到食麵包官網補填末五碼，確認後我們會以 Email 或社群帳號通知出貨時間。</li>' +
    '<li>若需要更改或取消訂單，請到食麵包 官方Line @shibread 私訊，謝謝。</li>' +
    '</ul>' +
    '</div>' +
    '<p style="color:#B89891;font-size:12px;margin-top:16px">查詢訂單及填入後五碼，請點選：</p>' +
    '<p style="font-size:12px;margin-top:4px"><a href="https://www.shibread.com/" style="color:#725752">食麵包 Traveler Bread</a></p>' +
    '</div>';
  GmailApp.sendEmail(d.email, subject, '', { htmlBody: html });
}

// ════════════════════════════
//  寄新訂單通知給業者（下單時）
// ════════════════════════════
function sendOwnerNewOrderEmail(d) {
  var subject = '新訂單建立 — ' + d.orderNo + '（尚未付款）';
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  var html =
    '<div style="font-family:sans-serif;max-width:500px;margin:0 auto;color:#3A2C28">' +
    '<h2 style="color:#725752;border-bottom:2px solid #E3B5A4;padding-bottom:8px">新訂單建立（尚未付款）</h2>' +
    '<table style="width:100%;border-collapse:collapse">' +
    row('訂單編號', '<b>' + d.orderNo + '</b>') +
    row('訂單日期', now) +
    row('客戶姓名', d.name) +
    row('電話',     d.phone) +
    row('Email',   d.email) +
    row('社群帳號', d.social || '—') +
    row('取貨方式', d.ship) +
    row('商品',     d.cart) +
    row('總金額',   '<b style="color:#725752">$' + d.total + '</b>') +
    row('備註',     d.note || '—') +
    '</table>' +
    '<p style="color:#9B7B72;margin-top:12px;font-size:13px">等待客戶匯款，補填末五碼後會再收到付款通知。</p>' +
    '</div>';
  GmailApp.sendEmail(OWNER_EMAILS, subject, '', { htmlBody: html });
}

// ════════════════════════════
//  寄付款通知給業者（補填末五碼後）
// ════════════════════════════
function sendOwnerPaymentEmail(d) {
  var subject = '客戶已付款！' + d.orderNo + ' — 請準備出貨';
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm');
  var html =
    '<div style="font-family:sans-serif;max-width:500px;margin:0 auto;color:#3A2C28">' +
    '<h2 style="color:#725752;border-bottom:2px solid #E3B5A4;padding-bottom:8px">客戶已付款，請準備出貨</h2>' +
    '<table style="width:100%;border-collapse:collapse">' +
    row('訂單編號', '<b>' + d.orderNo + '</b>') +
    row('付款日期', now) +
    row('客戶姓名', d.name) +
    row('電話',     d.phone) +
    row('Email',   d.email) +
    row('社群帳號', d.social || '—') +
    row('取貨方式', d.ship) +
    row('商品',     d.cart) +
    row('總金額',   '<b style="color:#725752">$' + d.total + '</b>') +
    row('匯款末五碼', '<b style="color:#C0675A;font-size:18px">' + (d.bankCode || '—') + '</b>') +
    row('備註',     d.note || '—') +
    '</table>' +
    '</div>';
  GmailApp.sendEmail(OWNER_EMAILS, subject, '', { htmlBody: html });
}

// ════════════════════════════
//  表格列輔助函式
// ════════════════════════════
function row(label, value) {
  return '<tr style="border-bottom:1px solid #F5EDE3">' +
    '<td style="padding:8px;color:#9B7B72;width:100px;vertical-align:top">' + label + '</td>' +
    '<td style="padding:8px">' + value + '</td>' +
    '</tr>';
}

// ════════════════════════════
//  換團時重置庫存（手動執行）
// ════════════════════════════
function resetStocks() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(STOCK_SHEET);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] !== '') sheet.getRange(i + 1, 4).setValue(0);
  }
  Logger.log('庫存已重置完畢');
}