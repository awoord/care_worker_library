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
// 秘密URL生徒ごとの db 進捗列（1-based）。I/J=J、K/L=JF
var PRIVATE_PROGRESS_BY_USER = {
  J: { learnedCol: 9, dateCol: 10 },
  JF: { learnedCol: 11, dateCol: 12 }
};
// 未設定時はスクリプト実行者のメールへ送信。別アドレスへ送る場合は
// スクリプトプロパティ PROD_CHECK_NOTIFY_EMAIL を設定する。

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

function doGet(e) {
  var params = (e && e.parameter) || {};
  var sheetInfo = resolveDbSheet(e);
  if (sheetInfo.error) {
    return jsonResponse({ error: sheetInfo.error, allWords: [], categories: {}, roadmap: {} });
  }

  var user = resolvePrivateUser_(e, params);
  var progressUser = sheetInfo.isTest ? "J" : user;
  var data = loadInitialAppData(sheetInfo.sheet, progressUser);
  data.cursors = loadFlashCursors(sheetInfo.isTest, user);
  data.user = user;
  return jsonResponse(data);
}

function doPost(e) {
  try {
    var params = parsePostParams(e);
    var sheetInfo = resolveDbSheet(e, params);
    if (sheetInfo.error) {
      return jsonResponse({ error: sheetInfo.error });
    }

    var user = resolvePrivateUser_(e, params);
    var progressUser = sheetInfo.isTest ? "J" : user;
    var checkedWords = params.checkedWords || [];
    var uncheckedWords = params.uncheckedWords || [];
    var hasChecks = checkedWords.length > 0 || uncheckedWords.length > 0;
    var result = { success: true, user: user };

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
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getFlashCursorsPropertyKey(isTest, user) {
  if (isTest) {
    return FLASH_CURSORS_PROP_TEST;
  }
  var u = normalizePrivateUser_(user);
  if (u === "J") {
    return FLASH_CURSORS_PROP_PROD;
  }
  return "FLASH_CURSORS_prod_" + u;
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
  } finally {
    lock.releaseLock();
  }
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
      invalidateInitialAppCache(sheet.getName(), user);
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
  /* 廃止: 学習チェック時の Gmail 通知は送らない */
  return;
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
