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
var FLASH_CURSORS_SHEET = "cursors";
var FLASH_CURSORS_SHEET_HEADERS = ["環境", "カテゴリ", "位置", "次", "次の語", "カテゴリ語数", "更新"];
var LEARNED_DATE_NUMBER_FORMAT = "yyyy/mm/dd hh:mm";
// 未設定時はスクリプト実行者のメールへ送信。別アドレスへ送る場合は
// スクリプトプロパティ PROD_CHECK_NOTIFY_EMAIL を設定する。
//
// 申し込みメールが「send_mail の権限がない」になるとき:
// エディタで authorizePaidMail を実行 → 権限を許可 → 必要ならウェブアプリを再デプロイ。

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

  var data = loadInitialAppData(sheetInfo.sheet);
  data.cursors = loadFlashCursors(sheetInfo.isTest);
  // J専用（本番）: きょう見た用の語セットも返す（端末依存を解消）
  if (!sheetInfo.isTest) {
    data.dailySeen = loadDailySeenPayload_("J", "");
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
    if (isKaigoApp(e, params)) {
      return handleKaigoPost(e, params);
    }

    var sheetInfo = resolveDbSheet(e, params);
    if (sheetInfo.error) {
      return jsonResponse({ error: sheetInfo.error });
    }

    var checkedWords = params.checkedWords || [];
    var uncheckedWords = params.uncheckedWords || [];
    var hasChecks = checkedWords.length > 0 || uncheckedWords.length > 0;
    var result = { success: true };

    if (hasChecks) {
      result = submitCategoryUpdate(checkedWords, uncheckedWords, sheetInfo.sheet);
      if (result && result.error) {
        return jsonResponse(result);
      }
    }

    if (params.cursors) {
      saveFlashCursors(params.cursors, sheetInfo.isTest);
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

function getFlashCursorsPropertyKey(isTest) {
  return isTest ? FLASH_CURSORS_PROP_TEST : FLASH_CURSORS_PROP_PROD;
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

function loadFlashCursors(isTest) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(getFlashCursorsPropertyKey(isTest));
    if (!raw) {
      return {};
    }
    return normalizeCursorsMap(JSON.parse(raw));
  } catch (err) {
    return {};
  }
}

function saveFlashCursors(incoming, isTest) {
  var incomingMap = normalizeCursorsMap(incoming);
  if (!Object.keys(incomingMap).length) {
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error("サーバーが混み合っています。再度お試しください。");
  }

  try {
    var merged = mergeCursorsByTime(loadFlashCursors(isTest), incomingMap);
    PropertiesService.getScriptProperties().setProperty(
      getFlashCursorsPropertyKey(isTest),
      JSON.stringify(merged)
    );
    syncFlashCursorsSheetBestEffort_(merged, isTest);
  } finally {
    lock.releaseLock();
  }
}

function ensureFlashCursorsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FLASH_CURSORS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(FLASH_CURSORS_SHEET);
  }

  var existing = sheet.getRange(1, 1, 1, FLASH_CURSORS_SHEET_HEADERS.length).getValues()[0];
  var needHeader = false;
  for (var i = 0; i < FLASH_CURSORS_SHEET_HEADERS.length; i++) {
    if (String(existing[i] || "") !== FLASH_CURSORS_SHEET_HEADERS[i]) {
      needHeader = true;
      break;
    }
  }
  if (needHeader) {
    sheet.getRange(1, 1, 1, FLASH_CURSORS_SHEET_HEADERS.length).setValues([FLASH_CURSORS_SHEET_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, FLASH_CURSORS_SHEET_HEADERS.length, 120);
    sheet.setColumnWidth(5, 220);
  }
  return sheet;
}

function getFlashCursorsDbSheet_(isTest) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(isTest ? DB_SHEET_TEST : DB_SHEET_PROD);
}

function buildCategoryWordListsFromSheet_(sheet) {
  var lists = {};
  var i;
  for (i = 0; i < PROD_CATEGORY_ORDER.length; i++) {
    lists[PROD_CATEGORY_ORDER[i]] = [];
  }
  if (!sheet) {
    return lists;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return lists;
  }

  var data = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
  for (i = 0; i < data.length; i++) {
    var word = String(data[i][0] || "").trim();
    var cat = String(data[i][2] || "").trim();
    if (!word || !lists[cat]) {
      continue;
    }
    lists[cat].push(word);
  }
  return lists;
}

function formatFlashCursorUpdatedAt_(updatedAt) {
  if (typeof updatedAt !== "number" || !isFinite(updatedAt) || updatedAt <= 0) {
    return "";
  }
  try {
    return Utilities.formatDate(new Date(updatedAt), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
  } catch (err) {
    return "";
  }
}

function buildFlashCursorsSheetRows_(cursorsMap, isTest) {
  var envLabel = isTest ? "test" : "prod";
  var lists = buildCategoryWordListsFromSheet_(getFlashCursorsDbSheet_(isTest));
  var rows = [];
  for (var i = 0; i < PROD_CATEGORY_ORDER.length; i++) {
    var cat = PROD_CATEGORY_ORDER[i];
    var words = lists[cat] || [];
    var entry = cursorsMap[cat] || { i: 0, t: 0 };
    var index = entry.i || 0;
    if (index < 0) {
      index = 0;
    }
    var nextWord = "";
    if (words.length > 0) {
      nextWord = words[index % words.length] || "";
    }
    rows.push([
      envLabel,
      cat,
      index,
      words.length > 0 ? (index % words.length) + 1 : "",
      nextWord,
      words.length,
      formatFlashCursorUpdatedAt_(entry.t)
    ]);
  }
  return rows;
}

function writeFlashCursorsSheet_(cursorsMap, isTest) {
  var sheet = ensureFlashCursorsSheet();
  var startRow = isTest ? 6 : 2;
  var rows = buildFlashCursorsSheetRows_(cursorsMap, isTest);
  sheet.getRange(startRow, 1, rows.length, FLASH_CURSORS_SHEET_HEADERS.length).setValues(rows);
  SpreadsheetApp.flush();
  return rows.length;
}

function syncFlashCursorsSheetBestEffort_(cursorsMap, isTest) {
  try {
    writeFlashCursorsSheet_(cursorsMap, isTest);
  } catch (err) {
    console.error("cursors sheet sync failed: " + err);
  }
}

/** GASエディタから実行: 保存済みカーソルを見る用シートへ書き出す */
function syncFlashCursorsSheetNow() {
  writeFlashCursorsSheet_(loadFlashCursors(false), false);
  writeFlashCursorsSheet_(loadFlashCursors(true), true);
}

function getInitialAppCacheKey(sheetName) {
  return "initial_" + sheetName;
}

function invalidateInitialAppCache(sheetName) {
  CacheService.getScriptCache().remove(getInitialAppCacheKey(sheetName));
}

function loadInitialAppData(sheet) {
  var cacheKey = getInitialAppCacheKey(sheet.getName());
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (cacheErr) {}
  }

  var payload = buildInitialAppData(sheet);
  try {
    cache.put(cacheKey, JSON.stringify(payload), 180);
  } catch (putErr) {}
  return payload;
}

function buildInitialAppData(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { allWords: [], categories: {}, roadmap: {} };
  }

  var data = sheet.getRange(2, 1, lastRow, 10).getValues();
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
    var isLearned = (row[8] === true || String(row[8]).toUpperCase() === "TRUE");
    var learnedDate = row[9];
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

function submitCategoryUpdate(checkedWords, uncheckedWords, sheet) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { error: "サーバーが混み合っています。再度お試しください。" };
  }

  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: true };
    }

    var flagsRange = sheet.getRange(2, 2, lastRow, 10);
    var values = flagsRange.getValues();
    var today = new Date();
    var isModified = false;

    var checkedSet = toWordSet(checkedWords);
    var uncheckedSet = toWordSet(uncheckedWords);

    for (var i = 0; i < values.length; i++) {
      var word = String(values[i][0] || "").trim();
      if (!word) continue;

      if (checkedSet[word]) {
        values[i][7] = true;
        values[i][8] = today;
        isModified = true;
      } else if (uncheckedSet[word]) {
        values[i][7] = false;
        values[i][8] = "";
        isModified = true;
      }
    }

    if (isModified) {
      flagsRange.setValues(values);
      formatLearnedDateColumn_(sheet);
      invalidateInitialAppCache(sheet.getName());

      if (sheet.getName() === DB_SHEET_PROD && checkedWords.length > 0) {
        sendProdCheckNotifyEmail(values);
      }
    }

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function formatLearnedDateColumn_(sheet) {
  if (!sheet) {
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  sheet.getRange(2, 10, lastRow - 1, 1).setNumberFormat(LEARNED_DATE_NUMBER_FORMAT);
}

/** GASエディタから実行: db / db のコピー のJ列を日時表示にする（アプリの値は変えない） */
function formatLearnedDateColumnNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  formatLearnedDateColumn_(ss.getSheetByName(DB_SHEET_PROD));
  formatLearnedDateColumn_(ss.getSheetByName(DB_SHEET_TEST));
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
  var to = getProdCheckNotifyEmail();
  if (!to) return;

  var counts = buildCategoryLearnedCounts(dbValues);
  var nowStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm");
  var body =
    "本番dbで単語がチェックされました。\n\n" +
    formatCategoryCountLines(counts) +
    "\n\n" +
    nowStr;

  try {
    MailApp.sendEmail(to, "【本番】単語がチェックされました", body);
  } catch (mailErr) {
    console.error("本番チェック通知メールの送信に失敗: " + mailErr);
  }
}

var DAILY_LOG_SHEET = "daily_log";
var DAILY_LOG_CATS = ["基本", "介護", "医療", "社会"];
var DAILY_LOG_HEADERS = [
  "date",
  "見た_基本",
  "見た_介護",
  "見た_医療",
  "見た_社会",
  "見た_合計",
  "知ってる_基本",
  "知ってる_介護",
  "知ってる_医療",
  "知ってる_社会",
  "知ってる_合計"
];

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
    sheet.clear();
    sheet.getRange(1, 1, 1, DAILY_LOG_HEADERS.length).setValues([DAILY_LOG_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange("A:A").setNumberFormat("@");
  }
  return sheet;
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
    // 旧形式: flat lists only
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
  var rowValues = [
    dateKey,
    counts["基本"].seen,
    counts["介護"].seen,
    counts["医療"].seen,
    counts["社会"].seen,
    counts.total.seen,
    counts["基本"].known,
    counts["介護"].known,
    counts["医療"].known,
    counts["社会"].known,
    counts.total.known
  ];
  var row = findDailyLogRowIndex_(sheet, dateKey);
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
    dateKey = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  }
  var stored = null;
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(
      getDailySeenWordsPropKey_(user, dateKey)
    );
    if (raw) {
      stored = JSON.parse(raw);
    }
  } catch (err) {
    stored = null;
  }
  var byCat = stored && stored.byCat ? stored.byCat : emptyDailyByCat_();
  var star = stored && stored.star === true;
  return buildDailySeenPayloadFromByCat_(dateKey, user, byCat, star);
}

/** 見る用ログはカテゴリ別の見た/知ってるのみ。語セットは Properties に保持（dbは変更しない）。 */
function upsertDailyLog_(params) {
  params = params || {};
  var dateKey = String(params.date || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    dateKey = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  }
  var user = String(params.user || "J").trim() || "J";
  var incomingByCat = normalizeDailyByCat_(params.byCategory || params.byCat || {});

  // 旧クライアント互換: flat lists だけ来た場合は「合計」扱いにせず空のまま（カテゴリ不明）
  // ただし knownWords/unknownWords がある場合は byCategory が空なら合計用に医療などに振り分けない

  var existingByCat = loadStoredDailyByCat_(user, dateKey);
  var mergedByCat = mergeDailyByCat_(existingByCat, incomingByCat);

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
  saveStoredDailyByCat_(user, dateKey, mergedByCat, payload.star);
  writeDailyLogSummaryRow_(dateKey, payload.byCategory);
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

