// @ts-nocheck
// ==========================================================
// Webアプリ API（本番: db / テスト: db のコピーのみ）
// ==========================================================

var DB_SHEET_PROD = "db";
var DB_SHEET_TEST = "db のコピー";
var DB_SHEET_TEST_MISSING_ERROR = "参照するdbがありません";

function doGet(e) {
  var sheetInfo = resolveDbSheet(e);
  if (sheetInfo.error) {
    return jsonResponse({ error: sheetInfo.error, allWords: [], categories: {}, roadmap: {} });
  }

  var data = loadInitialAppData(sheetInfo.sheet);
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
    var result = submitCategoryUpdate(checkedWords, uncheckedWords, sheetInfo.sheet);
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

function loadInitialAppData(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { allWords: [], categories: {}, roadmap: {} };
  }

  var data = sheet.getRange(2, 1, lastRow, 10).getValues();
  var allWords = [];
  var learnedDates = [];
  var catMap = { "基本": [], "介護": [], "医療": [], "社会": [] };

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

    if (!word) continue;

    var item = {
      word: word,
      category: cat,
      ruby: ruby,
      english: eng,
      meaning: meaning,
      example: example,
      isLearned: isLearned
    };

    allWords.push(item);
    if (catMap[cat]) {
      catMap[cat].push(item);
    }

    if (isLearned && learnedDate) {
      try {
        var dStr = Utilities.formatDate(new Date(learnedDate), "Asia/Tokyo", "yyyy-MM-dd");
        if (learnedDates.indexOf(dStr) === -1) {
          learnedDates.push(dStr);
        }
      } catch (dateErr) {}
    }
  }

  var categoriesPayload = {};
  var cats = ["基本", "介護", "医療", "社会"];
  for (var c = 0; c < cats.length; c++) {
    var cName = cats[c];
    var list = catMap[cName] || [];
    var learnedCount = list.filter(function (x) { return x.isLearned; }).length;
    var unlearnedList = list.filter(function (x) { return !x.isLearned; });
    categoriesPayload[cName] = {
      words: unlearnedList.length > 0 ? unlearnedList.slice(0, 5) : list.slice(0, 5),
      learnedCount: learnedCount,
      targetCount: list.length,
      isAllLearned: (list.length > 0 && unlearnedList.length === 0)
    };
  }

  var roadmapPayload = buildRoadmapPayload(learnedDates, allWords);

  return {
    allWords: allWords,
    categories: categoriesPayload,
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

function buildRoadmapPayload(learnedDates, allWords) {
  var totalLearned = allWords.filter(function (x) { return x.isLearned; }).length;
  var todayStr = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");

  var streak = 0;
  var checkDate = new Date();

  while (true) {
    var dKey = Utilities.formatDate(checkDate, "Asia/Tokyo", "yyyy-MM-dd");
    if (learnedDates.indexOf(dKey) !== -1) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      if (dKey === todayStr) {
        checkDate.setDate(checkDate.getDate() - 1);
        continue;
      }
      break;
    }
  }

  return {
    streakText: "⭐️ " + (streak > 0 ? streak : 0) + "日 連続達成中！",
    totalLearned: totalLearned,
    learnedDates: learnedDates,
    todayStr: todayStr
  };
}
