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
