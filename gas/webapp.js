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
// 未設定時はスクリプト実行者のメールへ送信。別アドレスへ送る場合は
// スクリプトプロパティ PROD_CHECK_NOTIFY_EMAIL を設定する。

function doGet(e) {
  if (isKaigoApp(e)) {
    return handleKaigoGet(e);
  }

  var sheetInfo = resolveDbSheet(e);
  if (sheetInfo.error) {
    return jsonResponse({ error: sheetInfo.error, allWords: [], categories: {}, roadmap: {} });
  }

  var data = loadInitialAppData(sheetInfo.sheet);
  data.cursors = loadFlashCursors(sheetInfo.isTest);
  return jsonResponse(data);
}

function doPost(e) {
  try {
    var params = parsePostParams(e);
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
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
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
  } finally {
    lock.releaseLock();
  }
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
        auth: { requiredForSave: true, loggedIn: false }
      });
    }
    applyKaigoProgressToWords(base.allWords, authInfo.userId);
    var learnedDates = collectLearnedDatesFromWords(base.allWords);
    base.roadmap = buildRoadmapPayload(learnedDates, base.allWords);
    base.cursors = loadKaigoFlashCursors(authInfo.userId);
    base.auth = {
      requiredForSave: true,
      loggedIn: true,
      userId: authInfo.userId,
      email: authInfo.email || ""
    };
    return jsonResponse(base);
  }

  // ゲスト: 学習フラグなし
  clearLearnedFlags(base.allWords);
  base.roadmap = buildRoadmapPayload([], base.allWords);
  base.cursors = {};
  base.auth = { requiredForSave: true, loggedIn: false };
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
