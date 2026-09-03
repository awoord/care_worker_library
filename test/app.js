var GAS_BASE_URL = "https://script.google.com/macros/s/AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec";
var FLASH_SESSION_SIZE = 5;
var FLASH_EXIT_KNOWN_MS = 780;
var FLASH_EXIT_SKIP_MS = 780;
var FLASH_EXIT_GAP_MS = 50;
var LEARN_MODE_AUTO = "auto";
var AUTO_SESSION_PLAN = {
  "基本": 2,
  "介護": 1,
  "医療": 1,
  "社会": 1
};
var CATEGORIES = ["基本", "介護", "医療", "社会"];

function isTestDeploy() {
  return /\/test(?:\/|$)/.test(window.location.pathname);
}

function getStorageKey(base) {
  return base + (isTestDeploy() ? "_test" : "_prod");
}

function getApiUrl() {
  var qs = "_t=" + Date.now();
  if (isTestDeploy()) {
    qs = "env=test&" + qs;
  }
  return GAS_BASE_URL + "?" + qs;
}

var bootPrefetchPromise = null;
var searchDeferredRenderHandle = null;
var searchDeferredRenderUsesIdle = false;

function fetchAppData() {
  return fetch(getApiUrl()).then(function (res) {
    return res.json();
  });
}

function startBootPrefetch() {
  if (!bootPrefetchPromise) {
    bootPrefetchPromise = fetchAppData();
  }
  return bootPrefetchPromise;
}

function unwrapWordsCache(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (parsed.data && (parsed.data.allWords || parsed.data.roadmap || parsed.data.error)) {
    return parsed.data;
  }
  if (parsed.allWords || parsed.roadmap || parsed.error) {
    return parsed;
  }
  return null;
}

function readWordsCache() {
  try {
    var raw = localStorage.getItem(getStorageKey("care_worker_words_cache_v3"));
    if (!raw) return null;
    return unwrapWordsCache(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

function writeWordsCache(payload) {
  try {
    localStorage.setItem(getStorageKey("care_worker_words_cache_v3"), JSON.stringify({
      savedAt: Date.now(),
      data: {
        allWords: payload.allWords,
        roadmap: payload.roadmap
      }
    }));
  } catch (e) {}
}

function normalizeWordItem(item) {
  if (!item || item.word !== undefined) {
    if (item && !item.learnedDate && item.d) {
      return Object.assign({}, item, { learnedDate: item.d });
    }
    return item;
  }
  return {
    word: item.w,
    category: item.c,
    ruby: item.r,
    english: item.e,
    meaning: item.m,
    example: item.x,
    isLearned: !!item.l,
    learnedDate: item.d || ""
  };
}

function normalizeApiPayload(res) {
  if (!res || res.error) {
    return res;
  }
  return {
    allWords: (res.allWords || []).map(normalizeWordItem),
    roadmap: res.roadmap || {},
    cursors: res.cursors || {}
  };
}

function applyDeployEnvUI() {
  if (!isTestDeploy()) return;

  document.body.classList.add("env-test");

  var themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", "#FB923C");
  }

  if (document.title.indexOf("【テスト】") !== 0) {
    document.title = "【テスト】" + document.title;
  }
}

var uiState = {
  mode: "learn",
  learnCat: LEARN_MODE_AUTO
};

var flashSession = {
  cat: "",
  wordNames: [],
  initialCount: 0,
  index: 0,
  revealed: false,
  completed: false,
  advancing: false,
  answerLog: []
};

var learnDataReady = false;
var flashInteractionReady = false;

var allWordsList = [];
var vocabularyRubyEntries = null;
var MIN_VOCAB_RUBY_LENGTH = 2;
var roadmapData = {};
var initialLearnedDatesMap = {};
var serverLearnedDatesMap = {};
var localAchievedDates = {};
var todayCommittedLearned = {};
var todaySkippedWords = {};
var localLearnedOverrides = {};
var trackedJSTDateKey = "";
var pendingChecks = {};
var postInFlightWords = {};
var pendingChecksSendPromise = Promise.resolve();
var searchCheckSendTimer = null;
var flashCursorsSendTimer = null;
var flashCursorsSendPromise = Promise.resolve();
var searchInputTimer = null;
var searchRenderToken = 0;
var SEARCH_RENDER_BATCH = 50;
var searchChromeState = {
  hidden: false,
  lastScrollTop: 0,
  scrollTicking: false,
  bound: false,
  touchStartY: 0,
  touchOnCheckbox: false,
  suppressChromeScrollUntil: 0
};
var SEARCH_CHROME_SCROLL_THRESHOLD = 10;
var SEARCH_CHROME_MIN_HIDE_OFFSET = 20;
var SEARCH_CHROME_TAP_SUPPRESS_MS = 400;
var VIEWPORT_DEFAULT = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover";
var VIEWPORT_SEARCH_ZOOMABLE = "width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover";

var selectedStatuses = [];
var selectedCats = [];

var SMALL_GOALS = {
  "基本": [200, 250, 300, 400, 500, 600, 700, 750, 800, 900, 1000],
  "介護": [70, 100, 150, 200, 250, 300, 350, 400],
  "医療": [80, 100, 130, 170, 210, 250, 300, 350],
  "社会": [50, 75, 100, 125, 150, 200, 250]
};

var themeColors = {
  "auto": "#939BB4",
  "基本": "#4563E8",
  "介護": "#22C07A",
  "医療": "#F05678",
  "社会": "#D97706"
};

function normalizeLearnCat(catName) {
  if (catName === LEARN_MODE_AUTO) {
    return LEARN_MODE_AUTO;
  }
  if (CATEGORIES.indexOf(catName) !== -1) {
    return catName;
  }
  return LEARN_MODE_AUTO;
}

function loadUiState() {
  uiState.mode = localStorage.getItem(getStorageKey("saved_main_mode")) || "learn";
  var savedLearnCat = localStorage.getItem(getStorageKey("saved_learn_cat")) || LEARN_MODE_AUTO;
  uiState.learnCat = normalizeLearnCat(savedLearnCat);

  localAchievedDates = JSON.parse(localStorage.getItem(getStorageKey("saved_achieved_dates")) || "{}");
  localLearnedOverrides = loadLocalLearnedOverrides();

  var todayKey = getTodayJSTStr();
  var savedTrackedKey = localStorage.getItem(getStorageKey("saved_tracked_jst_date_key")) || "";

  if (savedTrackedKey && savedTrackedKey !== todayKey) {
    resetDailySessionState();
  } else {
    todayCommittedLearned = loadTodayCommittedLearned();
    todaySkippedWords = loadTodaySkippedWords();
    pendingChecks = loadPendingChecksFromStorage();
  }

  trackedJSTDateKey = todayKey;
  localStorage.setItem(getStorageKey("saved_tracked_jst_date_key"), todayKey);
  loadFlashSessionFromStorage();
}

function persistFlashSession() {
  try {
    sessionStorage.setItem(getStorageKey("care_worker_flash_session_v2"), JSON.stringify({
      cat: flashSession.cat,
      wordNames: flashSession.wordNames,
      initialCount: flashSession.initialCount,
      index: flashSession.index,
      completed: flashSession.completed,
      answerLog: flashSession.answerLog
    }));
  } catch (e) {}
}

function loadFlashSessionFromStorage() {
  try {
    var flashSessionKey = getStorageKey("care_worker_flash_session_v2");
    var saved = JSON.parse(sessionStorage.getItem(flashSessionKey) || "null");
    if (!saved || !Array.isArray(saved.wordNames) || !saved.wordNames.length) {
      return;
    }
    if (saved.cat !== uiState.learnCat) {
      sessionStorage.removeItem(flashSessionKey);
      return;
    }

    flashSession.cat = saved.cat;
    flashSession.wordNames = saved.wordNames.slice();
    flashSession.initialCount = saved.initialCount || saved.wordNames.length;
    flashSession.index = saved.index || 0;
    flashSession.revealed = false;
    flashSession.completed = !!saved.completed;
    flashSession.advancing = false;
    flashSession.answerLog = Array.isArray(saved.answerLog) ? saved.answerLog : [];

    if (flashSession.index >= flashSession.wordNames.length) {
      flashSession.index = Math.max(0, flashSession.wordNames.length - 1);
      flashSession.completed = flashSession.wordNames.length === 0;
    }
  } catch (e) {}
}

function loadLocalLearnedOverrides() {
  try {
    return JSON.parse(sessionStorage.getItem(getStorageKey("saved_local_learned_overrides")) || "{}");
  } catch (e) {
    return {};
  }
}

function persistLocalLearnedOverrides() {
  sessionStorage.setItem(getStorageKey("saved_local_learned_overrides"), JSON.stringify(localLearnedOverrides));
}

function loadTodayCommittedLearned() {
  try {
    var saved = JSON.parse(localStorage.getItem(getStorageKey("saved_today_committed_learned")) || "null");
    if (!saved || saved.date !== getTodayJSTStr()) {
      return {};
    }
    return saved.words || {};
  } catch (e) {
    return {};
  }
}

function persistTodayCommittedLearned() {
  refreshDailyBoundariesIfNeeded();
  localStorage.setItem(getStorageKey("saved_today_committed_learned"), JSON.stringify({
    date: getTodayJSTStr(),
    words: todayCommittedLearned
  }));
}

function resetDailySessionState() {
  todayCommittedLearned = {};
  todaySkippedWords = {};
  pendingChecks = {};
  localStorage.removeItem(getStorageKey("saved_today_committed_learned"));
  localStorage.removeItem(getStorageKey("saved_today_skipped_words"));
  localStorage.removeItem(getStorageKey("saved_pending_checks"));
}

function hasPostInFlightWords() {
  for (var wordName in postInFlightWords) {
    if (postInFlightWords.hasOwnProperty(wordName)) {
      return true;
    }
  }
  return false;
}

function pruneStaleTodayCommittedIfNeeded() {
  var todayKey = getTodayJSTStr();

  if (serverLearnedDatesMap[todayKey]) {
    return;
  }
  if (hasPendingTodayCheckChanges() || hasPostInFlightWords()) {
    return;
  }
  if (!hasTodayCommittedLearned()) {
    return;
  }

  todayCommittedLearned = {};
  persistTodayCommittedLearned();
}

function loadTodaySkippedWords() {
  try {
    var saved = JSON.parse(localStorage.getItem(getStorageKey("saved_today_skipped_words")) || "null");
    if (!saved || saved.date !== getTodayJSTStr()) {
      return {};
    }
    return saved.words || {};
  } catch (e) {
    return {};
  }
}

function loadPendingChecksFromStorage() {
  try {
    var saved = JSON.parse(localStorage.getItem(getStorageKey("saved_pending_checks")) || "null");
    if (!saved || saved.date !== getTodayJSTStr()) {
      return {};
    }
    return saved.checks || {};
  } catch (e) {
    return {};
  }
}

function persistPendingChecksToStorage() {
  var keys = Object.keys(pendingChecks);
  if (keys.length === 0) {
    localStorage.removeItem(getStorageKey("saved_pending_checks"));
    return;
  }
  localStorage.setItem(getStorageKey("saved_pending_checks"), JSON.stringify({
    date: getTodayJSTStr(),
    checks: pendingChecks
  }));
}

function persistTodaySkippedWords() {
  localStorage.setItem(getStorageKey("saved_today_skipped_words"), JSON.stringify({
    date: getTodayJSTStr(),
    words: todaySkippedWords
  }));
}

function refreshDailyBoundariesIfNeeded() {
  var todayKey = getTodayJSTStr();
  if (todayKey === trackedJSTDateKey) {
    return false;
  }

  resetDailySessionState();
  trackedJSTDateKey = todayKey;
  localStorage.setItem(getStorageKey("saved_tracked_jst_date_key"), todayKey);
  reconcileTodayAchievement({ allowUnmarkToday: true });
  refreshLearnedCountDisplays(uiState.mode === "daily");

  if (uiState.mode === "learn") {
    if (flashSession.completed) {
      updateFlashSessionUI();
    } else {
      refreshFlashSessionAfterDataLoad();
    }
  } else if (uiState.mode === "daily") {
    renderRoadmap();
  }

  return true;
}

function markWordSkippedToday(wordName) {
  if (!wordName) return;
  todaySkippedWords[wordName] = true;
  persistTodaySkippedWords();
}

function isWordSkippedToday(wordName) {
  return !!todaySkippedWords[wordName];
}

function hasTodayCommittedLearned() {
  for (var wordName in todayCommittedLearned) {
    if (todayCommittedLearned.hasOwnProperty(wordName)) {
      return true;
    }
  }
  return false;
}

function hasPendingTodayCheckChanges() {
  for (var wordName in pendingChecks) {
    if (pendingChecks.hasOwnProperty(wordName)) {
      return true;
    }
  }
  return false;
}

function hasTodayStreakAchievement() {
  if (getTodayLearnedCount() > 0) {
    return true;
  }
  // さがすで未送信の変更がある間は、サーバー側の今日達成を信用しない
  if (hasPendingTodayCheckChanges() || hasPostInFlightWords()) {
    return false;
  }
  return !!serverLearnedDatesMap[getTodayJSTStr()];
}

function getWordLearnedDateKey(item) {
  if (!item) {
    return "";
  }
  var raw = item.learnedDate || item.d || "";
  if (!raw) {
    return "";
  }
  var str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  return "";
}

function collectTodayLearnedWords() {
  refreshDailyBoundariesIfNeeded();

  var todayKey = getTodayJSTStr();
  var counted = {};
  var excluded = {};

  for (var pendingName in pendingChecks) {
    if (pendingChecks.hasOwnProperty(pendingName) && pendingChecks[pendingName] === false) {
      excluded[pendingName] = true;
    }
  }

  for (var i = 0; i < allWordsList.length; i++) {
    var item = allWordsList[i];
    var wordName = getWordKey(item);
    if (!wordName || excluded[wordName]) {
      continue;
    }
    if (!getWordChecked(item)) {
      continue;
    }
    if (getWordLearnedDateKey(item) === todayKey) {
      counted[wordName] = true;
    }
  }

  for (var wordName in todayCommittedLearned) {
    if (!todayCommittedLearned.hasOwnProperty(wordName) || excluded[wordName]) {
      continue;
    }
    if (getWordChecked(findWordByKey(wordName))) {
      counted[wordName] = true;
    }
  }

  for (var checkedName in pendingChecks) {
    if (!pendingChecks.hasOwnProperty(checkedName) || excluded[checkedName]) {
      continue;
    }
    if (pendingChecks[checkedName]) {
      counted[checkedName] = true;
    }
  }

  return counted;
}

function getTodayLearnedCount() {
  var counted = collectTodayLearnedWords();
  var count = 0;
  for (var wordName in counted) {
    if (counted.hasOwnProperty(wordName)) {
      count++;
    }
  }
  return count;
}

function hasTodayAchievement() {
  return hasTodayStreakAchievement();
}

function recordTodayKnownPress(wordName) {
  if (wordName) {
    todayCommittedLearned[wordName] = true;
    persistTodayCommittedLearned();
  }
  markTodayAchieved();
  refreshLearnedCountDisplays(true);
}

function reconcileTodayAchievement(options) {
  options = options || {};
  var todayKey = getTodayJSTStr();

  if (hasTodayAchievement()) {
    markTodayAchieved();
  } else if (options.allowUnmarkToday) {
    delete localAchievedDates[todayKey];
    if (!hasTodayStreakAchievement()) {
      delete initialLearnedDatesMap[todayKey];
    }
    persistAchievedDates();
  }

  refreshLearnedCountDisplays(true);
}

function persistAchievedDates() {
  localStorage.setItem(getStorageKey("saved_achieved_dates"), JSON.stringify(localAchievedDates));
}

function markTodayAchieved() {
  var todayKey = getTodayJSTStr();
  localAchievedDates[todayKey] = true;
  initialLearnedDatesMap[todayKey] = true;
  persistAchievedDates();
}

function buildLearnedDatesMap() {
  var map = {};
  var todayKey = getTodayJSTStr();

  for (var dKey in serverLearnedDatesMap) {
    if (serverLearnedDatesMap.hasOwnProperty(dKey) && dKey !== todayKey) {
      map[dKey] = true;
    }
  }

  if (hasTodayStreakAchievement()) {
    map[todayKey] = true;
  }

  return map;
}

// 昨日までの連続達成日数（サーバー記録のみ。今日の達成は含めない）
function getYesterdayStreakCount() {
  var map = {};
  var todayKey = getTodayJSTStr();

  for (var dKey in serverLearnedDatesMap) {
    if (serverLearnedDatesMap.hasOwnProperty(dKey) && dKey !== todayKey) {
      map[dKey] = true;
    }
  }

  return countStreakEndingAt(map, shiftJSTDateStr(todayKey, -1));
}

function shouldKeepTodayCommittedWord(wordName) {
  if (postInFlightWords[wordName]) {
    if (localLearnedOverrides.hasOwnProperty(wordName)) {
      return localLearnedOverrides[wordName] === true;
    }
    return true;
  }
  if (pendingChecks.hasOwnProperty(wordName)) {
    return pendingChecks[wordName] === true;
  }
  if (localLearnedOverrides.hasOwnProperty(wordName)) {
    return localLearnedOverrides[wordName] === true;
  }

  var word = findWordByKey(wordName);
  return !!(word && word.isLearned);
}

function syncTodayCommittedLearnedWithServer() {
  var candidates = {};
  var persistedToday = loadTodayCommittedLearned();

  for (var savedName in persistedToday) {
    if (persistedToday.hasOwnProperty(savedName)) {
      candidates[savedName] = true;
    }
  }

  for (var wordName in todayCommittedLearned) {
    if (todayCommittedLearned.hasOwnProperty(wordName)) {
      candidates[wordName] = true;
    }
  }

  for (var pendingName in pendingChecks) {
    if (!pendingChecks.hasOwnProperty(pendingName)) continue;
    if (pendingChecks[pendingName]) {
      candidates[pendingName] = true;
    }
  }

  var synced = {};
  for (var candidateName in candidates) {
    if (!candidates.hasOwnProperty(candidateName)) continue;
    if (shouldKeepTodayCommittedWord(candidateName)) {
      synced[candidateName] = true;
    }
  }

  todayCommittedLearned = synced;
  persistTodayCommittedLearned();
}

function syncAchievementCachesFromServer() {
  syncTodayCommittedLearnedWithServer();
  pruneStaleTodayCommittedIfNeeded();

  var todayKey = getTodayJSTStr();
  var keepTodayAchieved = hasTodayStreakAchievement();

  localAchievedDates = {};

  if (keepTodayAchieved && !serverLearnedDatesMap[todayKey]) {
    localAchievedDates[todayKey] = true;
  }
  persistAchievedDates();

  for (var wordName in localLearnedOverrides) {
    if (!localLearnedOverrides.hasOwnProperty(wordName)) continue;
    if (postInFlightWords[wordName]) continue;

    var target = findWordByKey(wordName);
    if (!target) {
      delete localLearnedOverrides[wordName];
      continue;
    }

    delete localLearnedOverrides[wordName];
  }
  persistLocalLearnedOverrides();
}

// れんぞく達成 = 今日を含む連続達成日数（今日未達成なら昨日までで計算）
function getStreakCount() {
  refreshDailyBoundariesIfNeeded();

  var todayKey = getTodayJSTStr();
  var learnedMap = buildLearnedDatesMap();
  var endKey = learnedMap[todayKey] ? todayKey : shiftJSTDateStr(todayKey, -1);

  return countStreakEndingAt(learnedMap, endKey);
}

function setDailyStatValue(el, count, unit) {
  if (!el) return;
  el.innerHTML = count + '<span class="daily-stat-unit"> ' + unit + '</span>';
}

function refreshStreakDisplay() {
  var streakEl = document.getElementById("valStreak");
  setDailyStatValue(streakEl, getStreakCount(), "日");
}

function refreshTodayLearnedDisplay() {
  var todayEl = document.getElementById("valTodayWords");
  setDailyStatValue(todayEl, getTodayLearnedCount(), "語");
}

function shiftJSTDateStr(dateStr, days) {
  var parts = dateStr.split("-").map(Number);
  var shifted = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  var y = shifted.getUTCFullYear();
  var m = ("0" + (shifted.getUTCMonth() + 1)).slice(-2);
  var d = ("0" + shifted.getUTCDate()).slice(-2);
  return y + "-" + m + "-" + d;
}

function countStreakEndingAt(learnedMap, endDateStr) {
  var streakCount = 0;
  var cursor = endDateStr;

  while (learnedMap[cursor]) {
    streakCount++;
    cursor = shiftJSTDateStr(cursor, -1);
  }

  return streakCount;
}

function refreshDailyStatsIfNeeded() {
  refreshLearnedCountDisplays(true);
}

function refreshLearnedCountDisplays(refreshRoadmapFully) {
  if (uiState.mode === "learn") {
    updateLiveHeader();
  }

  var totalEl = document.getElementById("valTotalWords");
  if (totalEl) {
    setDailyStatValue(totalEl, getLiveTotalLearnedCount(), "語");
  }

  refreshStreakDisplay();
  refreshTodayLearnedDisplay();

  if (refreshRoadmapFully && uiState.mode === "daily") {
    renderRoadmap();
  }
}

function persistUiState() {
  localStorage.setItem(getStorageKey("saved_main_mode"), uiState.mode);
  localStorage.setItem(getStorageKey("saved_learn_cat"), uiState.learnCat);
}

function getWordChecked(wordItem) {
  var wordName = getWordKey(wordItem);
  if (!wordName) return false;
  if (pendingChecks.hasOwnProperty(wordName)) {
    return pendingChecks[wordName];
  }
  if (localLearnedOverrides.hasOwnProperty(wordName)) {
    return !!localLearnedOverrides[wordName];
  }
  return !!wordItem.isLearned;
}

function countCheckedWords(filterFn) {
  var count = 0;
  for (var i = 0; i < allWordsList.length; i++) {
    var wordItem = allWordsList[i];
    if (!filterFn || filterFn(wordItem)) {
      if (getWordChecked(wordItem)) {
        count++;
      }
    }
  }
  return count;
}

function getTodayJSTStr() {
  return formatJSTDateStr();
}

function formatJSTDateStr(fromDate) {
  var base = fromDate ? new Date(fromDate.getTime()) : new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(base);
}

function getNextSmallGoal(catName, currentCount, maxCount) {
  var goals = SMALL_GOALS[catName] || [];
  for (var i = 0; i < goals.length; i++) {
    if (goals[i] > currentCount && goals[i] < maxCount) {
      return goals[i];
    }
  }
  return maxCount;
}

function getCategoryWordPoolStatus(catName) {
  if (catName === LEARN_MODE_AUTO) {
    if (!allWordsList.length) {
      return "empty";
    }
    for (var i = 0; i < allWordsList.length; i++) {
      if (!getWordChecked(allWordsList[i])) {
        return "ok";
      }
    }
    return "all_learned";
  }

  var words = getCategoryWords(catName);
  if (!words.length) {
    return "empty";
  }
  for (var j = 0; j < words.length; j++) {
    if (!getWordChecked(words[j])) {
      return "ok";
    }
  }
  return "all_learned";
}

function getFlashSessionEmptyMessage(catName) {
  var status = getCategoryWordPoolStatus(catName);
  if (status === "all_learned") {
    return "すべて 学習しました";
  }
  return "単語がありません";
}

function isFlashCompleteAllLearned() {
  var catName = flashSession.cat || uiState.learnCat;
  return getCategoryWordPoolStatus(catName) === "all_learned";
}

function updateFlashCompleteButtonsVisibility() {
  var hideButtons = flashSession.wordNames.length === 0 && isFlashCompleteAllLearned();
  var finishBtn = document.getElementById("flashFinishBtn");
  var restartBtn = document.getElementById("flashRestartBtn");
  var completeBtns = document.querySelector(".flash-complete-btns");
  if (finishBtn) finishBtn.hidden = hideButtons;
  if (restartBtn) restartBtn.hidden = hideButtons;
  if (completeBtns) completeBtns.hidden = hideButtons;
}

function loadFlashCategoryCursors() {
  try {
    var parsed = JSON.parse(localStorage.getItem(getStorageKey("flash_category_cursors_v1")) || "{}");
    var migrated = migrateFlashCursorMap(parsed);
    if (migrated.changed) {
      saveFlashCategoryCursors(migrated.map);
    }
    return migrated.map;
  } catch (e) {
    return {};
  }
}

function saveFlashCategoryCursors(cursors) {
  localStorage.setItem(getStorageKey("flash_category_cursors_v1"), JSON.stringify(cursors));
}

function parseFlashCursorEntry(raw) {
  if (typeof raw === "number" && isFinite(raw)) {
    return { i: Math.floor(raw), t: 0 };
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (typeof raw.i !== "number" || !isFinite(raw.i)) {
    return null;
  }
  var updatedAt = raw.t;
  if (typeof updatedAt !== "number" || !isFinite(updatedAt)) {
    updatedAt = 0;
  }
  return { i: Math.floor(raw.i), t: updatedAt };
}

function migrateFlashCursorMap(raw) {
  var map = {};
  var changed = false;
  if (!raw || typeof raw !== "object") {
    return { map: map, changed: false };
  }

  CATEGORIES.forEach(function (catName) {
    var value = raw[catName];
    if (typeof value === "number" && isFinite(value)) {
      map[catName] = { i: Math.floor(value), t: Date.now() };
      changed = true;
      return;
    }
    var entry = parseFlashCursorEntry(value);
    if (entry) {
      map[catName] = entry;
    }
  });

  return { map: map, changed: changed };
}

function getFlashCursorEntry(cursors, catName) {
  return parseFlashCursorEntry(cursors[catName]);
}

function scheduleFlashCursorsSync() {
  clearTimeout(flashCursorsSendTimer);
  flashCursorsSendTimer = setTimeout(function () {
    flashCursorsSendTimer = null;
    sendFlashCursorsToServer();
  }, 400);
}

function flushFlashCursorsNow() {
  clearTimeout(flashCursorsSendTimer);
  flashCursorsSendTimer = null;
  sendFlashCursorsToServer();
}

function sendFlashCursorsToServer() {
  var cursors = loadFlashCategoryCursors();
  if (!Object.keys(cursors).length) {
    return Promise.resolve();
  }

  var postPayload = {
    action: "saveCursors",
    cursors: cursors
  };
  if (isTestDeploy()) {
    postPayload.env = "test";
  }

  flashCursorsSendPromise = flashCursorsSendPromise
    .then(function () {
      return fetch(getApiUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(postPayload),
        keepalive: true
      }).then(function (res) {
        if (!res.ok) {
          throw new Error("Cursor POST failed: " + res.status);
        }
      });
    })
    .catch(function (err) {
      console.error("しおり同期エラー:", err);
    });

  return flashCursorsSendPromise;
}

function applyServerFlashCursors(serverCursors) {
  var incoming = serverCursors || {};
  var local = loadFlashCategoryCursors();
  var changed = false;

  CATEGORIES.forEach(function (catName) {
    var serverEntry = parseFlashCursorEntry(incoming[catName]);
    if (!serverEntry) {
      return;
    }
    var localEntry = getFlashCursorEntry(local, catName);
    if (!localEntry || serverEntry.t > localEntry.t) {
      local[catName] = serverEntry;
      changed = true;
    }
  });

  if (changed) {
    saveFlashCategoryCursors(local);
  }
}

function findFirstUncheckedCategoryIndex(words) {
  for (var i = 0; i < words.length; i++) {
    if (!getWordChecked(words[i])) {
      return i;
    }
  }
  return 0;
}

function getCategoryCursorIndex(catName) {
  var words = getCategoryWords(catName);
  if (!words.length) {
    return 0;
  }

  var cursors = loadFlashCategoryCursors();
  var entry = getFlashCursorEntry(cursors, catName);
  if (!entry || entry.i < 0 || entry.i >= words.length) {
    cursors[catName] = {
      i: findFirstUncheckedCategoryIndex(words),
      t: 0
    };
    saveFlashCategoryCursors(cursors);
    return cursors[catName].i;
  }
  return entry.i;
}

function setCategoryCursorIndex(catName, index) {
  var words = getCategoryWords(catName);
  if (!words.length) {
    return;
  }
  var normalized = ((index % words.length) + words.length) % words.length;
  var cursors = loadFlashCategoryCursors();
  cursors[catName] = { i: normalized, t: Date.now() };
  saveFlashCategoryCursors(cursors);
  scheduleFlashCursorsSync();
}

function pickWordNamesFromCategory(catName, count, usedNames) {
  var words = getCategoryWords(catName);
  if (!words.length || getCategoryWordPoolStatus(catName) !== "ok") {
    return [];
  }

  var used = usedNames || null;
  var cursor = getCategoryCursorIndex(catName);
  var names = [];
  var index = cursor;
  var scanned = 0;

  while (names.length < count && scanned < words.length) {
    var wordItem = words[index];
    var wordName = getWordKey(wordItem);
    if (wordName && !getWordChecked(wordItem) && (!used || !used[wordName])) {
      names.push(wordName);
      if (used) {
        used[wordName] = true;
      }
    }
    index = (index + 1) % words.length;
    scanned++;
  }

  return names;
}

function getCategoryWordIndex(catName, wordName) {
  if (!wordName) {
    return -1;
  }
  var words = getCategoryWords(catName);
  for (var i = 0; i < words.length; i++) {
    if (getWordKey(words[i]) === wordName) {
      return i;
    }
  }
  return -1;
}

function advanceCategoryCursorPastWord(item) {
  if (!item) {
    return null;
  }
  var catName = getWordCategoryKey(item);
  var wordIndex = getCategoryWordIndex(catName, getWordKey(item));
  if (wordIndex < 0) {
    return null;
  }
  var cursorBefore = getCategoryCursorIndex(catName);
  setCategoryCursorIndex(catName, wordIndex + 1);
  return { cat: catName, before: cursorBefore };
}

function isAutoLearnMode() {
  return uiState.learnCat === LEARN_MODE_AUTO;
}

function getFlashThemeCat(item) {
  if (isAutoLearnMode() && item) {
    return getWordCategoryKey(item) || LEARN_MODE_AUTO;
  }
  return uiState.learnCat;
}

function getFlashWordItemAtIndex(index) {
  if (index < 0 || index >= flashSession.wordNames.length) {
    return null;
  }
  var wordName = flashSession.wordNames[index];
  return allWordsList.find(function (w) { return getWordKey(w) === wordName; }) || null;
}

function getFlashProgressDotColor(item) {
  return themeColors[getFlashThemeCat(item)] || "#64748B";
}

function getLearnModeLabel(catName) {
  if (catName === LEARN_MODE_AUTO) {
    return "おまかせ";
  }
  return catName;
}

// すべてモード: 基本2・介護1・医療1・社会1を優先。不足分は基本→介護→医療→社会の順で補充し最大5題。
function buildAutoFlashSessionWordNames() {
  var names = [];
  var used = {};

  CATEGORIES.forEach(function (catName) {
    var count = AUTO_SESSION_PLAN[catName] || 0;
    if (count > 0) {
      names = names.concat(pickWordNamesFromCategory(catName, count, used));
    }
  });

  while (names.length < FLASH_SESSION_SIZE) {
    var added = false;
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (names.length >= FLASH_SESSION_SIZE) {
        break;
      }
      var picked = pickWordNamesFromCategory(CATEGORIES[i], 1, used);
      if (picked.length > 0) {
        names.push(picked[0]);
        added = true;
      }
    }
    if (!added) {
      break;
    }
  }

  return names;
}

function buildFlashSessionWordNames(catName) {
  if (catName === LEARN_MODE_AUTO) {
    return buildAutoFlashSessionWordNames();
  }
  return pickWordNamesFromCategory(catName, FLASH_SESSION_SIZE);
}

function startFlashSession(catName, forceNew) {
  var sameOngoingSession =
    !forceNew &&
    allWordsList.length > 0 &&
    flashSession.cat === catName &&
    flashSession.wordNames.length > 0 &&
    !flashSession.completed;

  if (sameOngoingSession) {
    return;
  }

  clearFlashCompleteCopyCache();
  flashSession.cat = catName;
  flashSession.wordNames = buildFlashSessionWordNames(catName);
  flashSession.initialCount = flashSession.wordNames.length;
  flashSession.index = 0;
  flashSession.revealed = false;
  flashSession.advancing = false;
  flashSession.completed = flashSession.wordNames.length === 0;
  flashSession.answerLog = [];
  persistFlashSession();
}

function getCurrentFlashWordItem() {
  if (flashSession.completed || flashSession.index >= flashSession.wordNames.length) {
    return null;
  }

  var wordName = flashSession.wordNames[flashSession.index];
  return allWordsList.find(function (w) { return getWordKey(w) === wordName; }) || null;
}

function resetFlashcardView() {
  flashSession.revealed = false;
  flashSession.advancing = false;
  clearFlashcardAnswer();
  setFlashRevealState(false);
}

function markLearnDataReady() {
  learnDataReady = true;
  flashInteractionReady = false;
  window.setTimeout(function () {
    flashInteractionReady = true;
    updateFlashAnswerButtonsVisibility();
  }, 400);
}

function isFlashCompleteLocked() {
  return uiState.mode === "learn" &&
    flashSession.completed &&
    flashSession.initialCount > 0;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setFlashAnswerButtonsBusy(isBusy) {
  var answerBtns = document.getElementById("flashAnswerBtns");
  if (answerBtns) {
    answerBtns.classList.toggle("is-busy", !!isBusy);
  }
  updateFlashAnswerButtonsVisibility();
  updateFlashUndoButton();
}

function updateFlashAnswerButtonsVisibility() {
  var answerBtns = document.getElementById("flashAnswerBtns");
  var revealBtn = document.getElementById("flashRevealBtn");
  if (!answerBtns) return;

  var inStudy = !flashSession.completed && flashSession.wordNames.length > 0;
  var showAnswer = inStudy && flashSession.revealed;

  answerBtns.hidden = !showAnswer;

  if (revealBtn) {
    revealBtn.hidden = !inStudy || flashSession.revealed;
    revealBtn.disabled = !flashInteractionReady || flashSession.advancing;
  }
}

function clearFlashcardAnimationState() {
  var card = document.getElementById("flashcard");
  if (!card) return;

  card.style.transition = "none";
  card.classList.remove("is-leaving-known", "is-leaving-skip", "is-arriving", "is-arriving-prep");
  card.style.removeProperty("opacity");
  card.style.removeProperty("transform");
  card.style.removeProperty("transform-origin");
  card.style.removeProperty("animation");
  card.style.removeProperty("overflow");
  void card.offsetWidth;
  card.style.removeProperty("transition");
}

function playKnownHapticFeedback() {
  if (prefersReducedMotion() || !navigator.vibrate) return;
  try {
    navigator.vibrate(10);
  } catch (e) {}
}

function runKnownButtonBounce(btn) {
  if (!btn) return;
  playKnownHapticFeedback();
  if (btn.animate) {
    btn.style.transition = "none";
    btn.animate([
      { transform: "scale(0.94)", filter: "brightness(1)", boxShadow: "0 4px 16px rgba(15, 23, 42, 0.14)" },
      { transform: "scale(1.1)", filter: "brightness(1.12)", boxShadow: "0 6px 22px rgba(132, 204, 22, 0.42)" },
      { transform: "scale(1)", filter: "brightness(1)", boxShadow: "0 4px 16px rgba(15, 23, 42, 0.14)" }
    ], {
      duration: 300,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
    }).onfinish = function () {
      btn.style.removeProperty("transition");
    };
    return;
  }
  btn.classList.remove("is-known-bounce");
  void btn.offsetWidth;
  btn.classList.add("is-known-bounce");
  window.setTimeout(function () {
    btn.classList.remove("is-known-bounce");
  }, 280);
}

function runUnknownButtonBounce(btn) {
  if (!btn) return;
  playKnownHapticFeedback();
  if (btn.animate) {
    btn.style.transition = "none";
    btn.animate([
      { transform: "scale(0.94)", filter: "brightness(1)", boxShadow: "0 4px 16px rgba(15, 23, 42, 0.14)" },
      { transform: "scale(1.1)", filter: "brightness(1.12)", boxShadow: "0 6px 22px rgba(56, 189, 248, 0.42)" },
      { transform: "scale(1)", filter: "brightness(1)", boxShadow: "0 4px 16px rgba(15, 23, 42, 0.14)" }
    ], {
      duration: 300,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
    }).onfinish = function () {
      btn.style.removeProperty("transition");
    };
    return;
  }
  btn.classList.remove("is-unknown-bounce");
  void btn.offsetWidth;
  btn.classList.add("is-unknown-bounce");
  window.setTimeout(function () {
    btn.classList.remove("is-unknown-bounce");
  }, 280);
}

function runKnownDotPop(dot, color) {
  if (!dot) return;
  var dotColor = color || themeColors["基本"];
  dot.style.transition = "none";
  dot.style.removeProperty("transform");
  dot.style.backgroundColor = "transparent";
  dot.style.borderColor = "var(--learn-color-progress-upcoming)";
  void dot.offsetWidth;
  dot.style.backgroundColor = dotColor;
  dot.style.borderColor = dotColor;
  if (dot.animate) {
    dot.animate([
      { transform: "scale(1)" },
      { transform: "scale(1.35)" },
      { transform: "scale(1)" }
    ], {
      duration: 280,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
    });
  } else {
    dot.classList.remove("is-pop-known");
    void dot.offsetWidth;
    dot.classList.add("is-pop-known");
  }
  window.setTimeout(function () {
    dot.classList.remove("is-pop-known");
    dot.style.removeProperty("transform");
    dot.style.transition = "background-color 0.22s ease, border-color 0.22s ease";
    dot.style.backgroundColor = dotColor;
    dot.style.borderColor = dotColor;
  }, 280);
}

function flashButtonPressFeedback(markLearned) {
  var btnId = markLearned ? "flashKnownBtn" : "flashUnknownBtn";
  var btn = document.getElementById(btnId);
  if (!btn) return;

  if (markLearned) {
    runKnownButtonBounce(btn);
    return;
  }

  runUnknownButtonBounce(btn);
}

function playFlashAdvanceFeedback(markLearned, done) {
  var card = document.getElementById("flashcard");
  var dotsEl = document.getElementById("flashProgressDots");
  var currentDot = dotsEl ? dotsEl.children[flashSession.index] : null;
  var duration = prefersReducedMotion()
    ? 520
    : (markLearned ? FLASH_EXIT_KNOWN_MS : FLASH_EXIT_SKIP_MS);

  if (!card) {
    if (done) done();
    return;
  }

  flashButtonPressFeedback(markLearned);
  clearFlashcardAnimationState();

  if (currentDot) {
    var feedbackItem = getCurrentFlashWordItem();
    var dotColor = getFlashProgressDotColor(feedbackItem);
    if (markLearned) {
      runKnownDotPop(currentDot, dotColor);
    } else {
      currentDot.style.transition = "background-color 0.18s ease, border-color 0.18s ease";
      currentDot.style.backgroundColor = dotColor;
      currentDot.style.borderColor = dotColor;
    }
  }

  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      card.classList.add(markLearned ? "is-leaving-known" : "is-leaving-skip");
    });
  });

  window.setTimeout(function () {
    window.setTimeout(function () {
      if (done) done();
    }, FLASH_EXIT_GAP_MS);
  }, duration);
}

function playFlashcardEnterAnimation() {
  if (prefersReducedMotion()) return;

  var card = document.getElementById("flashcard");
  if (!card) return;

  clearFlashcardAnimationState();
  card.classList.add("is-arriving-prep");
  void card.offsetWidth;
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      card.classList.remove("is-arriving-prep");
      card.classList.add("is-arriving");
    });
  });
  window.setTimeout(function () {
    card.classList.remove("is-arriving");
  }, 340);
}

function updateFlashProgressDots() {
  var progressEl = document.getElementById("flashProgress");
  var dotsEl = document.getElementById("flashProgressDots");
  if (!progressEl || !dotsEl) return;

  if (flashSession.completed || flashSession.wordNames.length === 0) {
    progressEl.hidden = true;
    return;
  }

  var total = flashSession.initialCount || flashSession.wordNames.length || FLASH_SESSION_SIZE;
  var current = Math.min(flashSession.index + 1, total);
  progressEl.hidden = false;
  progressEl.setAttribute("aria-label", current + "つ目 / 全" + total + "つ");

  dotsEl.innerHTML = "";

  for (var i = 0; i < total; i++) {
    var dot = document.createElement("span");
    var wordItem = getFlashWordItemAtIndex(i);
    var dotColor = getFlashProgressDotColor(wordItem);
    dot.className = "flash-progress-dot";
    dot.setAttribute("aria-hidden", "true");
    if (i < flashSession.index) {
      dot.classList.add("is-done");
      dot.style.backgroundColor = dotColor;
      dot.style.borderColor = dotColor;
    } else if (i === flashSession.index) {
      dot.classList.add("is-current");
      dot.style.backgroundColor = dotColor;
      dot.style.borderColor = dotColor;
    } else {
      dot.classList.add("is-upcoming");
    }
    dotsEl.appendChild(dot);
  }

  updateFlashUndoButton();
}

function canUndoFlashcard() {
  if (!flashInteractionReady || flashSession.advancing) {
    return false;
  }
  if (!flashSession.answerLog.length || flashSession.wordNames.length === 0) {
    return false;
  }
  if (!flashSession.completed && flashSession.index === 0) {
    return false;
  }

  var lastEntry = flashSession.answerLog[flashSession.answerLog.length - 1];
  return !!(lastEntry && lastEntry.wordName);
}

function updateFlashUndoButton() {
  var studyBtn = document.getElementById("flashUndoBtn");
  var completeBtn = document.getElementById("flashUndoBtnComplete");
  var showUndo = canUndoFlashcard();
  var onComplete = flashSession.completed && flashSession.initialCount > 0;

  if (studyBtn) {
    var showStudy = showUndo && !onComplete;
    studyBtn.classList.toggle("is-unavailable", !showStudy);
    studyBtn.disabled = false;
  }
  if (completeBtn) {
    var showComplete = showUndo && onComplete;
    completeBtn.classList.toggle("is-unavailable", !showComplete);
    completeBtn.disabled = false;
  }
}

function captureFlashUndoSnapshot(wordName) {
  var item = findWordByKey(wordName);
  return {
    hadPendingCheck: pendingChecks.hasOwnProperty(wordName),
    pendingCheckValue: pendingChecks[wordName],
    wasInTodayCommitted: !!todayCommittedLearned[wordName],
    wasSkippedToday: !!todaySkippedWords[wordName],
    wasLearned: item ? getWordChecked(item) : false
  };
}

function revertFlashAnswer(entry) {
  var wordName = entry.wordName;
  var snap = entry.undoSnapshot;
  var item = findWordByKey(wordName);

  if (entry.markLearned) {
    if (snap.hadPendingCheck) {
      pendingChecks[wordName] = snap.pendingCheckValue;
    } else {
      delete pendingChecks[wordName];
    }

    if (item) {
      if (pendingChecks.hasOwnProperty(wordName)) {
        item.isLearned = pendingChecks[wordName];
      } else if (localLearnedOverrides.hasOwnProperty(wordName)) {
        item.isLearned = !!localLearnedOverrides[wordName];
      } else {
        item.isLearned = snap.wasLearned;
      }
    }

    if (!snap.wasInTodayCommitted) {
      delete todayCommittedLearned[wordName];
      persistTodayCommittedLearned();
    }

    reconcileTodayAchievement({ allowUnmarkToday: true });
  } else if (!snap.wasSkippedToday) {
    delete todaySkippedWords[wordName];
    persistTodaySkippedWords();
  }

  persistPendingChecksToStorage();
}

function undoFlashcard() {
  if (!canUndoFlashcard()) return;

  var entry = flashSession.answerLog.pop();
  if (!entry) return;

  flashSession.advancing = true;
  if (entry.wordName) {
    delete postInFlightWords[entry.wordName];
  }
  revertFlashAnswer(entry);
  if (entry.categoryCursorUndo) {
    setCategoryCursorIndex(entry.categoryCursorUndo.cat, entry.categoryCursorUndo.before);
  }
  flashSession.index = Math.max(0, flashSession.index - 1);
  flashSession.completed = false;
  flashSession.revealed = false;
  flashSession.advancing = false;

  updateFlashSessionUI();
  persistFlashSession();
  refreshLearnedCountDisplays(true);
}

function fillFlashcardAnswer(item) {
  var englishEl = document.getElementById("flashEnglish");
  var meaningEl = document.getElementById("flashMeaning");
  var exampleEl = document.getElementById("flashExample");
  var english = item.english || item.e || "";
  var meaning = formatMeaningText(item.meaning || item.m);
  var example = formatExampleText(item.example || item.x);

  englishEl.textContent = english;
  englishEl.classList.toggle("is-empty", !english);
  appendTextWithVocabularyRuby(meaningEl, meaning);
  meaningEl.classList.toggle("is-empty", !meaning);
  appendTextWithVocabularyRuby(exampleEl, example);
  exampleEl.classList.toggle("is-empty", !example);
}

function clearFlashcardAnswer() {
  ["flashEnglish", "flashMeaning", "flashExample"].forEach(function (id) {
    var el = document.getElementById(id);
    el.textContent = "";
    el.classList.add("is-empty");
  });
}

function resetFlashcardScroll() {
  var back = document.getElementById("flashcardBack");
  var front = document.querySelector(".flashcard-front");
  if (back) {
    back.scrollTop = 0;
  }
  if (front) {
    front.scrollTop = 0;
  }
}

function setFlashRevealState(isRevealed) {
  flashSession.revealed = isRevealed;

  var card = document.getElementById("flashcard");
  var back = document.getElementById("flashcardBack");
  if (!card || !back) return;

  back.setAttribute("aria-hidden", isRevealed ? "false" : "true");

  if (isRevealed) {
    card.classList.add("revealed");
    back.classList.add("is-revealed");
    back.setAttribute("aria-label", "答え");
  } else {
    card.classList.remove("revealed");
    back.classList.remove("is-revealed");
    back.removeAttribute("aria-label");
    resetFlashcardScroll();
  }

  updateFlashAnswerButtonsVisibility();
  updateFlashUndoButton();
}

function revealFlashcardAnswer() {
  if (!flashInteractionReady || flashSession.completed || flashSession.advancing) return;
  if (flashSession.revealed) return;

  var item = getCurrentFlashWordItem();
  if (!item) return;

  fillFlashcardAnswer(item);
  resetFlashcardScroll();
  setFlashRevealState(true);

  if (prefersReducedMotion()) {
    return;
  }

  var card = document.getElementById("flashcard");
  card.classList.remove("revealed");
  void card.offsetWidth;
  window.requestAnimationFrame(function () {
    card.classList.add("revealed");
  });
}

function resetFlashKnownBtnStyle() {
  var knownBtn = document.getElementById("flashKnownBtn");
  if (!knownBtn) return;
  knownBtn.style.removeProperty("background-color");
  knownBtn.style.removeProperty("border-color");
  knownBtn.style.removeProperty("color");
}

function renderFlashcardContent(item) {
  clearFlashcardAnimationState();

  document.getElementById("flashWord").textContent = getWordKey(item);
  var readingEl = document.getElementById("flashReading");
  var reading = item.ruby || item.r || "";
  readingEl.textContent = reading;
  readingEl.hidden = !reading;

  clearFlashcardAnswer();
  resetFlashKnownBtnStyle();
  resetFlashcardScroll();
}

var FLASH_COMPLETE_MESSAGES = [
  "やったね！！",
  "グッジョブ！！",
  "グッド！！",
  "いいね！！",
  "ナイス！！",
  "オッケー！！",
  "すばらしい！！",
  "その調子！！",
  "がんばってる！！",
  "いい感じ！！",
  "ナイストライ！！",
  "エクセレント！！",
  "イエス！！",
  "グッドワーク！！",
  "最高！！",
  "ばっちり！！",
  "天才！！",
  "ブラボー！！",
  "さすが！！",
];

var flashCompleteCopyCache = null;

function pickFlashCompleteMessage() {
  var index = Math.floor(Math.random() * FLASH_COMPLETE_MESSAGES.length);
  return FLASH_COMPLETE_MESSAGES[index];
}

function pickFlashCompleteColorCat() {
  var catName = flashSession.cat || uiState.learnCat;
  if (CATEGORIES.indexOf(catName) !== -1) {
    return catName;
  }
  var index = Math.floor(Math.random() * CATEGORIES.length);
  return CATEGORIES[index];
}

function buildFlashCompleteCopy() {
  return {
    message: pickFlashCompleteMessage(),
    colorCat: pickFlashCompleteColorCat(),
    restartLabel: "つづける"
  };
}

function clearFlashCompleteCopyCache() {
  flashCompleteCopyCache = null;
}

function getFlashCompleteCopy() {
  if (!flashCompleteCopyCache) {
    flashCompleteCopyCache = buildFlashCompleteCopy();
  }
  return flashCompleteCopyCache;
}

function applyFlashCompleteMessageColor(messageEl, colorCat) {
  if (!messageEl) return;
  if (colorCat) {
    messageEl.setAttribute("data-color-cat", colorCat);
  } else {
    messageEl.removeAttribute("data-color-cat");
  }
}

function setFlashCompleteRestartLabel(text) {
  var restartBtn = document.getElementById("flashRestartBtn");
  if (!restartBtn) return;
  var label = restartBtn.querySelector(".flash-circle-btn-label");
  if (label) {
    label.textContent = text;
  } else {
    restartBtn.textContent = text;
  }
}

function updateFlashCompleteUI() {
  var messageEl = document.getElementById("flashCompleteMessage");
  var detailEl = document.getElementById("flashCompleteDetail");
  var skipNoteEl = document.getElementById("flashCompleteSkipNote");
  if (!messageEl) return;

  if (flashSession.wordNames.length === 0) {
    var emptyCat = flashSession.cat || uiState.learnCat;
    var poolStatus = getCategoryWordPoolStatus(emptyCat);
    applyFlashCompleteMessageColor(messageEl, null);
    messageEl.textContent = getFlashSessionEmptyMessage(emptyCat);
    if (detailEl) {
      detailEl.textContent = "";
      detailEl.hidden = true;
    }
    if (skipNoteEl) {
      skipNoteEl.hidden = poolStatus === "all_learned";
    }
    setFlashCompleteRestartLabel("もう" + FLASH_SESSION_SIZE + "つ つづける");
    updateFlashCompleteButtonsVisibility();
    return;
  }

  var copy = getFlashCompleteCopy();

  applyFlashCompleteMessageColor(messageEl, copy.colorCat);
  messageEl.textContent = copy.message;
  setFlashCompleteRestartLabel(copy.restartLabel);

  if (skipNoteEl) {
    skipNoteEl.hidden = false;
  }

  updateFlashCompleteButtonsVisibility();

  if (!detailEl) return;

  detailEl.textContent = "";
  detailEl.hidden = true;
}

function updateFlashSessionUI(options) {
  options = options || {};
  var studyEl = document.getElementById("flashStudy");
  var completeEl = document.getElementById("flashComplete");
  var answerBtns = document.getElementById("flashAnswerBtns");
  var headerBanner = document.getElementById("learnHeaderBanner");
  var themeCat = getFlashThemeCat(getCurrentFlashWordItem());
  headerBanner.className = "learn-header-banner bg-" + themeCat;

  if (flashSession.completed || flashSession.wordNames.length === 0) {
    studyEl.hidden = true;
    completeEl.hidden = false;
    updateFlashProgressDots();
    answerBtns.hidden = true;
    var revealBtn = document.getElementById("flashRevealBtn");
    if (revealBtn) revealBtn.hidden = true;
    updateFlashCompleteUI();
    updateFlashCompleteButtonsVisibility();

    updateLiveHeader();
    updateCategoryTabsUI();
    updateFlashUndoButton();
    updateFlashAnswerButtonsVisibility();
    return;
  }

  studyEl.hidden = false;
  completeEl.hidden = true;
  clearFlashCompleteCopyCache();
  updateFlashProgressDots();
  updateLiveHeader();
  updateCategoryTabsUI();

  var item = getCurrentFlashWordItem();
  if (!item) {
    var currentName = flashSession.wordNames[flashSession.index];
    if (currentName && allWordsList.length > 0) {
      return;
    }
    flashSession.completed = true;
    updateFlashSessionUI();
    return;
  }

  var preserveRevealed = !!options.preserveRevealed && flashSession.revealed;
  clearFlashcardAnimationState();
  renderFlashcardContent(item);
  if (preserveRevealed) {
    fillFlashcardAnswer(item);
  }
  setFlashRevealState(preserveRevealed);

  if (options.animateEnter) {
    playFlashcardEnterAnimation();
  }

  updateFlashAnswerButtonsVisibility();
  updateFlashUndoButton();
}

function advanceFlashcard(markLearned) {
  if (flashSession.advancing || flashSession.completed) return;
  if (!flashSession.revealed) return;

  var item = getCurrentFlashWordItem();
  if (!item) return;

  flashSession.advancing = true;
  setFlashAnswerButtonsBusy(true);

  var wordName = getWordKey(item);
  var undoSnapshot = captureFlashUndoSnapshot(wordName);
  var categoryCursorUndo = advanceCategoryCursorPastWord(item);
  if (markLearned && wordName) {
    applyKnownWordState(wordName);
  }

  flashSession.answerLog.push({
    wordName: wordName,
    markLearned: markLearned,
    undoSnapshot: undoSnapshot,
    categoryCursorUndo: categoryCursorUndo
  });

  playFlashAdvanceFeedback(markLearned, function () {
    flashSession.index++;
    flashSession.revealed = false;

    if (flashSession.index >= flashSession.wordNames.length) {
      flashSession.completed = true;
    }

    flashSession.advancing = false;
    setFlashAnswerButtonsBusy(false);
    updateFlashSessionUI({
      animateEnter: !flashSession.completed
    });
    persistFlashSession();
  });
}

function restartFlashSession() {
  flushPendingChecksNow();
  startFlashSession(uiState.learnCat, true);
  updateFlashSessionUI();
}

function finishFlashSession() {
  if (!flashSession.completed || flashSession.initialCount === 0) return;
  flushPendingChecksNow();
  resetFlashcardView();
  startFlashSession(uiState.learnCat, true);
  persistFlashSession();
  switchMainMode("daily");
}

function getWordKey(item) {
  return item.word || item.w || "";
}

function findWordByKey(wordName) {
  if (!wordName) return null;
  for (var i = 0; i < allWordsList.length; i++) {
    if (getWordKey(allWordsList[i]) === wordName) {
      return allWordsList[i];
    }
  }
  return null;
}

function applyKnownWordState(wordName) {
  if (!wordName) return;

  pendingChecks[wordName] = true;
  persistPendingChecksToStorage();
  var item = findWordByKey(wordName);
  if (item) {
    item.isLearned = true;
  }
  recordTodayKnownPress(wordName);
}

function getWordCategoryKey(item) {
  return item.category || item.c || "";
}

function getCategoryWords(catName) {
  var list = allWordsList.filter(function (w) {
    return getWordCategoryKey(w) === catName;
  });
  list.sort(function (a, b) {
    return (a.originalIndex || 0) - (b.originalIndex || 0);
  });

  return list;
}

function getCategoryLearnedCount(catName) {
  return allWordsList.filter(function (w) {
    return w.category === catName && w.isLearned;
  }).length;
}

function getLiveCategoryLearnedCount(catName) {
  return countCheckedWords(function (w) {
    return w.category === catName;
  });
}

function getTotalLearnedCount() {
  return allWordsList.filter(function (w) {
    return w.isLearned;
  }).length;
}

function getLiveTotalLearnedCount() {
  return countCheckedWords();
}

function rollbackPendingCommit(snapshot, committedSnapshot, wordsToCommit) {
  wordsToCommit.forEach(function (wordName) {
    delete postInFlightWords[wordName];
    pendingChecks[wordName] = snapshot[wordName];
    localLearnedOverrides[wordName] = snapshot[wordName];
  });
  todayCommittedLearned = committedSnapshot;
  persistTodayCommittedLearned();
  persistLocalLearnedOverrides();
  persistPendingChecksToStorage();
  reconcileTodayAchievement({ allowUnmarkToday: true });
  refreshLearnedCountDisplays(false);
  if (uiState.mode === "learn") {
    refreshFlashSessionAfterDataLoad();
  } else if (uiState.mode === "search") {
    onSearchFilterChanged();
  }
}

function applyLocalLearnedSnapshot(snapshot) {
  for (var wordName in snapshot) {
    if (!snapshot.hasOwnProperty(wordName)) continue;
    var item = findWordByKey(wordName);
    if (item) {
      item.isLearned = !!snapshot[wordName];
    }
  }
}

function mergePendingAndOverrideLearnedState() {
  for (var i = 0; i < allWordsList.length; i++) {
    var wordName = getWordKey(allWordsList[i]);
    if (!wordName) continue;
    if (pendingChecks.hasOwnProperty(wordName)) {
      allWordsList[i].isLearned = pendingChecks[wordName];
    } else if (localLearnedOverrides.hasOwnProperty(wordName)) {
      allWordsList[i].isLearned = !!localLearnedOverrides[wordName];
    }
  }
}

function scheduleSearchCheckSync() {
  clearTimeout(searchCheckSendTimer);
  searchCheckSendTimer = setTimeout(function () {
    searchCheckSendTimer = null;
    applyAndSendPendingChecks();
  }, 180);
}

function flushPendingChecksNow() {
  clearTimeout(searchCheckSendTimer);
  searchCheckSendTimer = null;
  applyAndSendPendingChecks();
}

function finalizeCommittedChecks(wordsToCommit) {
  wordsToCommit.forEach(function (wordName) {
    delete postInFlightWords[wordName];
    delete localLearnedOverrides[wordName];
  });
  persistLocalLearnedOverrides();
}

function applyAndSendPendingChecks() {
  pendingChecksSendPromise = pendingChecksSendPromise
    .then(flushPendingChecksOnce)
    .then(function (sentChecks) {
      if (!sentChecks) {
        return sendFlashCursorsToServer();
      }
    })
    .catch(function (err) {
      console.error("チェック同期エラー:", err);
    });
}

function flushPendingChecksOnce() {
  var wordsToCommit = Object.keys(pendingChecks);
  if (wordsToCommit.length === 0) {
    return Promise.resolve(false);
  }

  var checkedWords = [];
  var uncheckedWords = [];
  var snapshot = {};
  wordsToCommit.forEach(function (wordName) {
    snapshot[wordName] = pendingChecks[wordName];
  });

  wordsToCommit.forEach(function (wordName) {
    if (pendingChecks[wordName]) {
      checkedWords.push(wordName);
    } else {
      uncheckedWords.push(wordName);
    }
  });

  pendingChecks = {};
  persistPendingChecksToStorage();

  var committedSnapshot = {};
  for (var key in todayCommittedLearned) {
    if (todayCommittedLearned.hasOwnProperty(key)) {
      committedSnapshot[key] = true;
    }
  }

  checkedWords.forEach(function (wordName) {
    todayCommittedLearned[wordName] = true;
  });
  uncheckedWords.forEach(function (wordName) {
    delete todayCommittedLearned[wordName];
  });
  persistTodayCommittedLearned();
  reconcileTodayAchievement({ allowUnmarkToday: true });

  wordsToCommit.forEach(function (wordName) {
    localLearnedOverrides[wordName] = snapshot[wordName];
    postInFlightWords[wordName] = true;
  });
  persistLocalLearnedOverrides();
  refreshLearnedCountDisplays(false);

  var postPayload = {
    category: uiState.learnCat,
    checkedWords: checkedWords,
    uncheckedWords: uncheckedWords,
    currentWords: [],
    cursors: loadFlashCategoryCursors()
  };
  if (isTestDeploy()) {
    postPayload.env = "test";
  }

  return fetch(getApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(postPayload),
    keepalive: true
  }).then(function (res) {
    if (!res.ok) {
      throw new Error("POST failed: " + res.status);
    }
    return loadDataFromDB(false);
  }).then(function () {
    applyLocalLearnedSnapshot(snapshot);
    finalizeCommittedChecks(wordsToCommit);
    refreshLearnedCountDisplays(uiState.mode === "daily");
    if (uiState.mode === "learn") {
      refreshFlashSessionAfterDataLoad();
    } else if (uiState.mode === "search") {
      onSearchFilterChanged();
    }
    return flushPendingChecksOnce();
  }).catch(function (err) {
    rollbackPendingCommit(snapshot, committedSnapshot, wordsToCommit);
    console.error("DB送信エラー:", err);
    throw err;
  }).then(function () {
    return true;
  });
}

function loadDataFromDB(isInitial) {
  var usedCache = false;

  if (isInitial) {
    var cached = readWordsCache();
    if (cached) {
      usedCache = true;
      applyAppData(cached, { isInitial: true, fromCache: true });
    } else {
      showLoading(true);
    }
  }

  var fetchPromise = isInitial ? startBootPrefetch() : fetchAppData();

  return fetchPromise
    .then(function (res) {
      var payload = normalizeApiPayload(res);
      if (!payload.error) {
        writeWordsCache(payload);
      }
      return payload;
    })
    .then(function (res) {
      if (isInitial) {
        showLoading(false);
      }
      applyAppData(res, {
        isInitial: isInitial && !usedCache,
        fromCache: false
      });
    })
    .catch(function () {
      if (isInitial && !usedCache) {
        showLoading(false);
      }
      if (!allWordsList.length) {
        var headerBanner = document.getElementById("learnHeaderBanner");
        headerBanner.hidden = false;
        document.getElementById("learnHeaderText").textContent = "⚠️ 通信エラー: 再読み込みしてください";
      }
    });
}

function applyAppData(res, options) {
  options = options || {};

  if (res.error) {
    var headerBanner = document.getElementById("learnHeaderBanner");
    headerBanner.hidden = false;
    document.getElementById("learnHeaderText").textContent = "⚠️ " + res.error;
    return;
  }

  var rawWords = (res.allWords || []).map(normalizeWordItem);
  rawWords.forEach(function (w, idx) {
    w.originalIndex = idx;
  });
  allWordsList = rawWords;
  invalidateVocabularyRubyEntries();
  mergePendingAndOverrideLearnedState();
  if (!options.fromCache) {
    applyServerFlashCursors(res.cursors);
    scheduleFlashCursorsSync();
  }
  roadmapData = res.roadmap || {};

  serverLearnedDatesMap = {};
  initialLearnedDatesMap = {};
  (roadmapData.learnedDates || []).forEach(function (d) {
    serverLearnedDatesMap[d] = true;
    initialLearnedDatesMap[d] = true;
  });

  syncAchievementCachesFromServer();
  reconcileTodayAchievement();
  refreshLearnedCountDisplays(uiState.mode === "daily");
  updateSearchStatusBarPlaceholder();

  if (options.isInitial) {
    switchMainMode(uiState.mode, { deferSearchRender: uiState.mode === "search" });
    if (uiState.mode === "learn") {
      var hasRestoredSession =
        flashSession.wordNames.length > 0 &&
        flashSession.cat === uiState.learnCat;

      if (hasRestoredSession) {
        if (flashSession.completed) {
          updateFlashSessionUI();
        } else {
          refreshFlashSessionAfterDataLoad();
        }
      } else {
        renderCurrentLearnCat(true);
      }
      if (!learnDataReady) {
        resetFlashcardView();
      }
    }
    markLearnDataReady();
    return;
  }

  if (uiState.mode === "learn") {
    refreshFlashSessionAfterDataLoad();
  } else if (uiState.mode === "daily") {
    renderRoadmap();
  } else if (uiState.mode === "search") {
    onSearchFilterChanged();
  }
}

function updateSearchStatusBarPlaceholder() {
  if (uiState.mode === "search") return;
  document.getElementById("searchStatusBar").textContent = allWordsList.length + " 語";
}

function bindEvents() {
  document.querySelector(".learn-cat-row").addEventListener("click", function (e) {
    var btn = e.target.closest(".learn-tab-btn");
    if (!btn || !btn.dataset.cat) return;
    switchLearnCat(btn.dataset.cat);
  });

  document.getElementById("flashRevealBtn").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    revealFlashcardAnswer();
  });
  document.getElementById("flashKnownBtn").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    advanceFlashcard(true);
  });
  document.getElementById("flashUnknownBtn").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    advanceFlashcard(false);
  });
  document.getElementById("flashUndoBtn").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    undoFlashcard();
  });
  document.getElementById("flashUndoBtnComplete").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    undoFlashcard();
  });
  document.getElementById("flashRestartBtn").addEventListener("click", restartFlashSession);
  document.getElementById("flashFinishBtn").addEventListener("click", finishFlashSession);
  resetFlashKnownBtnStyle();

  document.getElementById("btnModeLearn").addEventListener("click", function () {
    switchMainMode("learn");
  });
  document.getElementById("btnModeDaily").addEventListener("click", function () {
    switchMainMode("daily");
  });
  document.getElementById("btnModeSearch").addEventListener("click", function () {
    switchMainMode("search");
  });

  document.getElementById("searchInput").addEventListener("input", scheduleSearchFilterFromInput);
  document.getElementById("searchInput").addEventListener("focus", showSearchChrome);

  document.getElementById("searchResultList").addEventListener("click", function (e) {
    var chkWrap = e.target.closest(".search-item-chk-wrap");
    if (!chkWrap) return;
    var row = chkWrap.closest(".search-item-row");
    if (!row || !row.dataset.word) return;
    e.stopPropagation();
    onSearchItemClick(row.dataset.word, row);
  });

  document.getElementById("chipLearned").addEventListener("click", function () {
    toggleStatusFilter("learned");
  });
  document.getElementById("chipUnlearned").addEventListener("click", function () {
    toggleStatusFilter("unlearned");
  });

  CATEGORIES.forEach(function (cat) {
    document.getElementById("chipCat-" + cat).addEventListener("click", function () {
      toggleCatCheckbox(cat);
    });
  });

  bindSearchChromeScroll();
}

function bootApp() {
  applyDeployEnvUI();
  loadUiState();
  updateViewportForMode(uiState.mode);
  bindEvents();
  updateCategoryTabsUI();
  loadDataFromDB(true);
}

function scheduleBootApp() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootApp);
  } else {
    bootApp();
  }
}

scheduleBootApp();

document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    flushFlashCursorsNow();
    return;
  }

  refreshDailyBoundariesIfNeeded();
  if (learnDataReady) {
    bootPrefetchPromise = null;
    loadDataFromDB(false);
  }
});

window.setInterval(function () {
  if (!document.hidden) {
    refreshDailyBoundariesIfNeeded();
  }
}, 60000);

window.addEventListener("pageshow", function (event) {
  refreshDailyBoundariesIfNeeded();

  if (!event.persisted || uiState.mode !== "learn" || flashSession.completed) {
    return;
  }

  resetFlashcardView();
  var item = getCurrentFlashWordItem();
  if (item) {
    renderFlashcardContent(item);
  }
});

startBootPrefetch();

function updateLearnModeClass() {
  var panelLearn = document.getElementById("panelLearn");
  if (!panelLearn) return;

  ["auto", "基本", "介護", "医療", "社会"].forEach(function (cat) {
    panelLearn.classList.remove("learn-mode-" + cat);
  });
  panelLearn.classList.add("learn-mode-" + uiState.learnCat);
}

function updateCategoryTabsUI() {
  var isAuto = isAutoLearnMode();
  var locked = isFlashCompleteLocked();
  var row = document.querySelector(".learn-cat-row");

  if (row) {
    row.classList.toggle("is-locked", locked);
  }

  document.querySelectorAll(".learn-cat-row .learn-tab-btn").forEach(function (btn) {
    var isAutoBtn = btn.dataset.cat === LEARN_MODE_AUTO;
    var isActive = isAutoBtn ? isAuto : (!isAuto && btn.dataset.cat === uiState.learnCat);
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.disabled = locked;
    btn.setAttribute("aria-disabled", locked ? "true" : "false");
  });

  updateLearnModeClass();
}

function updateViewportForMode(mode) {
  var meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  meta.setAttribute("content", mode === "search" ? VIEWPORT_SEARCH_ZOOMABLE : VIEWPORT_DEFAULT);
}

function switchMainMode(mode, options) {
  options = options || {};
  if ((mode === "daily" || mode === "search") && uiState.mode === "learn") {
    flushPendingChecksNow();
  }

  if (mode !== "search") {
    cancelDeferredSearchRender();
  }

  uiState.mode = mode;
  persistUiState();

  document.getElementById("btnModeLearn").classList.toggle("active", mode === "learn");
  document.getElementById("btnModeDaily").classList.toggle("active", mode === "daily");
  document.getElementById("btnModeSearch").classList.toggle("active", mode === "search");

  document.getElementById("panelLearn").classList.toggle("active", mode === "learn");
  document.getElementById("panelDaily").classList.toggle("active", mode === "daily");
  document.getElementById("panelSearch").classList.toggle("active", mode === "search");

  if (mode === "search") {
    bindSearchChromeScroll();
    if (options.deferSearchRender) {
      prepareSearchPanelForBoot();
    } else {
      onSearchFilterChanged();
    }
  } else {
    resetSearchChrome();
  }

  if (mode === "daily") {
    renderRoadmap();
  } else if (mode === "learn") {
    refreshFlashSessionAfterDataLoad();
    updateCategoryTabsUI();
  }

  refreshLearnedCountDisplays(mode === "daily");
  updateViewportForMode(mode);
}

function switchLearnCat(catName) {
  if (isFlashCompleteLocked()) return;

  catName = normalizeLearnCat(catName);
  if (catName === uiState.learnCat) {
    return;
  }

  uiState.learnCat = catName;
  persistUiState();
  updateCategoryTabsUI();

  // カテゴリ切替は常に新セット（1/5）から。途中進捗の復元はしない。
  resetFlashcardView();
  startFlashSession(catName, true);
  updateFlashSessionUI();
  persistFlashSession();
}

function formatMeaningText(text) {
  var cleaned = (text || "").toString().trim();
  if (!cleaned) return "";
  return cleaned.replace(/。/g, ".");
}

function formatExampleText(text) {
  var cleaned = (text || "").toString().trim();
  if (!cleaned) return "";
  cleaned = cleaned.replace(/。/g, "");
  if (cleaned.charAt(0) === "「" && cleaned.charAt(cleaned.length - 1) === "」") {
    return cleaned;
  }
  return "「" + cleaned + "」";
}

function invalidateVocabularyRubyEntries() {
  vocabularyRubyEntries = null;
}

function getVocabularyRubyEntries() {
  if (vocabularyRubyEntries) {
    return vocabularyRubyEntries;
  }

  var byWord = {};
  for (var i = 0; i < allWordsList.length; i++) {
    var item = allWordsList[i];
    var word = getWordKey(item);
    var ruby = (item.ruby || item.r || "").trim();
    if (!word || !ruby || word.length < MIN_VOCAB_RUBY_LENGTH) {
      continue;
    }
    if (!byWord[word]) {
      byWord[word] = ruby;
    }
  }

  vocabularyRubyEntries = Object.keys(byWord).map(function (word) {
    return {
      word: word,
      ruby: byWord[word]
    };
  }).sort(function (a, b) {
    return b.word.length - a.word.length;
  });

  return vocabularyRubyEntries;
}

function findVocabularyRubyMatches(text, entries) {
  if (!text || !entries.length) {
    return [];
  }

  var matches = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (text.indexOf(entry.word) === -1) {
      continue;
    }

    var searchFrom = 0;
    var pos = text.indexOf(entry.word, searchFrom);
    while (pos !== -1) {
      matches.push({
        start: pos,
        end: pos + entry.word.length,
        word: entry.word,
        ruby: entry.ruby
      });
      searchFrom = pos + 1;
      pos = text.indexOf(entry.word, searchFrom);
    }
  }

  matches.sort(function (a, b) {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return (b.end - b.start) - (a.end - a.start);
  });

  var accepted = [];
  var lastEnd = 0;
  for (var j = 0; j < matches.length; j++) {
    var match = matches[j];
    if (match.start < lastEnd) {
      continue;
    }
    accepted.push(match);
    lastEnd = match.end;
  }

  return accepted;
}

function appendTextWithVocabularyRuby(container, text) {
  container.textContent = "";
  if (!text) {
    return;
  }

  var entries = getVocabularyRubyEntries();
  var matches = findVocabularyRubyMatches(text, entries);
  if (!matches.length) {
    container.textContent = text;
    return;
  }

  var fragment = document.createDocumentFragment();
  var cursor = 0;

  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    if (m.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, m.start)));
    }

    var rubyEl = document.createElement("ruby");
    rubyEl.textContent = m.word;
    var rt = document.createElement("rt");
    rt.textContent = m.ruby;
    rubyEl.appendChild(rt);
    fragment.appendChild(rubyEl);
    cursor = m.end;
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  container.appendChild(fragment);
}

function buildWordTextBlocks(item) {
  var fragment = document.createDocumentFragment();

  var jaBlock = document.createElement("div");
  jaBlock.className = "word-ja-block";

  var titleRow = document.createElement("div");
  titleRow.className = "word-title-row";

  var headStack = document.createElement("div");
  headStack.className = "word-head-stack";

  var reading = document.createElement("div");
  reading.className = "word-reading";
  reading.textContent = item.ruby || "";
  if (!item.ruby) {
    reading.hidden = true;
  }
  headStack.appendChild(reading);

  var titleLine = document.createElement("div");
  titleLine.className = "word-title-line";

  var title = document.createElement("div");
  title.className = "word-title";
  title.textContent = item.word;
  titleLine.appendChild(title);

  var eng = document.createElement("div");
  eng.className = "word-english";
  eng.textContent = item.english;
  titleLine.appendChild(eng);

  headStack.appendChild(titleLine);
  titleRow.appendChild(headStack);

  jaBlock.appendChild(titleRow);
  fragment.appendChild(jaBlock);

  var meaning = formatMeaningText(item.meaning);
  if (meaning) {
    var meaningEl = document.createElement("div");
    meaningEl.className = "word-meaning";
    appendTextWithVocabularyRuby(meaningEl, meaning);
    fragment.appendChild(meaningEl);
  }

  var example = formatExampleText(item.example);
  if (example) {
    var exampleEl = document.createElement("div");
    exampleEl.className = "word-example";
    appendTextWithVocabularyRuby(exampleEl, example);
    fragment.appendChild(exampleEl);
  }

  return fragment;
}

function refreshFlashSessionAfterDataLoad() {
  // 完了画面表示中は、DB同期後も自動で次セットを始めない
  if (flashSession.completed) {
    return;
  }

  if (flashSession.cat !== uiState.learnCat) {
    renderCurrentLearnCat(true);
    return;
  }

  if (!flashSession.wordNames.length) {
    renderCurrentLearnCat(false);
    return;
  }

  var currentName = flashSession.wordNames[flashSession.index];
  if (
    currentName &&
    allWordsList.length > 0 &&
    !allWordsList.some(function (w) { return getWordKey(w) === currentName; })
  ) {
    return;
  }

  updateFlashSessionUI({ preserveRevealed: true });
}

function renderCurrentLearnCat(forceNewSession) {
  startFlashSession(uiState.learnCat, !!forceNewSession);
  updateFlashSessionUI();
}

function updateLiveHeader() {
  var headerBanner = document.getElementById("learnHeaderBanner");
  var headerText = document.getElementById("learnHeaderText");
  var modeLabel = getLearnModeLabel(uiState.learnCat);

  if (allWordsList.length === 0) {
    headerBanner.hidden = false;
    headerText.textContent = modeLabel + "： 単語データがありません";
    return;
  }

  if (uiState.mode === "learn") {
    headerBanner.hidden = true;
    return;
  }

  headerBanner.hidden = false;
  headerText.textContent = modeLabel;
}

function toggleStatusFilter(target) {
  var idx = selectedStatuses.indexOf(target);
  if (idx === -1) {
    selectedStatuses.push(target);
    document.getElementById(target === "learned" ? "chipLearned" : "chipUnlearned").classList.add("active");
  } else {
    selectedStatuses.splice(idx, 1);
    document.getElementById(target === "learned" ? "chipLearned" : "chipUnlearned").classList.remove("active");
  }
  onSearchFilterChanged();
}

function toggleCatCheckbox(cat) {
  var idx = selectedCats.indexOf(cat);
  if (idx === -1) {
    selectedCats.push(cat);
    document.getElementById("chipCat-" + cat).classList.add("active");
  } else {
    selectedCats.splice(idx, 1);
    document.getElementById("chipCat-" + cat).classList.remove("active");
  }
  onSearchFilterChanged();
}

function createSearchItemRow(item) {
  var itemRow = document.createElement("div");
  itemRow.className = "search-item-row";
  itemRow.dataset.word = getWordKey(item);
  itemRow.setAttribute("role", "listitem");

  if (getWordChecked(item)) {
    itemRow.classList.add("checked");
  }

  var chkWrap = document.createElement("div");
  chkWrap.className = "search-item-chk-wrap";
  var innerChk = document.createElement("div");
  innerChk.className = "word-custom-chk chk-" + item.category;
  chkWrap.appendChild(innerChk);

  var body = document.createElement("div");
  body.className = "search-item-body";
  body.appendChild(buildWordTextBlocks(item));

  var titleRow = body.querySelector(".word-title-row");
  if (titleRow) {
    var catBadge = document.createElement("span");
    catBadge.className = "search-item-badge bg-" + item.category;
    catBadge.textContent = item.category;
    titleRow.appendChild(catBadge);
  }

  itemRow.appendChild(chkWrap);
  itemRow.appendChild(body);

  return itemRow;
}

function onSearchItemClick(wordName, rowEl) {
  var item = findWordByKey(wordName);
  if (!item) return;

  searchChromeState.suppressChromeScrollUntil = Date.now() + SEARCH_CHROME_TAP_SUPPRESS_MS;

  var newStatus = !getWordChecked(item);
  rowEl.classList.toggle("checked", newStatus);
  delete postInFlightWords[wordName];
  pendingChecks[wordName] = newStatus;
  localLearnedOverrides[wordName] = newStatus;
  persistPendingChecksToStorage();
  persistLocalLearnedOverrides();
  if (newStatus) {
    item.isLearned = true;
    recordTodayKnownPress(wordName);
  } else {
    item.isLearned = false;
    delete todayCommittedLearned[wordName];
    persistTodayCommittedLearned();
    reconcileTodayAchievement({ allowUnmarkToday: true });
    refreshLearnedCountDisplays(true);
  }
  scheduleSearchCheckSync();

  if (selectedStatuses.length > 0) {
    var itemStatus = newStatus ? "learned" : "unlearned";
    if (selectedStatuses.indexOf(itemStatus) === -1) {
      rowEl.remove();
      updateSearchStatusBar(document.querySelectorAll("#searchResultList .search-item-row").length);
    }
  }
}

function buildSearchStatusText(matchCount, query, hasCatFilter, hasStatusFilter) {
  if (query === "" && !hasStatusFilter && !hasCatFilter) {
    return "全 " + allWordsList.length + " 語 を表示中";
  }

  var hasLearned = selectedStatuses.indexOf("learned") !== -1;
  var hasUnlearned = selectedStatuses.indexOf("unlearned") !== -1;
  var statusLabel = "";

  if (hasLearned && !hasUnlearned) {
    statusLabel = "知ってる単語";
  } else if (hasUnlearned && !hasLearned) {
    statusLabel = "知らない単語";
  }

  var catLabel = hasCatFilter ? selectedCats.join("・") : "";
  var filterLabel = "";

  if (catLabel && statusLabel) {
    filterLabel = catLabel + "の" + statusLabel;
  } else if (catLabel) {
    filterLabel = catLabel;
  } else if (statusLabel) {
    filterLabel = statusLabel;
  }

  var parts = [];
  if (query !== "") {
    parts.push("「" + query + "」");
  }
  if (filterLabel !== "") {
    parts.push(filterLabel);
  }

  var prefix = parts.length > 0 ? parts.join("") + "：" : "";
  return prefix + matchCount + " 語";
}

function updateSearchStatusBar(matchCount) {
  var query = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  var hasCatFilter = (selectedCats.length > 0);
  var hasStatusFilter = (selectedStatuses.length > 0);
  document.getElementById("searchStatusBar").textContent = buildSearchStatusText(
    matchCount,
    query,
    hasCatFilter,
    hasStatusFilter
  );
}

function scheduleSearchFilterFromInput() {
  clearTimeout(searchInputTimer);
  searchInputTimer = setTimeout(function () {
    searchInputTimer = null;
    onSearchFilterChanged();
  }, 150);
}

function collectSearchMatches(query, hasCatFilter, hasStatusFilter) {
  var results = [];

  for (var i = 0; i < allWordsList.length; i++) {
    var item = allWordsList[i];

    if (hasCatFilter && selectedCats.indexOf(item.category) === -1) continue;

    if (hasStatusFilter) {
      var itemStatus = getWordChecked(item) ? "learned" : "unlearned";
      if (selectedStatuses.indexOf(itemStatus) === -1) continue;
    }

    if (query !== "") {
      var w = (item.word || "").toLowerCase();
      var r = (item.ruby || "").toLowerCase();
      var e = (item.english || "").toLowerCase();

      var isPrefixMatch = (w.indexOf(query) === 0 || r.indexOf(query) === 0 || e.indexOf(query) === 0);
      if (!isPrefixMatch) continue;
    }

    results.push(item);
  }

  return results;
}

function renderSearchMatches(listEl, matches, token) {
  if (matches.length === 0) return;

  if (matches.length <= SEARCH_RENDER_BATCH) {
    var singleBatch = document.createDocumentFragment();
    for (var i = 0; i < matches.length; i++) {
      singleBatch.appendChild(createSearchItemRow(matches[i]));
    }
    listEl.appendChild(singleBatch);
    return;
  }

  var index = 0;

  function renderBatch() {
    if (token !== searchRenderToken) return;

    var batch = document.createDocumentFragment();
    var end = Math.min(index + SEARCH_RENDER_BATCH, matches.length);

    for (; index < end; index++) {
      batch.appendChild(createSearchItemRow(matches[index]));
    }

    listEl.appendChild(batch);

    if (index < matches.length) {
      requestAnimationFrame(renderBatch);
    }
  }

  renderBatch();
}

function setSearchChromeHidden(hidden) {
  if (searchChromeState.hidden === hidden) {
    return;
  }

  searchChromeState.hidden = hidden;
  var panelSearch = document.getElementById("panelSearch");
  if (panelSearch) {
    panelSearch.classList.toggle("search-chrome-collapsed", hidden);
  }
  document.body.classList.toggle("search-chrome-collapsed", hidden);
}

function showSearchChrome() {
  setSearchChromeHidden(false);
}

function shouldSuppressSearchChromeScroll() {
  return Date.now() < searchChromeState.suppressChromeScrollUntil;
}

function hideSearchChrome() {
  if (uiState.mode !== "search") {
    return;
  }
  var panelSearch = document.getElementById("panelSearch");
  if (!panelSearch || !panelSearch.classList.contains("active")) {
    return;
  }
  var searchInput = document.getElementById("searchInput");
  if (searchInput && document.activeElement === searchInput) {
    return;
  }
  setSearchChromeHidden(true);
}

function resetSearchChrome() {
  showSearchChrome();
  searchChromeState.lastScrollTop = 0;
  searchChromeState.suppressChromeScrollUntil = 0;
  var listEl = document.getElementById("searchResultList");
  if (listEl) {
    listEl.scrollTop = 0;
  }
}

function onSearchResultScroll() {
  if (uiState.mode !== "search") {
    return;
  }

  var listEl = document.getElementById("searchResultList");
  if (!listEl) {
    return;
  }

  updateSearchChromeFromScroll(listEl.scrollTop);
}

function updateSearchChromeFromScroll(scrollTop) {
  if (shouldSuppressSearchChromeScroll()) {
    searchChromeState.lastScrollTop = scrollTop;
    return;
  }

  if (scrollTop <= 4) {
    showSearchChrome();
  } else {
    var delta = scrollTop - searchChromeState.lastScrollTop;
    if (Math.abs(delta) > SEARCH_CHROME_SCROLL_THRESHOLD && scrollTop > SEARCH_CHROME_MIN_HIDE_OFFSET) {
      hideSearchChrome();
    }
  }

  searchChromeState.lastScrollTop = scrollTop;
}

function onSearchResultScrollRaf() {
  if (searchChromeState.scrollTicking) {
    return;
  }
  searchChromeState.scrollTicking = true;
  requestAnimationFrame(function () {
    searchChromeState.scrollTicking = false;
    onSearchResultScroll();
  });
}

function bindSearchChromeScroll() {
  if (searchChromeState.bound) {
    return;
  }

  var listEl = document.getElementById("searchResultList");
  if (!listEl) {
    return;
  }

  listEl.addEventListener("scroll", onSearchResultScrollRaf, { passive: true });
  listEl.addEventListener("wheel", function (e) {
    if (uiState.mode !== "search" || shouldSuppressSearchChromeScroll()) {
      return;
    }
    var list = document.getElementById("searchResultList");
    if (!list) {
      return;
    }
    if (list.scrollTop <= 4) {
      showSearchChrome();
    } else if (Math.abs(e.deltaY) > SEARCH_CHROME_SCROLL_THRESHOLD) {
      hideSearchChrome();
    }
  }, { passive: true });
  listEl.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) {
      searchChromeState.touchStartY = e.touches[0].clientY;
      searchChromeState.touchOnCheckbox = !!e.target.closest(".search-item-chk-wrap");
    }
  }, { passive: true });
  listEl.addEventListener("touchmove", function (e) {
    if (uiState.mode !== "search" || e.touches.length !== 1 || searchChromeState.touchOnCheckbox) {
      return;
    }
    if (shouldSuppressSearchChromeScroll()) {
      return;
    }

    var list = document.getElementById("searchResultList");
    if (!list) {
      return;
    }

    var scrollTop = list.scrollTop;
    var dy = searchChromeState.touchStartY - e.touches[0].clientY;

    if (scrollTop <= 4) {
      showSearchChrome();
    } else if (Math.abs(dy) > SEARCH_CHROME_SCROLL_THRESHOLD && scrollTop > SEARCH_CHROME_MIN_HIDE_OFFSET) {
      hideSearchChrome();
    }

    searchChromeState.lastScrollTop = scrollTop;
  }, { passive: true });
  listEl.addEventListener("touchend", function () {
    searchChromeState.touchOnCheckbox = false;
  }, { passive: true });
  listEl.addEventListener("click", function (e) {
    if (uiState.mode !== "search" || !searchChromeState.hidden) {
      return;
    }
    if (e.target.closest(".search-item-chk-wrap")) {
      return;
    }
    showSearchChrome();
  });
  searchChromeState.bound = true;
}

function cancelDeferredSearchRender() {
  if (!searchDeferredRenderHandle) {
    return;
  }
  if (searchDeferredRenderUsesIdle && typeof cancelIdleCallback === "function") {
    cancelIdleCallback(searchDeferredRenderHandle);
  } else {
    clearTimeout(searchDeferredRenderHandle);
  }
  searchDeferredRenderHandle = null;
  searchDeferredRenderUsesIdle = false;
}

function scheduleDeferredSearchRender() {
  cancelDeferredSearchRender();

  var run = function () {
    searchDeferredRenderHandle = null;
    searchDeferredRenderUsesIdle = false;
    if (uiState.mode === "search") {
      onSearchFilterChanged();
    }
  };

  if (typeof requestIdleCallback === "function") {
    searchDeferredRenderUsesIdle = true;
    searchDeferredRenderHandle = requestIdleCallback(run, { timeout: 1500 });
  } else {
    searchDeferredRenderHandle = setTimeout(run, 16);
  }
}

function prepareSearchPanelForBoot() {
  var query = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  var hasCatFilter = (selectedCats.length > 0);
  var hasStatusFilter = (selectedStatuses.length > 0);
  var matches = collectSearchMatches(query, hasCatFilter, hasStatusFilter);
  var listEl = document.getElementById("searchResultList");

  updateSearchStatusBar(matches.length);
  if (listEl) {
    listEl.innerHTML = "";
  }
  scheduleDeferredSearchRender();
}

function onSearchFilterChanged() {
  cancelDeferredSearchRender();
  resetSearchChrome();

  clearTimeout(searchInputTimer);
  searchInputTimer = null;
  searchRenderToken++;
  var token = searchRenderToken;

  var query = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  var listEl = document.getElementById("searchResultList");
  listEl.innerHTML = "";

  var hasCatFilter = (selectedCats.length > 0);
  var hasStatusFilter = (selectedStatuses.length > 0);
  var matches = collectSearchMatches(query, hasCatFilter, hasStatusFilter);

  updateSearchStatusBar(matches.length);
  renderSearchMatches(listEl, matches, token);
}

function renderRoadmap() {
  if (!roadmapData) return;

  var todayKey = getTodayJSTStr();
  var totalLearned = getLiveTotalLearnedCount();
  var dynamicLearnedMap = buildLearnedDatesMap();
  var streakCount = getStreakCount();

  setDailyStatValue(document.getElementById("valStreak"), streakCount, "日");
  setDailyStatValue(document.getElementById("valTotalWords"), totalLearned, "語");
  refreshTodayLearnedDisplay();

  var tbody = document.getElementById("roadmapTableBody");
  tbody.innerHTML = "";

  var now = new Date();
  var currentDay = now.getDay();
  var mondayOffset = now.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
  var nowMonday = new Date(now.getFullYear(), now.getMonth(), mondayOffset);
  var nowMondayKey = formatDateStr(nowMonday);

  var totalWeeks = 23;
  var baseMonday = new Date(2026, 7, 24);

  for (var w = 0; w < totalWeeks; w++) {
    var thisMon = new Date(baseMonday.getFullYear(), baseMonday.getMonth(), baseMonday.getDate() + (w * 7));
    var thisMonKey = formatDateStr(thisMon);
    var isCurrentWeek = (thisMonKey === nowMondayKey);

    var tr = document.createElement("tr");
    if (isCurrentWeek) {
      tr.className = "current-week";
    }

    var startStr = (thisMon.getMonth() + 1) + "/" + thisMon.getDate() + "〜";
    var weekLabel = startStr;

    var tdWeek = document.createElement("td");
    tdWeek.className = "td-week";
    tdWeek.textContent = weekLabel;
    tr.appendChild(tdWeek);

    for (var d = 0; d < 7; d++) {
      var targetD = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() + d);
      var targetKey = formatDateStr(targetD);
      var symbol = "";

      if (targetKey < "2026-08-28") {
        symbol = "";
      } else if (targetKey > "2027-01-31") {
        symbol = "";
      } else if (dynamicLearnedMap[targetKey]) {
        symbol = "⭐️";
      } else if (targetKey === "2027-01-31") {
        symbol = "📘";
      } else if (targetKey > todayKey) {
        symbol = "⚪️";
      } else {
        symbol = "⬜️";
      }

      var tdDay = document.createElement("td");
      tdDay.textContent = symbol;
      if (symbol === "⭐️") {
        tdDay.className = "roadmap-day-star";
      } else if (symbol === "📘") {
        tdDay.className = "roadmap-day-book";
      } else if (symbol === "⬜️" || symbol === "⚪️") {
        tdDay.className = "roadmap-day-gray";
      }
      tr.appendChild(tdDay);
    }

    tbody.appendChild(tr);
  }
}

function formatDateStr(date) {
  var y = date.getFullYear();
  var m = ("0" + (date.getMonth() + 1)).slice(-2);
  var d = ("0" + date.getDate()).slice(-2);
  return y + "-" + m + "-" + d;
}

function showLoading(isShow) {
  var overlay = document.getElementById("loadingOverlay");
  if (isShow) {
    overlay.classList.add("show");
  } else {
    overlay.classList.remove("show");
  }
}
