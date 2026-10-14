// @ts-nocheck
// ==========================================================
// Webアプリ API（本番: db / テスト: db のコピーのみ）
// ==========================================================

var DB_SHEET_PROD = "db";
var DB_SHEET_TEST = "db のコピー";
var DB_SHEET_TEST_MISSING_ERROR = "参照するdbがありません";
var PROD_CATEGORY_ORDER = ["基本", "介護", "医療", "社会"];
var FLASH_CURSORS_PROP_PROD = "FLASH_CURSORS_prod";
var FLASH_CURSORS_PROP_TEST = "FLASH_CURSORS_test";
var FLASH_CURSORS_SHEET = "cursors"; // 廃止。Properties のみ。シートは削除してよい
var LEARNED_DATE_NUMBER_FORMAT = "yyyy/mm/dd hh:mm";
// 秘密URL生徒ごとの db 進捗列（1-based）。単語マスタは共有、I/J は J 専用のまま。
// writeDailyLogSheet: daily_log シートへ日次集計を書くか（JF は不要）
var PRIVATE_PROGRESS_BY_USER = {
  J: { learnedCol: 9, dateCol: 10, writeDailyLogSheet: true },
  JF: { learnedCol: 11, dateCol: 12, writeDailyLogSheet: false }
};
// 未設定時はスクリプト実行者のメールへ送信。別アドレスへ送る場合は
// スクリプトプロパティ PROD_CHECK_NOTIFY_EMAIL を設定する。
// ※ 単語チェック通知メールは廃止（学習時は送らない）。有料申し込みメールのみ送信。
//
// 申し込みメールが「send_mail の権限がない」になるとき:
// エディタで authorizePaidMail を実行 → 権限を許可 → 必要ならウェブアプリを再デプロイ。

function normalizePrivateUser_(user) {
  var raw = String(user || "J").trim();
  if (!raw) {
    return "J";
  }
  var keys = Object.keys(PRIVATE_PROGRESS_BY_USER);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toUpperCase() === raw.toUpperCase()) {
      return keys[i];
    }
  }
  return "J";
}

function resolvePrivateUser_(e, params) {
  params = params || {};
  var fromParams = params.user;
  if (fromParams == null && e && e.parameter) {
    fromParams = e.parameter.user;
  }
  return normalizePrivateUser_(fromParams);
}

function getPrivateProgressCols_(user) {
  var u = normalizePrivateUser_(user);
  return PRIVATE_PROGRESS_BY_USER[u] || PRIVATE_PROGRESS_BY_USER.J;
}

function shouldWriteDailyLogSheet_(user) {
  return !!getPrivateProgressCols_(user).writeDailyLogSheet;
}

function authorizePaidMail() {
  MailApp.getRemainingDailyQuota();
  processUnmailedPaidOrders();
}

function jsonpOrJson_(payload, callback) {
  var text = JSON.stringify(payload);
  var name = String(callback || "").replace(/[^\w.$]/g, "");
  if (name) {
    return ContentService.createTextOutput(name + "(" + text + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === "placeOrder") {
    return jsonpOrJson_(placePaidOrder_(params, false), params.callback);
  }
  if (params.action === "activateOrder") {
    return paidResultHtml_(activatePaidOrder_(params.token));
  }

  if (isKaigoApp(e)) {
    return handleKaigoGet(e);
  }

  var sheetInfo = resolveDbSheet(e);
  if (sheetInfo.error) {
    return jsonResponse({ error: sheetInfo.error, allWords: [], categories: {}, roadmap: {} });
  }

  var user = resolvePrivateUser_(e, params);
  // テストシートは I/J のみ想定のため進捗列は常に J
  var progressUser = sheetInfo.isTest ? "J" : user;
  var data = loadInitialAppData(sheetInfo.sheet, progressUser);
  data.cursors = loadFlashCursors(sheetInfo.isTest, user);
  data.user = user;
  // 秘密URL（本番）: きょう見た用の語セットも返す（端末依存を解消）
  if (!sheetInfo.isTest) {
    data.dailySeen = loadDailySeenPayload_(user, "");
  }
  return jsonResponse(data);
}

function doPost(e) {
  try {
    var params = parsePostParams(e);
    if (String(params.action || "") === "placeOrder") {
      return jsonResponse(placePaidOrder_(params, true));
    }
    if (String(params.action || "") === "sendOrderMail") {
      return jsonResponse(sendStoredOrderMail_(params.orderId));
    }
    if (String(params.action || "") === "dailyLog") {
      return jsonResponse(upsertDailyLog_(params));
    }
    if (String(params.action || "") === "loadDailySeen") {
      return jsonResponse(loadDailySeenPayload_(params.user, params.date));
    }
    // JF のきょう見た・カーソルだけ消す（J は拒否）
    if (String(params.action || "") === "resetJfSession") {
      return jsonResponse(resetJfSessionOnly_(params));
    }
    if (isKaigoApp(e, params)) {
      return handleKaigoPost(e, params);
    }

    var sheetInfo = resolveDbSheet(e, params);
    if (sheetInfo.error) {
      return jsonResponse({ error: sheetInfo.error });
    }

    var user = resolvePrivateUser_(e, params);
    var progressUser = sheetInfo.isTest ? "J" : user;
    var action = String(params.action || "");
    var checkedWords = params.checkedWords || [];
    var uncheckedWords = params.uncheckedWords || [];
    var hasChecks = checkedWords.length > 0 || uncheckedWords.length > 0;
    var result = { success: true, user: user };

    // セッション完了直後の仮確定（シート未反映・他端末の GET には出ない）
    if (action === "saveTentativeChecks") {
      result = saveFlashTentativeChecks_(
        sheetInfo.isTest,
        progressUser,
        checkedWords,
        uncheckedWords
      );
      result.user = user;
      if (params.cursors) {
        saveFlashCursors(params.cursors, sheetInfo.isTest, user);
      }
      return jsonResponse(result);
    }
    if (action === "clearTentativeChecks") {
      result = clearFlashTentativeChecks_(sheetInfo.isTest, progressUser);
      result.user = user;
      return jsonResponse(result);
    }

    if (hasChecks) {
      result = submitCategoryUpdate(
        checkedWords,
        uncheckedWords,
        sheetInfo.sheet,
        progressUser
      );
      if (result && result.error) {
        return jsonResponse(result);
      }
      result.user = user;
      // 本確定したら仮確定は破棄
      clearFlashTentativeChecks_(sheetInfo.isTest, progressUser);
    }

    if (params.cursors) {
      saveFlashCursors(params.cursors, sheetInfo.isTest, user);
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

function isTestEnv(e, params) {
  params = params || {};
  if (e && e.parameter && e.parameter.env === "test") {
    return true;
  }
  if (params.env === "test") {
    return true;
  }
  return false;
}

function resolveDbSheet(e, params) {
  var isTest = isTestEnv(e, params);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!isTest) {
    var prodSheet = ss.getSheetByName(DB_SHEET_PROD);
    if (!prodSheet) {
      return { error: DB_SHEET_PROD + "シートが見つかりません" };
    }
    return { sheetName: DB_SHEET_PROD, sheet: prodSheet, isTest: false };
  }

  var testSheet = ss.getSheetByName(DB_SHEET_TEST);
  if (!testSheet) {
    return { error: DB_SHEET_TEST_MISSING_ERROR };
  }

  return {
    sheetName: DB_SHEET_TEST,
    sheet: testSheet,
    isTest: true
  };
}

function parsePostParams(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return {};
    }
  }
  return {};
}

function jsonResponse(payload) {
  return jsonpOrJson_(payload, "");
}

function getFlashCursorsPropertyKey(isTest, user) {
  if (isTest) {
    return FLASH_CURSORS_PROP_TEST;
  }
  var u = normalizePrivateUser_(user);
  // J は既存キーを維持（互換）
  if (u === "J") {
    return FLASH_CURSORS_PROP_PROD;
  }
  return "FLASH_CURSORS_prod_" + u;
}

var JF_DAILY_SEEN_RESET_LOCK_KEY = "JF_DAILY_SEEN_RESET_LOCK";

function getJstDateKeyNow_() {
  return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
}

/** JF のきょう見た再同期ロック（その日だけ有効。J は対象外） */
function isJfDailySeenResetLocked_(user, dateKey) {
  if (String(user || "").trim().toUpperCase() !== "JF") {
    return false;
  }
  var lock = PropertiesService.getScriptProperties().getProperty(
    JF_DAILY_SEEN_RESET_LOCK_KEY
  );
  return !!lock && String(lock) === String(dateKey || "");
}

/**
 * JF のきょう見た・カーソルだけ削除する。
 * J のキー（FLASH_CURSORS_prod / DAILY_SEEN_WORDS_J_*）は絶対に触らない。
 * Apps Script エディタから resetJfSessionOnly() を実行するか、
 * POST action=resetJfSession&user=JF で呼ぶ。
 */
function resetJfSessionOnly_(params) {
  var raw = String((params && params.user) || "").trim().toUpperCase();
  if (raw !== "JF") {
    return {
      success: false,
      error: "refused: JF only (got " + (raw || "(empty)") + ")"
    };
  }

  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties() || {};
  var deleted = [];
  var keys = Object.keys(all);
  var i;
  for (i = 0; i < keys.length; i++) {
    var key = keys[i];
    // JF の日次見ただけ。J / test は除外
    if (key.indexOf("DAILY_SEEN_WORDS_JF_") === 0) {
      props.deleteProperty(key);
      deleted.push(key);
    }
  }

  // JF カーソルのみ。FLASH_CURSORS_prod（J）や FLASH_CURSORS_test は触らない
  var jfCursorKey = "FLASH_CURSORS_prod_JF";
  if (all[jfCursorKey] != null || props.getProperty(jfCursorKey) != null) {
    props.deleteProperty(jfCursorKey);
    deleted.push(jfCursorKey);
  }

  // 汚れた端末が dailyLog で書き戻すのを、当日中ブロック
  var todayKey = getJstDateKeyNow_();
  props.setProperty(JF_DAILY_SEEN_RESET_LOCK_KEY, todayKey);
  saveStoredDailyByCat_("JF", todayKey, emptyDailyByCat_(), false);

  return {
    success: true,
    user: "JF",
    deleted: deleted,
    lockDate: todayKey
  };
}

/** エディタ実行用: JF セッションだけリセット（J は触らない） */
function resetJfSessionOnly() {
  var result = resetJfSessionOnly_({ user: "JF" });
  Logger.log(JSON.stringify(result));
  return result;
}

function parseCursorEntry(raw) {
  if (typeof raw === "number" && isFinite(raw)) {
    return { i: Math.floor(raw), t: 0 };
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  var index = raw.i;
  if (typeof index !== "number" || !isFinite(index)) {
    index = raw.index;
  }
  if (typeof index !== "number" || !isFinite(index)) {
    return null;
  }
  var updatedAt = raw.t;
  if (typeof updatedAt !== "number" || !isFinite(updatedAt)) {
    updatedAt = raw.updatedAt;
  }
  if (typeof updatedAt !== "number" || !isFinite(updatedAt)) {
    updatedAt = 0;
  }
  return { i: Math.floor(index), t: updatedAt };
}

function normalizeCursorsMap(raw) {
  var out = {};
  if (!raw || typeof raw !== "object") {
    return out;
  }
  for (var i = 0; i < PROD_CATEGORY_ORDER.length; i++) {
    var cat = PROD_CATEGORY_ORDER[i];
    var entry = parseCursorEntry(raw[cat]);
    if (entry) {
      out[cat] = entry;
    }
  }
  return out;
}

function mergeCursorsByTime(baseMap, incomingMap) {
  var merged = normalizeCursorsMap(baseMap);
  var incoming = normalizeCursorsMap(incomingMap);
  for (var i = 0; i < PROD_CATEGORY_ORDER.length; i++) {
    var cat = PROD_CATEGORY_ORDER[i];
    var next = incoming[cat];
    if (!next) continue;
    var prev = merged[cat];
    if (!prev || next.t >= prev.t) {
      merged[cat] = next;
    }
  }
  return merged;
}

function loadFlashCursors(isTest, user) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(
      getFlashCursorsPropertyKey(isTest, user)
    );
    if (!raw) {
      return {};
    }
    return normalizeCursorsMap(JSON.parse(raw));
  } catch (err) {
    return {};
  }
}

function saveFlashCursors(incoming, isTest, user) {
  var incomingMap = normalizeCursorsMap(incoming);
  if (!Object.keys(incomingMap).length) {
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error("サーバーが混み合っています。再度お試しください。");
  }

  try {
    var merged = mergeCursorsByTime(loadFlashCursors(isTest, user), incomingMap);
    PropertiesService.getScriptProperties().setProperty(
      getFlashCursorsPropertyKey(isTest, user),
      JSON.stringify(merged)
    );
    // cursors シートへの書き出しは廃止（Properties のみ）
  } finally {
    lock.releaseLock();
  }
}

/** GASエディタから実行: 不要になった cursors シートを削除する */
function removeCursorsSheetNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FLASH_CURSORS_SHEET);
  if (!sheet) {
    return { success: true, removed: false, message: "cursors シートはありません" };
  }
  ss.deleteSheet(sheet);
  return { success: true, removed: true, message: "cursors シートを削除しました" };
}

function getInitialAppCacheKey(sheetName, user) {
  return "initial_" + sheetName + "_" + normalizePrivateUser_(user);
}

function invalidateInitialAppCache(sheetName, user) {
  CacheService.getScriptCache().remove(getInitialAppCacheKey(sheetName, user));
}

function loadInitialAppData(sheet, user) {
  var cacheKey = getInitialAppCacheKey(sheet.getName(), user);
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (cacheErr) {}
  }

  var payload = buildInitialAppData(sheet, user);
  try {
    cache.put(cacheKey, JSON.stringify(payload), 180);
  } catch (putErr) {}
  return payload;
}

function buildInitialAppData(sheet, user) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { allWords: [], categories: {}, roadmap: {} };
  }

  var cols = getPrivateProgressCols_(user);
  var lastCol = Math.max(10, cols.dateCol);
  var data = sheet.getRange(2, 1, lastRow, lastCol).getValues();
  var learnedIdx = cols.learnedCol - 1;
  var dateIdx = cols.dateCol - 1;
  var allWords = [];
  var learnedDates = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var word = String(row[1] || "").trim();
    var cat = String(row[3] || "").trim();
    var ruby = String(row[4] || "").trim();
    var eng = String(row[5] || "").trim();
    var meaning = String(row[6] || "").trim();
    var example = String(row[7] || "").trim();
    var learnedCell = row[learnedIdx];
    var isLearned = learnedCell === true || String(learnedCell).toUpperCase() === "TRUE";
    var learnedDate = row[dateIdx];
    var learnedDateStr = "";

    if (!word) continue;

    if (isLearned && learnedDate) {
      try {
        learnedDateStr = Utilities.formatDate(new Date(learnedDate), "Asia/Tokyo", "yyyy-MM-dd");
        if (learnedDates.indexOf(learnedDateStr) === -1) {
          learnedDates.push(learnedDateStr);
        }
      } catch (dateErr) {}
    }

    allWords.push({
      w: word,
      c: cat,
      r: ruby,
      e: eng,
      m: meaning,
      x: example,
      l: isLearned,
      d: learnedDateStr
    });
  }

  var roadmapPayload = buildRoadmapPayload(learnedDates, allWords);

  return {
    allWords: allWords,
    roadmap: roadmapPayload
  };
}

/** 仮確定 Properties キー（シートには書かない。GET の allWords にも載せない） */
function getFlashTentativePropKey_(isTest, user) {
  var env = isTest ? "test" : "prod";
  return "FLASH_TENTATIVE_" + env + "_" + normalizePrivateUser_(user);
}

function saveFlashTentativeChecks_(isTest, user, checkedWords, uncheckedWords) {
  var payload = {
    checkedWords: normalizeWordList_(checkedWords),
    uncheckedWords: normalizeWordList_(uncheckedWords),
    t: Date.now()
  };
  PropertiesService.getScriptProperties().setProperty(
    getFlashTentativePropKey_(isTest, user),
    JSON.stringify(payload)
  );
  return { success: true, tentative: true };
}

function clearFlashTentativeChecks_(isTest, user) {
  PropertiesService.getScriptProperties().deleteProperty(
    getFlashTentativePropKey_(isTest, user)
  );
  return { success: true, cleared: true };
}

function submitCategoryUpdate(checkedWords, uncheckedWords, sheet, user) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { error: "サーバーが混み合っています。再度お試しください。" };
  }

  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: true };
    }

    var cols = getPrivateProgressCols_(user);
    var wordValues = sheet.getRange(2, 2, lastRow, 2).getValues();
    var learnedRange = sheet.getRange(2, cols.learnedCol, lastRow, cols.learnedCol);
    var dateRange = sheet.getRange(2, cols.dateCol, lastRow, cols.dateCol);
    var learnedValues = learnedRange.getValues();
    var dateValues = dateRange.getValues();
    var today = new Date();
    var isModified = false;

    var checkedSet = toWordSet(checkedWords);
    var uncheckedSet = toWordSet(uncheckedWords);

    for (var i = 0; i < wordValues.length; i++) {
      var word = String(wordValues[i][0] || "").trim();
      if (!word) continue;

      if (checkedSet[word]) {
        learnedValues[i][0] = true;
        dateValues[i][0] = today;
        isModified = true;
      } else if (uncheckedSet[word]) {
        learnedValues[i][0] = false;
        dateValues[i][0] = "";
        isModified = true;
      }
    }

    if (isModified) {
      learnedRange.setValues(learnedValues);
      dateRange.setValues(dateValues);
      formatLearnedDateColumn_(sheet, user);
      invalidateInitialAppCache(sheet.getName(), user);
    }

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function formatLearnedDateColumn_(sheet, user) {
  if (!sheet) {
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  var cols = getPrivateProgressCols_(user);
  sheet
    .getRange(2, cols.dateCol, lastRow, cols.dateCol)
    .setNumberFormat(LEARNED_DATE_NUMBER_FORMAT);
}

/** GASエディタから実行: db / db のコピー の学習日列を日時表示にする（アプリの値は変えない） */
function formatLearnedDateColumnNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var users = Object.keys(PRIVATE_PROGRESS_BY_USER);
  var prod = ss.getSheetByName(DB_SHEET_PROD);
  var test = ss.getSheetByName(DB_SHEET_TEST);
  for (var i = 0; i < users.length; i++) {
    if (prod) {
      formatLearnedDateColumn_(prod, users[i]);
    }
  }
  // テストシートは J 列のみ
  if (test) {
    formatLearnedDateColumn_(test, "J");
  }
}

function toWordSet(words) {
  var set = {};
  for (var i = 0; i < words.length; i++) {
    var word = String(words[i] || "").trim();
    if (word) {
      set[word] = true;
    }
  }
  return set;
}

function getProdCheckNotifyEmail() {
  var fromProps = PropertiesService.getScriptProperties().getProperty("PROD_CHECK_NOTIFY_EMAIL");
  if (fromProps) {
    return String(fromProps).trim();
  }
  try {
    return Session.getEffectiveUser().getEmail() || "";
  } catch (err) {
    return "";
  }
}

function buildCategoryLearnedCounts(dbValues) {
  var counts = { "基本": 0, "介護": 0, "医療": 0, "社会": 0 };

  for (var i = 0; i < dbValues.length; i++) {
    var word = String(dbValues[i][0] || "").trim();
    if (!word) continue;

    var cat = String(dbValues[i][2] || "").trim();
    var isLearned = (dbValues[i][7] === true || String(dbValues[i][7]).toUpperCase() === "TRUE");
    if (isLearned && counts.hasOwnProperty(cat)) {
      counts[cat]++;
    }
  }

  return counts;
}

function formatCategoryCountLines(counts) {
  var lines = [];
  for (var i = 0; i < PROD_CATEGORY_ORDER.length; i++) {
    var cat = PROD_CATEGORY_ORDER[i];
    lines.push(cat + "：" + (counts[cat] || 0));
  }
  return lines.join("\n");
}

function sendProdCheckNotifyEmail(dbValues) {
  /* 廃止: 学習チェック時の Gmail 通知は送らない */
  return;
}

var DAILY_LOG_SHEET = "daily_log";
var DAILY_LOG_CATS = ["基本", "介護", "医療", "社会"];
// 見た数のみ。列順: 日付 / 合計 / 基本 / 介護 / 医療 / 社会
var DAILY_LOG_HEADERS = ["日付", "合計", "基本", "介護", "医療", "社会"];

function ensureDailyLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DAILY_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_LOG_SHEET);
  }
  var width = Math.max(sheet.getLastColumn(), DAILY_LOG_HEADERS.length);
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  var needHeader = false;
  for (var i = 0; i < DAILY_LOG_HEADERS.length; i++) {
    if (String(header[i] || "").trim() !== DAILY_LOG_HEADERS[i]) {
      needHeader = true;
      break;
    }
  }
  if (needHeader) {
    // ヘッダー変更時は見た数だけ残して作り直す（旧「知ってる_*」列は捨てる）
    var oldRows = [];
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var oldHeader = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
      var oldData = sheet.getRange(2, 1, lastRow, Math.max(sheet.getLastColumn(), 1)).getValues();
      oldRows = migrateDailyLogRowsToSeenOnly_(oldHeader, oldData);
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, DAILY_LOG_HEADERS.length).setValues([DAILY_LOG_HEADERS]);
    if (oldRows.length) {
      sheet.getRange(2, 1, oldRows.length + 1, DAILY_LOG_HEADERS.length).setValues(oldRows);
    }
    sheet.setFrozenRows(1);
    sheet.getRange("A:A").setNumberFormat("@");
  }
  return sheet;
}

/** 旧 daily_log 行を 日付/合計/基本/介護/医療/社会 に寄せる */
function migrateDailyLogRowsToSeenOnly_(oldHeader, oldData) {
  function colIndex(names) {
    var i;
    var j;
    for (i = 0; i < names.length; i++) {
      for (j = 0; j < oldHeader.length; j++) {
        if (String(oldHeader[j] || "").trim() === names[i]) {
          return j;
        }
      }
    }
    return -1;
  }
  var dateIdx = colIndex(["日付", "date"]);
  var totalIdx = colIndex(["合計", "見た_合計"]);
  var kihonIdx = colIndex(["基本", "見た_基本"]);
  var kaigoIdx = colIndex(["介護", "見た_介護"]);
  var iryoIdx = colIndex(["医療", "見た_医療"]);
  var shakaiIdx = colIndex(["社会", "見た_社会"]);
  var rows = [];
  for (var r = 0; r < oldData.length; r++) {
    var row = oldData[r];
    var dateKey = dateIdx >= 0 ? dailyLogDateKey_(row[dateIdx]) : "";
    if (!dateKey) {
      continue;
    }
    var kihon = kihonIdx >= 0 ? Number(row[kihonIdx]) || 0 : 0;
    var kaigo = kaigoIdx >= 0 ? Number(row[kaigoIdx]) || 0 : 0;
    var iryo = iryoIdx >= 0 ? Number(row[iryoIdx]) || 0 : 0;
    var shakai = shakaiIdx >= 0 ? Number(row[shakaiIdx]) || 0 : 0;
    var total =
      totalIdx >= 0 ? Number(row[totalIdx]) || 0 : kihon + kaigo + iryo + shakai;
    rows.push([dateKey, total, kihon, kaigo, iryo, shakai]);
  }
  return rows;
}

function normalizeDailyWordList_(raw) {
  var out = [];
  var seen = {};
  var list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    list = Object.keys(raw);
  } else {
    var text = String(raw || "").trim();
    if (!text) {
      return out;
    }
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed && typeof parsed === "object") {
        list = Object.keys(parsed);
      } else {
        list = text.split(/[\n,]+/);
      }
    } catch (err) {
      list = text.split(/[\n,]+/);
    }
  }
  for (var i = 0; i < list.length; i++) {
    var word = String(list[i] || "").trim();
    if (!word || seen[word]) continue;
    seen[word] = true;
    out.push(word);
  }
  return out;
}

function mergeDailyWordLists_(a, b) {
  return normalizeDailyWordList_([].concat(a || [], b || []));
}

function dailyLogDateKey_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd");
  }
  return String(value || "").trim().slice(0, 10);
}

function getDailySeenWordsPropKey_(user, dateKey) {
  return "DAILY_SEEN_WORDS_" + String(user || "J") + "_" + dateKey;
}

function emptyDailyByCat_() {
  var byCat = {};
  for (var i = 0; i < DAILY_LOG_CATS.length; i++) {
    byCat[DAILY_LOG_CATS[i]] = { knownWords: [], unknownWords: [] };
  }
  return byCat;
}

function normalizeDailyByCat_(raw) {
  var byCat = emptyDailyByCat_();
  if (!raw || typeof raw !== "object") {
    return byCat;
  }
  for (var i = 0; i < DAILY_LOG_CATS.length; i++) {
    var cat = DAILY_LOG_CATS[i];
    var entry = raw[cat] || {};
    byCat[cat] = {
      knownWords: normalizeDailyWordList_(entry.knownWords || entry.known || []),
      unknownWords: normalizeDailyWordList_(entry.unknownWords || entry.unknown || [])
    };
  }
  return byCat;
}

function mergeDailyByCat_(base, incoming) {
  var merged = emptyDailyByCat_();
  base = normalizeDailyByCat_(base);
  incoming = normalizeDailyByCat_(incoming);
  for (var i = 0; i < DAILY_LOG_CATS.length; i++) {
    var cat = DAILY_LOG_CATS[i];
    merged[cat] = {
      knownWords: mergeDailyWordLists_(base[cat].knownWords, incoming[cat].knownWords),
      unknownWords: mergeDailyWordLists_(base[cat].unknownWords, incoming[cat].unknownWords)
    };
  }
  return merged;
}

function flattenDailyByCat_(byCat) {
  byCat = normalizeDailyByCat_(byCat);
  var knownWords = [];
  var unknownWords = [];
  for (var i = 0; i < DAILY_LOG_CATS.length; i++) {
    var cat = DAILY_LOG_CATS[i];
    knownWords = knownWords.concat(byCat[cat].knownWords);
    unknownWords = unknownWords.concat(byCat[cat].unknownWords);
  }
  knownWords = normalizeDailyWordList_(knownWords);
  var knownSet = {};
  for (var k = 0; k < knownWords.length; k++) {
    knownSet[knownWords[k]] = true;
  }
  var unknownOnly = [];
  for (var u = 0; u < unknownWords.length; u++) {
    if (knownSet[unknownWords[u]]) continue;
    unknownOnly.push(unknownWords[u]);
  }
  return { knownWords: knownWords, unknownWords: unknownOnly };
}

function countsFromDailyByCat_(byCat) {
  byCat = normalizeDailyByCat_(byCat);
  var counts = {};
  var seenTotal = 0;
  var knownTotal = 0;
  for (var i = 0; i < DAILY_LOG_CATS.length; i++) {
    var cat = DAILY_LOG_CATS[i];
    var knownWords = byCat[cat].knownWords;
    var knownSet = {};
    for (var k = 0; k < knownWords.length; k++) {
      knownSet[knownWords[k]] = true;
    }
    var unknownOnly = 0;
    for (var u = 0; u < byCat[cat].unknownWords.length; u++) {
      if (knownSet[byCat[cat].unknownWords[u]]) continue;
      unknownOnly++;
    }
    var known = knownWords.length;
    var seen = known + unknownOnly;
    counts[cat] = { seen: seen, known: known };
    seenTotal += seen;
    knownTotal += known;
  }
  counts.total = { seen: seenTotal, known: knownTotal };
  return counts;
}

function isDailyByCatEmpty_(byCat) {
  byCat = normalizeDailyByCat_(byCat);
  for (var i = 0; i < DAILY_LOG_CATS.length; i++) {
    var cat = DAILY_LOG_CATS[i];
    if (byCat[cat].knownWords.length || byCat[cat].unknownWords.length) {
      return false;
    }
  }
  return true;
}

function loadStoredDailyByCat_(user, dateKey) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(
      getDailySeenWordsPropKey_(user, dateKey)
    );
    if (!raw) {
      return emptyDailyByCat_();
    }
    var parsed = JSON.parse(raw);
    if (parsed && parsed.byCat) {
      return normalizeDailyByCat_(parsed.byCat);
    }
    // 旧形式: flat lists のみ → カテゴリ不明なので「基本」に仮置き（合計を消さない）
    if (parsed && (parsed.knownWords || parsed.unknownWords)) {
      var byCat = emptyDailyByCat_();
      byCat["基本"] = {
        knownWords: normalizeDailyWordList_(parsed.knownWords),
        unknownWords: normalizeDailyWordList_(parsed.unknownWords)
      };
      return byCat;
    }
    return emptyDailyByCat_();
  } catch (err) {
    return emptyDailyByCat_();
  }
}

function saveStoredDailyByCat_(user, dateKey, byCat, star) {
  var flat = flattenDailyByCat_(byCat);
  PropertiesService.getScriptProperties().setProperty(
    getDailySeenWordsPropKey_(user, dateKey),
    JSON.stringify({
      date: dateKey,
      user: user,
      byCat: normalizeDailyByCat_(byCat),
      knownWords: flat.knownWords,
      unknownWords: flat.unknownWords,
      star: !!star
    })
  );
}

function findDailyLogRowIndex_(sheet, dateKey) {
  var last = sheet.getLastRow();
  if (last < 2) {
    return null;
  }
  var values = sheet.getRange(2, 1, last, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (dailyLogDateKey_(values[i][0]) === dateKey) {
      return i + 2;
    }
  }
  return null;
}

function writeDailyLogSummaryRow_(dateKey, counts) {
  var sheet = ensureDailyLogSheet_();
  var seen = Number(counts && counts.total && counts.total.seen) || 0;
  var row = findDailyLogRowIndex_(sheet, dateKey);

  // 空同期で 0 行を増やしたり、既存の非ゼロを 0 で潰さない
  if (seen <= 0) {
    if (!row) {
      return;
    }
    var prevTotal = Number(sheet.getRange(row, 2).getValue()) || 0;
    if (prevTotal > 0) {
      return;
    }
  }

  var rowValues = [
    dateKey,
    seen,
    counts["基本"].seen,
    counts["介護"].seen,
    counts["医療"].seen,
    counts["社会"].seen
  ];
  if (row) {
    sheet.getRange(row, 1, row, DAILY_LOG_HEADERS.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }
}

function buildDailySeenPayloadFromByCat_(dateKey, user, byCat, star) {
  byCat = normalizeDailyByCat_(byCat);
  var flat = flattenDailyByCat_(byCat);
  var counts = countsFromDailyByCat_(byCat);
  return {
    success: true,
    date: dateKey,
    user: user,
    knownWords: flat.knownWords,
    unknownWords: flat.unknownWords,
    known: counts.total.known,
    unknown: flat.unknownWords.length,
    seen: counts.total.seen,
    star: !!star || counts.total.known > 0 || flat.unknownWords.length >= 20,
    byCategory: counts
  };
}

function loadDailySeenPayload_(user, dateKey) {
  user = String(user || "J").trim() || "J";
  dateKey = String(dateKey || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    dateKey = getJstDateKeyNow_();
  }
  if (isJfDailySeenResetLocked_(user, dateKey)) {
    var clearedPayload = buildDailySeenPayloadFromByCat_(
      dateKey,
      "JF",
      emptyDailyByCat_(),
      false
    );
    clearedPayload.cleared = true;
    return clearedPayload;
  }
  var byCat = loadStoredDailyByCat_(user, dateKey);
  var star = false;
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(
      getDailySeenWordsPropKey_(user, dateKey)
    );
    if (raw) {
      var stored = JSON.parse(raw);
      star = !!(stored && stored.star === true);
    }
  } catch (err) {}
  return buildDailySeenPayloadFromByCat_(dateKey, user, byCat, star);
}

/** 見る用ログはカテゴリ別の見た/知ってるのみ。語セットは Properties に保持（dbは変更しない）。 */
function upsertDailyLog_(params) {
  params = params || {};
  var dateKey = String(params.date || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    dateKey = getJstDateKeyNow_();
  }
  var user = String(params.user || "J").trim() || "J";

  // JF リセット当日は端末からの書き戻しを拒否（J は対象外）
  if (isJfDailySeenResetLocked_(user, dateKey)) {
    saveStoredDailyByCat_("JF", dateKey, emptyDailyByCat_(), false);
    var lockedPayload = buildDailySeenPayloadFromByCat_(
      dateKey,
      "JF",
      emptyDailyByCat_(),
      false
    );
    lockedPayload.cleared = true;
    return lockedPayload;
  }

  var incomingByCat = normalizeDailyByCat_(params.byCategory || params.byCat || {});

  // 旧クライアント互換: byCategory が空で flat lists だけ来た場合は「基本」に仮置き
  if (isDailyByCatEmpty_(incomingByCat)) {
    var flatKnown = normalizeDailyWordList_(params.knownWords);
    var flatUnknown = normalizeDailyWordList_(params.unknownWords);
    if (flatKnown.length || flatUnknown.length) {
      incomingByCat["基本"] = {
        knownWords: flatKnown,
        unknownWords: flatUnknown
      };
    }
  }

  var existingByCat = loadStoredDailyByCat_(user, dateKey);
  var incomingEmpty = isDailyByCatEmpty_(incomingByCat);
  // 空の書き込みで既存 Properties を消さない
  var mergedByCat = incomingEmpty
    ? existingByCat
    : mergeDailyByCat_(existingByCat, incomingByCat);

  var star =
    params.star === true ||
    String(params.star || "").toUpperCase() === "TRUE" ||
    String(params.star || "") === "1";
  try {
    var prevRaw = PropertiesService.getScriptProperties().getProperty(
      getDailySeenWordsPropKey_(user, dateKey)
    );
    if (prevRaw) {
      var prev = JSON.parse(prevRaw);
      if (prev && prev.star === true) {
        star = true;
      }
    }
  } catch (err) {}

  var payload = buildDailySeenPayloadFromByCat_(dateKey, user, mergedByCat, star);
  if (!incomingEmpty || !isDailyByCatEmpty_(mergedByCat)) {
    saveStoredDailyByCat_(user, dateKey, mergedByCat, payload.star);
  }
  // J のみ daily_log シートへ集計。JF などは Properties のみ。
  if (shouldWriteDailyLogSheet_(user)) {
    writeDailyLogSummaryRow_(dateKey, payload.byCategory);
  }
  return payload;
}

function countStreakEndingAt(learnedDates, endDate) {
  var streak = 0;
  var checkDate = new Date(endDate);

  while (true) {
    var dKey = Utilities.formatDate(checkDate, "Asia/Tokyo", "yyyy-MM-dd");
    if (learnedDates.indexOf(dKey) !== -1) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function buildRoadmapPayload(learnedDates, allWords) {
  var totalLearned = 0;
  for (var i = 0; i < allWords.length; i++) {
    var learned = allWords[i].l === true || allWords[i].isLearned === true;
    if (learned) {
      totalLearned++;
    }
  }
  var todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  var yesterdayStreak = countStreakEndingAt(learnedDates, yesterday);
  var streak = learnedDates.indexOf(todayStr) !== -1 ? yesterdayStreak + 1 : yesterdayStreak;

  return {
    streakText: "⭐️ " + (streak > 0 ? streak : 0) + "日 連続達成中！",
    totalLearned: totalLearned,
    learnedDates: learnedDates,
    todayStr: todayStr
  };
}

// ==========================================================
// 公開版（/kaigo/words/）: マスタは db 参照、進捗は progress シート
// J 本番（ルート）の db 学習列は変更しない
// スクリプトプロパティ GOOGLE_CLIENT_ID に OAuth クライアント ID を設定
// 課金（既定はオフ。公開後に課金するときだけ PAID_PAYWALL=on）:
//   PAID_PAYWALL=on / BANK_TRANSFER_INFO / PAID_OWNER_EMAILS / PROD_CHECK_NOTIFY_EMAIL
// ==========================================================

var KAIGO_PROGRESS_SHEET = "progress";
var KAIGO_WORDS_CACHE_KEY = "initial_kaigo_words_v1";

function isKaigoApp(e, params) {
  params = params || {};
  if (e && e.parameter && e.parameter.app === "kaigo") {
    return true;
  }
  if (params.app === "kaigo") {
    return true;
  }
  return false;
}

function handleKaigoGet(e) {
  var wordsSheet = resolveKaigoWordsSheet();
  if (wordsSheet.error) {
    return jsonResponse({
      error: wordsSheet.error,
      allWords: [],
      categories: {},
      roadmap: {},
      auth: { requiredForSave: true }
    });
  }

  var base = loadKaigoWordsBase(wordsSheet.sheet);
  var idToken = extractIdToken(e, null);
  var authInfo = null;

  if (idToken) {
    authInfo = verifyGoogleIdToken(idToken);
    if (authInfo.error) {
      return jsonResponse({
        error: authInfo.error,
        allWords: base.allWords,
        roadmap: buildRoadmapPayload([], base.allWords),
        cursors: {},
        auth: { requiredForSave: true, loggedIn: false, paid: false }
      });
    }
    applyKaigoProgressToWords(base.allWords, authInfo.userId);
    var learnedDates = collectLearnedDatesFromWords(base.allWords);
    base.roadmap = buildRoadmapPayload(learnedDates, base.allWords);
    base.cursors = loadKaigoFlashCursors(authInfo.userId);
    base.auth = {
      requiredForSave: true,
      loggedIn: true,
      paid: isPaidEmail_(authInfo.email),
      userId: authInfo.userId,
      email: authInfo.email || ""
    };
    return jsonResponse(base);
  }

  // ゲスト: 学習フラグなし
  clearLearnedFlags(base.allWords);
  base.roadmap = buildRoadmapPayload([], base.allWords);
  base.cursors = {};
  base.auth = { requiredForSave: true, loggedIn: false, paid: false };
  return jsonResponse(base);
}

function handleKaigoPost(e, params) {
  var idToken = extractIdToken(e, params);
  if (!idToken) {
    return jsonResponse({ error: "ログインが必要です", needAuth: true });
  }

  var authInfo = verifyGoogleIdToken(idToken);
  if (authInfo.error) {
    return jsonResponse({ error: authInfo.error, needAuth: true });
  }

  var action = String(params.action || "").trim();

  if (action === "load") {
    return jsonResponse(buildKaigoUserPayload_(authInfo));
  }

  if (!isPaidEmail_(authInfo.email)) {
    return jsonResponse({
      error: "保存にはお支払いが必要です",
      needPaid: true,
      auth: {
        requiredForSave: true,
        loggedIn: true,
        paid: false,
        userId: authInfo.userId,
        email: authInfo.email || ""
      }
    });
  }

  var checkedWords = normalizeWordList_(params.checkedWords);
  var uncheckedWords = normalizeWordList_(params.uncheckedWords);
  var hasChecks = checkedWords.length > 0 || uncheckedWords.length > 0;
  var updateResult = null;

  if (hasChecks || action === "saveProgress") {
    updateResult = submitKaigoProgressUpdate(authInfo.userId, checkedWords, uncheckedWords);
    if (updateResult && updateResult.error) {
      return jsonResponse(updateResult);
    }
  }

  if (params.cursors) {
    saveKaigoFlashCursors(authInfo.userId, params.cursors);
  }

  var payload = buildKaigoUserPayload_(authInfo);
  payload.success = true;
  payload.savedChecks = checkedWords.length;
  payload.savedUnchecks = uncheckedWords.length;
  payload.progressCount = countLearnedInProgressMap_(loadKaigoProgressMap(authInfo.userId));
  if (updateResult) {
    payload.sheetSynced = updateResult.sheetSynced === true;
    payload.sheetRows = updateResult.sheetRows || 0;
    payload.sheetError = updateResult.sheetError || "";
  }
  return jsonResponse(payload);
}

function normalizeWordList_(words) {
  if (!words) return [];
  if (Object.prototype.toString.call(words) !== "[object Array]") {
    words = [words];
  }
  var out = [];
  for (var i = 0; i < words.length; i++) {
    var w = String(words[i] || "").trim();
    if (w) out.push(w);
  }
  return out;
}

function buildKaigoUserPayload_(authInfo) {
  var wordsSheet = resolveKaigoWordsSheet();
  if (wordsSheet.error) {
    return {
      error: wordsSheet.error,
      allWords: [],
      roadmap: {},
      cursors: {},
      auth: {
        requiredForSave: true,
        loggedIn: true,
        paid: isPaidEmail_(authInfo.email),
        userId: authInfo.userId,
        email: authInfo.email || ""
      }
    };
  }
  var base = loadKaigoWordsBase(wordsSheet.sheet);
  var progressMap = loadKaigoProgressMap(authInfo.userId);
  applyKaigoProgressToWords(base.allWords, authInfo.userId);
  // Properties にある進捗をシートへも反映（可視化の遅れを回収）
  var sheetSync = syncKaigoProgressSheetBestEffort_(authInfo.userId, progressMap);
  var learnedDates = collectLearnedDatesFromWords(base.allWords);
  base.roadmap = buildRoadmapPayload(learnedDates, base.allWords);
  base.cursors = loadKaigoFlashCursors(authInfo.userId);
  base.auth = {
    requiredForSave: true,
    loggedIn: true,
    paid: isPaidEmail_(authInfo.email),
    userId: authInfo.userId,
    email: authInfo.email || ""
  };
  base.sheetSynced = sheetSync.ok === true;
  base.sheetRows = sheetSync.rows || 0;
  base.sheetError = sheetSync.error || "";
  return base;
}

function countLearnedInProgressMap_(map) {
  var n = 0;
  for (var word in map) {
    if (map.hasOwnProperty(word) && map[word] && map[word].learned) n++;
  }
  return n;
}

function getKaigoSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("KAIGO_SPREADSHEET_ID");
  if (id) {
    return SpreadsheetApp.openById(String(id).trim());
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    // 次回以降のため ID を記憶
    try {
      props.setProperty("KAIGO_SPREADSHEET_ID", active.getId());
    } catch (err) {}
    return active;
  }
  throw new Error("スプレッドシートを開けません");
}

function resolveKaigoWordsSheet() {
  try {
    var ss = getKaigoSpreadsheet_();
    var sheet = ss.getSheetByName(DB_SHEET_PROD);
    if (!sheet) {
      return { error: DB_SHEET_PROD + "シートが見つかりません" };
    }
    return { sheet: sheet };
  } catch (err) {
    return { error: String(err) };
  }
}

function ensureKaigoProgressSheet() {
  var ss = getKaigoSpreadsheet_();
  var sheet = ss.getSheetByName(KAIGO_PROGRESS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(KAIGO_PROGRESS_SHEET);
  }
  var header = sheet.getRange(1, 1, 1, 4).getValues()[0];
  if (String(header[0] || "").trim() !== "user_id") {
    sheet.getRange(1, 1, 1, 4).setValues([["user_id", "word", "learned", "date"]]);
  }
  // user_id を文字列として扱う（長い Google の sub が数値化されるのを防ぐ）
  sheet.getRange("A:A").setNumberFormat("@");
  return sheet;
}

function extractIdToken(e, params) {
  params = params || {};
  if (params.idToken) {
    return String(params.idToken).trim();
  }
  if (e && e.parameter && e.parameter.idToken) {
    return String(e.parameter.idToken).trim();
  }
  if (e && e.parameter && e.parameter.id_token) {
    return String(e.parameter.id_token).trim();
  }
  return "";
}

function getGoogleClientId() {
  var id = PropertiesService.getScriptProperties().getProperty("GOOGLE_CLIENT_ID");
  return id ? String(id).trim() : "";
}

function verifyGoogleIdToken(idToken) {
  var clientId = getGoogleClientId();
  if (!clientId) {
    return { error: "サーバーに GOOGLE_CLIENT_ID が設定されていません" };
  }
  if (!idToken) {
    return { error: "idToken がありません" };
  }

  try {
    var url =
      "https://oauth2.googleapis.com/tokeninfo?id_token=" +
      encodeURIComponent(idToken);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { error: "ログインの検証に失敗しました" };
    }
    var data = JSON.parse(res.getContentText());
    if (String(data.aud || "") !== clientId) {
      return { error: "クライアントIDが一致しません" };
    }
    if (!data.sub) {
      return { error: "ユーザーIDを取得できません" };
    }
    return {
      userId: String(data.sub),
      email: String(data.email || "")
    };
  } catch (err) {
    return { error: "ログイン検証エラー: " + err };
  }
}

function loadKaigoWordsBase(sheet) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(KAIGO_WORDS_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (cacheErr) {}
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { allWords: [], categories: {}, roadmap: {} };
  }

  var data = sheet.getRange(2, 1, lastRow, 10).getValues();
  var allWords = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var word = String(row[1] || "").trim();
    if (!word) continue;
    allWords.push({
      w: word,
      c: String(row[3] || "").trim(),
      r: String(row[4] || "").trim(),
      e: String(row[5] || "").trim(),
      m: String(row[6] || "").trim(),
      x: String(row[7] || "").trim(),
      l: false,
      d: ""
    });
  }

  var payload = { allWords: allWords, categories: {} };
  try {
    cache.put(KAIGO_WORDS_CACHE_KEY, JSON.stringify(payload), 180);
  } catch (putErr) {}
  return payload;
}

function clearLearnedFlags(allWords) {
  for (var i = 0; i < allWords.length; i++) {
    allWords[i].l = false;
    allWords[i].d = "";
  }
}

function collectLearnedDatesFromWords(allWords) {
  var learnedDates = [];
  for (var i = 0; i < allWords.length; i++) {
    var d = allWords[i].d;
    if (allWords[i].l && d && learnedDates.indexOf(d) === -1) {
      learnedDates.push(d);
    }
  }
  return learnedDates;
}

function getKaigoProgressPropKey_(userId) {
  return "KAIGO_PROG_V1_" + userId;
}

function loadKaigoProgressMapFromProps_(userId) {
  var map = {};
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(getKaigoProgressPropKey_(userId));
    if (!raw) return map;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return map;
    for (var word in parsed) {
      if (!parsed.hasOwnProperty(word)) continue;
      var entry = parsed[word];
      if (!entry) continue;
      var learned = entry === true || entry.learned === true || String(entry.learned).toUpperCase() === "TRUE";
      var dateStr = "";
      if (typeof entry === "object" && entry.date) {
        dateStr = String(entry.date).slice(0, 10);
      } else if (learned && typeof entry === "string") {
        dateStr = entry.slice(0, 10);
      }
      map[word] = { learned: learned, date: learned ? dateStr : "" };
    }
  } catch (err) {}
  return map;
}

function saveKaigoProgressMapToProps_(userId, map) {
  var compact = {};
  for (var word in map) {
    if (!map.hasOwnProperty(word) || !map[word] || !map[word].learned) continue;
    compact[word] = { learned: true, date: map[word].date || "" };
  }
  PropertiesService.getScriptProperties().setProperty(
    getKaigoProgressPropKey_(userId),
    JSON.stringify(compact)
  );
}

function loadKaigoProgressMap(userId) {
  // Properties を正とする（シートは可視化・バックアップ）
  var map = loadKaigoProgressMapFromProps_(userId);
  if (Object.keys(map).length > 0) {
    return map;
  }

  // 移行: シートにだけある旧データを取り込む
  var sheetMap = loadKaigoProgressMapFromSheet_(userId);
  if (Object.keys(sheetMap).length > 0) {
    saveKaigoProgressMapToProps_(userId, sheetMap);
  }
  return sheetMap;
}

function loadKaigoProgressMapFromSheet_(userId) {
  var map = {};
  var sheet = ensureKaigoProgressSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return map;
  }

  var values = sheet.getRange(2, 1, lastRow, 4).getValues();
  for (var i = 0; i < values.length; i++) {
    var uid = String(values[i][0] || "").trim();
    if (uid !== userId) continue;
    var word = String(values[i][1] || "").trim();
    if (!word) continue;
    var learned = values[i][2] === true || String(values[i][2]).toUpperCase() === "TRUE";
    var dateVal = values[i][3];
    var dateStr = "";
    if (learned && dateVal) {
      try {
        dateStr = Utilities.formatDate(new Date(dateVal), "Asia/Tokyo", "yyyy-MM-dd");
      } catch (dateErr) {
        dateStr = String(dateVal).slice(0, 10);
      }
    }
    map[word] = { learned: learned, date: dateStr };
  }
  return map;
}

function writeKaigoProgressSheet_(userId, map) {
  var sheet = ensureKaigoProgressSheet();
  var lastRow = sheet.getLastRow();
  var keep = [];

  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow, 4).getValues();
    for (var i = 0; i < values.length; i++) {
      var uid = String(values[i][0] || "").trim();
      if (uid.charAt(0) === "'") uid = uid.slice(1);
      if (uid && uid !== String(userId)) {
        keep.push([
          String(values[i][0] || ""),
          String(values[i][1] || ""),
          values[i][2] === true || String(values[i][2]).toUpperCase() === "TRUE",
          values[i][3] || ""
        ]);
      }
    }
    sheet.getRange(2, 1, lastRow, 4).clearContent();
  }

  for (var word in map) {
    if (!map.hasOwnProperty(word) || !map[word] || !map[word].learned) continue;
    keep.push([
      String(userId),
      String(word),
      true,
      String(map[word].date || "")
    ]);
  }

  if (keep.length > 0) {
    // getRange(row, column, numRows, numColumns) の第3引数は「行数」
    var range = sheet.getRange(2, 1, keep.length, 4);
    range.setValues(keep);
    sheet.getRange(2, 1, keep.length, 1).setNumberFormat("@");
  }

  SpreadsheetApp.flush();
  return keep.length;
}

function syncKaigoProgressSheetBestEffort_(userId, map) {
  try {
    var n = writeKaigoProgressSheet_(userId, map);
    return { ok: true, rows: n };
  } catch (err) {
    console.error("progress sheet sync failed: " + err);
    return { ok: false, error: String(err) };
  }
}

function applyKaigoProgressToWords(allWords, userId) {
  var map = loadKaigoProgressMap(userId);
  for (var i = 0; i < allWords.length; i++) {
    var word = allWords[i].w;
    var entry = map[word];
    if (entry && entry.learned) {
      allWords[i].l = true;
      allWords[i].d = entry.date || "";
    } else {
      allWords[i].l = false;
      allWords[i].d = "";
    }
  }
}

function submitKaigoProgressUpdate(userId, checkedWords, uncheckedWords) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { error: "サーバーが混み合っています。再度お試しください。" };
  }

  try {
    checkedWords = normalizeWordList_(checkedWords);
    uncheckedWords = normalizeWordList_(uncheckedWords);
    var map = loadKaigoProgressMap(userId);
    var today = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
    var i;

    for (i = 0; i < checkedWords.length; i++) {
      map[checkedWords[i]] = { learned: true, date: today };
    }
    for (i = 0; i < uncheckedWords.length; i++) {
      map[uncheckedWords[i]] = { learned: false, date: "" };
    }

    // 本体は Properties（必須）
    saveKaigoProgressMapToProps_(userId, map);

    // シートは可視化用（失敗しても保存自体は成功）
    var sheetSync = syncKaigoProgressSheetBestEffort_(userId, map);

    return {
      success: true,
      progressCount: countLearnedInProgressMap_(map),
      sheetSynced: sheetSync.ok === true,
      sheetRows: sheetSync.rows || 0,
      sheetError: sheetSync.error || ""
    };
  } catch (err) {
    return { error: "進捗保存エラー: " + err };
  } finally {
    lock.releaseLock();
  }
}

function getKaigoCursorsPropertyKey(userId) {
  return "FLASH_CURSORS_kaigo_" + userId;
}

function loadKaigoFlashCursors(userId) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(getKaigoCursorsPropertyKey(userId));
    if (!raw) {
      return {};
    }
    return normalizeCursorsMap(JSON.parse(raw));
  } catch (err) {
    return {};
  }
}

function saveKaigoFlashCursors(userId, incoming) {
  var incomingMap = normalizeCursorsMap(incoming);
  if (!Object.keys(incomingMap).length) {
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error("サーバーが混み合っています。再度お試しください。");
  }

  try {
    var merged = mergeCursorsByTime(loadKaigoFlashCursors(userId), incomingMap);
    PropertiesService.getScriptProperties().setProperty(
      getKaigoCursorsPropertyKey(userId),
      JSON.stringify(merged)
    );
  } finally {
    lock.releaseLock();
  }
}

var PAID_SHEET = "paid";
var ORDER_SHEET = "orders";
var PAID_PLAN_YEN = 3980;
var PAID_PLAN_MONTHS = 12;

function normalizeEmail_(email) {
  return String(email || "").trim().toLowerCase();
}

function isPaywallOn_() {
  var flag = PropertiesService.getScriptProperties().getProperty("PAID_PAYWALL");
  return String(flag || "").toLowerCase() === "on";
}

function isOwnerEmail_(email) {
  email = normalizeEmail_(email);
  if (!email) return false;
  var owner = normalizeEmail_(getProdCheckNotifyEmail());
  if (owner && email === owner) return true;
  var extra = String(PropertiesService.getScriptProperties().getProperty("PAID_OWNER_EMAILS") || "");
  var parts = extra.split(",");
  for (var i = 0; i < parts.length; i++) {
    if (normalizeEmail_(parts[i]) === email) return true;
  }
  return false;
}

function isPaidEmail_(email) {
  email = normalizeEmail_(email);
  if (!email) return false;
  if (isOwnerEmail_(email)) return true;
  if (!isPaywallOn_()) return true;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PAID_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return false;

  var todayKey = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    if (normalizeEmail_(values[i][0]) !== email) continue;
    var until = values[i][1];
    if (!until) return true;
    var untilKey = "";
    if (until instanceof Date) {
      untilKey = Utilities.formatDate(until, "Asia/Tokyo", "yyyy-MM-dd");
    } else {
      untilKey = String(until).slice(0, 10);
    }
    if (untilKey >= todayKey) return true;
  }
  return false;
}

function ensurePaidSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PAID_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PAID_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([["email", "until", "orderId", "activatedAt"]]);
  }
  return sheet;
}

function ensureOrderSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ORDER_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ORDER_SHEET);
    sheet.getRange(1, 1, 1, 8).setValues([["id", "email", "seats", "yen", "created", "paid", "token", "note"]]);
  }
  return sheet;
}

function addPaidEmail_(email, untilDate, orderId) {
  email = normalizeEmail_(email);
  if (!email || email.indexOf("@") === -1) return;
  var sheet = ensurePaidSheet_();
  sheet.appendRow([email, untilDate, String(orderId || ""), new Date()]);
}

function parseEmailList_(raw) {
  var text = "";
  if (Array.isArray(raw)) {
    text = raw.join("\n");
  } else {
    text = String(raw || "");
  }
  var parts = text.split(/[\s,;]+/);
  var out = [];
  var seen = {};
  for (var i = 0; i < parts.length; i++) {
    var item = normalizeEmail_(parts[i]);
    if (!item || item.indexOf("@") === -1 || seen[item]) continue;
    seen[item] = true;
    out.push(item);
  }
  return out;
}

function parseLicenseEmailsFromNote_(note, fallbackEmail) {
  var emails = [];
  var raw = String(note || "").trim();
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.emails) {
        emails = parseEmailList_(parsed.emails);
      }
    } catch (err) {
      emails = parseEmailList_(raw);
    }
  }
  if (!emails.length && fallbackEmail) {
    emails = [normalizeEmail_(fallbackEmail)];
  }
  return emails;
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paidResultHtml_(result) {
  var ok = result && result.success;
  var title = ok ? "有効化しました" : "有効化できませんでした";
  var emailLines = (result && result.emails && result.emails.length)
    ? result.emails
    : [result && result.email];
  var emailHtml = "";
  for (var n = 0; n < emailLines.length; n++) {
    if (n) emailHtml += "<br>";
    emailHtml += escapeHtml_(emailLines[n]);
  }
  var body = ok
    ? (result.alreadyPaid
      ? "この申し込みは、すでに有効です。<br>" + emailHtml
      : "入金を反映しました。<br>" + emailHtml)
    : escapeHtml_((result && result.error) || "エラー");
  return HtmlService.createHtmlOutput(
    "<html><body style='font-family:sans-serif;padding:32px;line-height:1.6'>" +
      "<h1>" + title + "</h1><p>" + body + "</p></body></html>"
  );
}

function placePaidOrder_(params, sendNow) {
  var email = normalizeEmail_(params.email);
  if (!email || email.indexOf("@") === -1) {
    return { error: "メールアドレスを入力してください" };
  }

  var licenseEmails = parseEmailList_(params.emails);
  if (!licenseEmails.length) {
    licenseEmails = [email];
  }
  var seats = Math.max(
    licenseEmails.length,
    Math.max(1, Math.min(50, parseInt(params.seats, 10) || 1))
  );
  if (seats > 50) {
    return { error: "人数は50人までです" };
  }

  var yen = PAID_PLAN_YEN * seats;
  var orderId = Utilities.getUuid();
  var token = Utilities.getUuid();
  var note = JSON.stringify({ emails: licenseEmails, mailed: false });
  var sheet = ensureOrderSheet_();
  sheet.appendRow([orderId, email, seats, yen, new Date(), false, token, note]);

  var result = { success: true, orderId: orderId, yen: yen, seats: seats };
  if (!sendNow) {
    return result;
  }
  return mergeOrderMailResult_(result, sendStoredOrderMail_(orderId));
}

function mergeOrderMailResult_(result, mailResult) {
  mailResult = mailResult || {};
  if (mailResult.success && !mailResult.mailError) {
    return result;
  }
  result.mailError = String(mailResult.mailError || mailResult.error || "メール送信に失敗しました");
  result.warning = mailResult.warning || "申し込みは記録しましたが、メールを送れませんでした。";
  return result;
}

function sendStoredOrderMail_(orderId) {
  orderId = String(orderId || "").trim();
  if (!orderId) {
    return { error: "orderId がありません" };
  }

  var sheet = ensureOrderSheet_();
  var last = sheet.getLastRow();
  if (last < 2) {
    return { error: "注文がありません" };
  }

  var values = sheet.getRange(2, 1, last - 1, 8).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || "") !== orderId) continue;

    var note = {};
    try {
      note = JSON.parse(String(values[i][7] || "{}"));
    } catch (err) {
      note = {};
    }
    if (note.mailed === true) {
      return { success: true, alreadyMailed: true };
    }

    var email = normalizeEmail_(values[i][1]);
    var seats = values[i][2];
    var yen = values[i][3];
    var token = values[i][6];
    var licenseEmails = parseLicenseEmailsFromNote_(values[i][7], email);
    var mail = sendOrderNoticeMails_(email, licenseEmails, seats, yen, token);
    note.emails = licenseEmails;
    note.mailed = mail.ok === true;
    note.mailError = mail.mailError || "";
    sheet.getRange(i + 2, 8).setValue(JSON.stringify(note));

    if (!mail.ok) {
      return {
        success: true,
        mailError: mail.mailError,
        warning: "申し込みは記録しましたが、メールを送れませんでした。"
      };
    }
    return { success: true };
  }

  return { error: "注文が見つかりません" };
}

function sendOrderNoticeMails_(email, licenseEmails, seats, yen, token) {
  var toOwner = getProdCheckNotifyEmail();
  var bank = String(PropertiesService.getScriptProperties().getProperty("BANK_TRANSFER_INFO") || "").trim();
  var activateUrl = ScriptApp.getService().getUrl() + "?action=activateOrder&token=" + encodeURIComponent(token);

  var buyerBody =
    "お申し込みを受け付けました。\n\n" +
    "人数：" + seats + "人\n" +
    "金額：" + yen + "円（1人あたり" + PAID_PLAN_YEN + "円 / 12か月）\n" +
    "使うGmail：\n" + licenseEmails.join("\n") + "\n\n";
  if (bank) {
    buyerBody += "【振込先】\n" + bank + "\n\n入金後、利用できるようになります。\n";
  } else {
    buyerBody += "振込先は、確認でき次第メールします。\n";
  }
  buyerBody += "\n入金後、上のGmailで Google ログインしてください。\nhttps://nihongo.site/kaigo/words/";

  var mailErrors = [];
  var buyerMail = sendPlainMail_(email, "【ことば】お申し込みを受け付けました", buyerBody);
  if (!buyerMail.ok) {
    mailErrors.push("申込者: " + (buyerMail.error || "失敗"));
  }

  if (toOwner) {
    var ownerBody =
      "新規申し込み\n\n" +
      "連絡：" + email + "\n" +
      "人数：" + seats + "\n" +
      "金額：" + yen + "円\n" +
      "Gmail：\n" + licenseEmails.join("\n") + "\n\n" +
      "入金を確認したら、次のリンクを開いて有効化してください。\n" +
      activateUrl;
    var ownerMail = sendPlainMail_(toOwner, "【ことば】新規申し込み " + email, ownerBody);
    if (!ownerMail.ok) {
      mailErrors.push("管理者: " + (ownerMail.error || "失敗"));
    }
  } else {
    mailErrors.push("管理者: 通知先メールが未設定です");
  }

  if (mailErrors.length) {
    return { ok: false, mailError: mailErrors.join(" / ") };
  }
  return { ok: true };
}

function sendPlainMail_(to, subject, body) {
  to = normalizeEmail_(to);
  if (!to) {
    return { ok: false, error: "宛先がありません" };
  }
  try {
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: body,
      name: "ことば"
    });
    return { ok: true };
  } catch (err) {
    console.error("メール失敗: " + err);
    return { ok: false, error: String(err) };
  }
}

function processUnmailedPaidOrders() {
  var sheet = ensureOrderSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return;
  var values = sheet.getRange(2, 1, last - 1, 8).getValues();
  for (var i = 0; i < values.length; i++) {
    var orderId = String(values[i][0] || "").trim();
    if (!orderId) continue;
    var note = {};
    try {
      note = JSON.parse(String(values[i][7] || "{}"));
    } catch (err) {
      note = {};
    }
    if (note.mailed === true) continue;
    sendStoredOrderMail_(orderId);
  }
}

function activatePaidOrder_(token) {
  token = String(token || "").trim();
  if (!token) {
    return { error: "token がありません" };
  }

  var sheet = ensureOrderSheet_();
  var last = sheet.getLastRow();
  if (last < 2) {
    return { error: "注文がありません" };
  }

  var values = sheet.getRange(2, 1, last - 1, 8).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][6] || "") !== token) continue;
    var contact = values[i][1];
    var licenseEmails = parseLicenseEmailsFromNote_(values[i][7], contact);
    if (values[i][5] === true || String(values[i][5]).toUpperCase() === "TRUE") {
      return { success: true, alreadyPaid: true, email: contact, emails: licenseEmails };
    }
    var seats = Math.max(1, Number(values[i][2]) || 1);
    var until = new Date();
    until.setMonth(until.getMonth() + PAID_PLAN_MONTHS);
    var orderId = values[i][0];
    for (var j = 0; j < licenseEmails.length; j++) {
      addPaidEmail_(licenseEmails[j], until, orderId);
    }
    sheet.getRange(i + 2, 6).setValue(true);
    var untilText = Utilities.formatDate(until, "Asia/Tokyo", "yyyy-MM-dd");
    var startBody =
      "入金を確認しました。次のGmailでログインしてください。\n\n" +
      licenseEmails.join("\n") +
      "\n\nhttps://nihongo.site/kaigo/words/\n\n期限：" + untilText;
    try {
      MailApp.sendEmail(contact, "【ことば】ご利用を開始できます", startBody);
    } catch (err) {
      console.error("有効化メール失敗: " + err);
    }
    return { success: true, email: contact, emails: licenseEmails, seats: seats };
  }

  return { error: "注文が見つかりません" };
}

