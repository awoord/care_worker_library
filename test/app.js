var GAS_BASE_URL = "https://script.google.com/macros/s/AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec";
var FLASH_SESSION_SIZE = 5;
var FLASH_TODAY_SEEN_GOAL = 30;
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
var EXAM_DATE_JST = "2027-01-31";
// test / J専用: 端末に残っていない達成日を補完（きろく⭐️・れんぞく用）
var PRIVATE_SEEDED_ACHIEVED_DATES = ["2026-09-15"];

// test専用: このトークン未適用端末の「きょう見た」を0に戻す
var TEST_TODAY_SEEN_RESET_TOKEN = "20260925_seen0";

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

function isKanaOnlyWord(word) {
  /* ひらがな・カタカナのみの語にはルビを付けない */
  return /^[\u3041-\u3096\u309D-\u309E\u30A1-\u30F6\u30F8-\u30FFァ-ヶー・･]+$/.test(
    word || ""
  );
}

function buildExtraRubyMap(raw) {
  var byWord = {};
  if (!Array.isArray(raw)) {
    return byWord;
  }
  for (var i = 0; i < raw.length; i++) {
    var item = raw[i];
    if (!item) {
      continue;
    }
    var word = String(item.word || item.w || "").trim();
    var ruby = String(item.ruby || item.r || "").trim();
    if (!word || !ruby || word.length < MIN_VOCAB_RUBY_LENGTH) {
      continue;
    }
    if (isKanaOnlyWord(word)) {
      continue;
    }
    if (!byWord[word]) {
      byWord[word] = ruby;
    }
  }
  return byWord;
}

function refreshDisplayedVocabularyRuby() {
  if (!learnDataReady) {
    return;
  }
  if (uiState.mode === "learn" && flashSession.revealed) {
    var flashItem = getCurrentFlashWordItem();
    if (flashItem) {
      fillFlashcardAnswer(flashItem);
    }
    return;
  }
  if (uiState.mode === "search") {
    onSearchFilterChanged();
  }
}

function applyExtraRubyEntries(raw) {
  extraRubyByWord = buildExtraRubyMap(raw);
  invalidateVocabularyRubyEntries();
  refreshDisplayedVocabularyRuby();
}

function startRubyExtraPrefetch() {
  if (!rubyExtraPrefetchPromise) {
    rubyExtraPrefetchPromise = fetch("ruby.json?_t=" + Date.now())
      .then(function (res) {
        if (!res.ok) {
          return [];
        }
        return res.json();
      })
      .catch(function () {
        return [];
      })
      .then(function (raw) {
        applyExtraRubyEntries(raw);
        return extraRubyByWord;
      });
  }
  return rubyExtraPrefetchPromise;
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
  learnCat: LEARN_MODE_AUTO,
  roadmapDisplay: "seen"
};

var FLASH_LAP_STORAGE_KEY = "flash_lap_state_v1";
var flashCompleteAnimTimers = [];
var flashCompleteAnimFrame = 0;
var flashCompleteTodayAnimKey = "";
var flashLapState = {};
var flashLapStateReady = false;

var flashSession = {
  cat: "",
  wordNames: [],
  initialCount: 0,
  index: 0,
  revealed: false,
  completed: false,
  advancing: false,
  answerLog: [],
  lapStart: null
};

var learnDataReady = false;
var flashInteractionReady = false;

var allWordsList = [];
var vocabularyRubyEntries = null;
/* kakomon 側の追加ルビ辞書 B（DB語 A 以外）。A と衝突したら A を優先する */
var extraRubyByWord = null;
var rubyExtraPrefetchPromise = null;
var MIN_VOCAB_RUBY_LENGTH = 2;
var roadmapData = {};
var initialLearnedDatesMap = {};
var serverLearnedDatesMap = {};
var localAchievedDates = {};
var todayCommittedLearned = {};
var todaySkippedWords = {};
var dailySeenCounts = {};
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

function normalizeRoadmapDisplay(mode) {
  if (mode === "known" || mode === "count") {
    return "known";
  }
  return "seen";
}

function isKnownRoadmapMode() {
  return uiState.roadmapDisplay === "known";
}

function loadUiState() {
  uiState.mode = localStorage.getItem(getStorageKey("saved_main_mode")) || "learn";
  var savedLearnCat = localStorage.getItem(getStorageKey("saved_learn_cat")) || LEARN_MODE_AUTO;
  uiState.learnCat = normalizeLearnCat(savedLearnCat);
  uiState.roadmapDisplay = normalizeRoadmapDisplay(
    localStorage.getItem(getStorageKey("saved_roadmap_display"))
  );

  localAchievedDates = JSON.parse(localStorage.getItem(getStorageKey("saved_achieved_dates")) || "{}");
  applyPrivateSeededAchievedDates();
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
  dailySeenCounts = loadDailySeenCounts();
  applyTestTodaySeenReset();
  loadFlashSessionFromStorage();
}

function applyTestTodaySeenReset() {
  if (!isTestDeploy()) {
    return false;
  }
  var tokenKey = getStorageKey("test_today_seen_reset_token");
  if (localStorage.getItem(tokenKey) === TEST_TODAY_SEEN_RESET_TOKEN) {
    return false;
  }

  var todayKey = getTodayJSTStr();
  todayCommittedLearned = {};
  todaySkippedWords = {};
  localStorage.removeItem(getStorageKey("saved_today_committed_learned"));
  localStorage.removeItem(getStorageKey("saved_today_skipped_words"));

  if (dailySeenCounts && dailySeenCounts[todayKey] != null) {
    delete dailySeenCounts[todayKey];
    persistDailySeenCounts();
  }
  if (localAchievedDates && localAchievedDates[todayKey]) {
    delete localAchievedDates[todayKey];
    persistAchievedDates();
  }
  if (initialLearnedDatesMap && initialLearnedDatesMap[todayKey]) {
    delete initialLearnedDatesMap[todayKey];
  }

  // リセット後は端末の今日セッションのみを「きょう見た」に数える
  localStorage.setItem(getStorageKey("test_seen_local_only_date"), todayKey);
  localStorage.setItem(tokenKey, TEST_TODAY_SEEN_RESET_TOKEN);
  return true;
}

function persistFlashSession() {
  try {
    sessionStorage.setItem(getStorageKey("care_worker_flash_session_v2"), JSON.stringify({
      cat: flashSession.cat,
      wordNames: flashSession.wordNames,
      initialCount: flashSession.initialCount,
      index: flashSession.index,
      completed: flashSession.completed,
      answerLog: flashSession.answerLog,
      lapStart: flashSession.lapStart || null
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
    flashSession.lapStart = saved.lapStart || null;

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

function loadDailySeenCounts() {
  try {
    var parsed = JSON.parse(localStorage.getItem(getStorageKey("saved_daily_seen_counts_v1")) || "{}");
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch (e) {
    return {};
  }
}

function persistDailySeenCounts() {
  try {
    localStorage.setItem(getStorageKey("saved_daily_seen_counts_v1"), JSON.stringify(dailySeenCounts));
  } catch (e) {}
}

function persistTodaySeenCount() {
  try {
    dailySeenCounts[getTodayJSTStr()] = getTodaySeenCount();
    persistDailySeenCounts();
  } catch (e) {}
}

function buildDailySeenCountMap() {
  var map = {};
  for (var dateKey in dailySeenCounts) {
    if (!dailySeenCounts.hasOwnProperty(dateKey)) {
      continue;
    }
    var n = Number(dailySeenCounts[dateKey]) || 0;
    if (n > 0) {
      map[dateKey] = n;
    }
  }
  map[getTodayJSTStr()] = getTodaySeenCount();
  return map;
}

function refreshDailyBoundariesIfNeeded() {
  var todayKey = getTodayJSTStr();
  if (todayKey === trackedJSTDateKey) {
    return false;
  }

  // 日付が変わる前に、前日の「見た」数を確定させる（getTodaySeenCount は呼ぶと再帰するので直接数える）
  try {
    if (trackedJSTDateKey) {
      var prevLearned = 0;
      var prevSkipped = 0;
      var learnedSet = {};
      for (var learnedName in todayCommittedLearned) {
        if (todayCommittedLearned.hasOwnProperty(learnedName)) {
          learnedSet[learnedName] = true;
          prevLearned++;
        }
      }
      for (var skippedName in todaySkippedWords) {
        if (!todaySkippedWords.hasOwnProperty(skippedName) || learnedSet[skippedName]) {
          continue;
        }
        prevSkipped++;
      }
      var prevSeen = prevLearned + prevSkipped;
      if (prevSeen > 0) {
        dailySeenCounts[trackedJSTDateKey] = prevSeen;
        persistDailySeenCounts();
      }
      if (prevSeen >= FLASH_TODAY_SEEN_GOAL) {
        localAchievedDates[trackedJSTDateKey] = true;
        persistAchievedDates();
      }
    }
  } catch (e) {}

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
  persistTodaySeenCount();
  if (hasTodayStreakAchievement()) {
    markTodayAchieved();
    refreshLearnedCountDisplays(true);
  }
  scheduleDailyLogSync();
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
  // 今日以降: 見た語数のみ（知ってる回数は無関係。0回でも目標語数見れば⭐️）
  return getTodaySeenCount() >= FLASH_TODAY_SEEN_GOAL;
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
    var committedItem = findWordByKey(wordName);
    if (committedItem && getWordChecked(committedItem)) {
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

function getTodaySkippedCount() {
  refreshDailyBoundariesIfNeeded();
  var learned = collectTodayLearnedWords();
  var count = 0;
  for (var wordName in todaySkippedWords) {
    if (!todaySkippedWords.hasOwnProperty(wordName) || learned[wordName]) {
      continue;
    }
    count++;
  }
  return count;
}

function getTodayLocalSeenCount() {
  refreshDailyBoundariesIfNeeded();
  var names = {};
  for (var committedName in todayCommittedLearned) {
    if (!todayCommittedLearned.hasOwnProperty(committedName) || !todayCommittedLearned[committedName]) {
      continue;
    }
    names[committedName] = true;
  }
  for (var skippedName in todaySkippedWords) {
    if (!todaySkippedWords.hasOwnProperty(skippedName) || !todaySkippedWords[skippedName]) {
      continue;
    }
    names[skippedName] = true;
  }
  var count = 0;
  for (var wordName in names) {
    if (names.hasOwnProperty(wordName)) {
      count++;
    }
  }
  return count;
}

function getTodaySeenCount() {
  if (isTestDeploy()) {
    var localOnlyDate = localStorage.getItem(getStorageKey("test_seen_local_only_date"));
    if (localOnlyDate === getTodayJSTStr()) {
      return getTodayLocalSeenCount();
    }
  }
  return getTodayLearnedCount() + getTodaySkippedCount();
}

function countSessionNewlySeenToday() {
  var log = flashSession.answerLog || [];
  var counted = {};
  var count = 0;
  for (var i = 0; i < log.length; i++) {
    var entry = log[i];
    if (!entry || !entry.wordName || counted[entry.wordName]) {
      continue;
    }
    counted[entry.wordName] = true;
    var snap = entry.undoSnapshot || {};
    if (snap.wasSkippedToday || snap.wasInTodayCommitted) {
      continue;
    }
    count++;
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
  persistTodaySeenCount();
  reconcileTodayAchievement({ allowUnmarkToday: true });
  refreshLearnedCountDisplays(true);
  scheduleDailyLogSync();
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
  // 過去の⭐️は目標変更後も消さない（旧条件で付いた日を含む）
  var pastSeenGoalFloor = 20;

  for (var dKey in serverLearnedDatesMap) {
    if (serverLearnedDatesMap.hasOwnProperty(dKey) && dKey !== todayKey) {
      map[dKey] = true;
    }
  }

  for (var localKey in localAchievedDates) {
    if (localAchievedDates.hasOwnProperty(localKey) && localKey !== todayKey) {
      map[localKey] = true;
    }
  }

  var seenMap = buildDailySeenCountMap();
  for (var seenKey in seenMap) {
    if (!seenMap.hasOwnProperty(seenKey) || seenKey === todayKey) {
      continue;
    }
    if ((Number(seenMap[seenKey]) || 0) >= pastSeenGoalFloor) {
      map[seenKey] = true;
    }
  }

  if (hasTodayStreakAchievement()) {
    map[todayKey] = true;
  }

  return map;
}

function buildDailyLearnedCountMap() {
  var counts = {};
  var todayKey = getTodayJSTStr();
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
    var dateKey = getWordLearnedDateKey(item);
    if (!dateKey || dateKey === todayKey) {
      continue;
    }
    counts[dateKey] = (counts[dateKey] || 0) + 1;
  }

  counts[todayKey] = getTodayLearnedCount();
  return counts;
}

function updateRoadmapDisplayToggleUI() {
  var btn = document.getElementById("btnRoadmapDisplayMode");
  if (!btn) {
    return;
  }
  var isKnown = isKnownRoadmapMode();
  btn.setAttribute("aria-pressed", isKnown ? "true" : "false");
  btn.classList.toggle("is-count-mode", isKnown);
  btn.classList.toggle("is-known-mode", isKnown);
  btn.textContent = isKnown ? "✅" : "⭐️";
  btn.setAttribute(
    "aria-label",
    isKnown ? "見た表示に切り替える" : "覚えた表示に切り替える"
  );
}

function toggleRoadmapDisplayMode() {
  uiState.roadmapDisplay = isKnownRoadmapMode() ? "seen" : "known";
  persistUiState();
  updateRoadmapDisplayToggleUI();
  if (uiState.mode === "daily") {
    renderRoadmap();
  }
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
  var preserved = {};

  for (var dKey in localAchievedDates) {
    if (localAchievedDates.hasOwnProperty(dKey) && dKey !== todayKey) {
      preserved[dKey] = true;
    }
  }

  localAchievedDates = preserved;

  applyPrivateSeededAchievedDates();

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

function ensureDailyStatNum(el, unit) {
  var numEl = el.querySelector(".daily-stat-num");
  if (!numEl) {
    el.textContent = "";
    numEl = document.createElement("span");
    numEl.className = "daily-stat-num";
    el.appendChild(numEl);
    var unitEl = document.createElement("span");
    unitEl.className = "daily-stat-unit";
    unitEl.textContent = " " + unit;
    el.appendChild(unitEl);
  } else {
    var unitSpan = el.querySelector(".daily-stat-unit");
    if (unitSpan) {
      unitSpan.textContent = " " + unit;
    }
  }
  return numEl;
}

function setDailyStatValue(el, count, unit) {
  if (!el) return;

  var isWordStat = el.id === "valTodayWords" || el.id === "valTotalWords";
  if (!isWordStat) {
    el.innerHTML = count + '<span class="daily-stat-unit"> ' + unit + '</span>';
    return;
  }

  var numEl = ensureDailyStatNum(el, unit);
  numEl.textContent = String(Math.max(0, Number(count) || 0));
}

function refreshStreakDisplay() {
  var streakEl = document.getElementById("valStreak");
  setDailyStatValue(streakEl, getStreakCount(), "日");
}

function refreshTodayLearnedDisplay() {
  persistTodaySeenCount();
  var todayEl = document.getElementById("valTodayWords");
  if (!todayEl) {
    return;
  }
  var todayCount = isKnownRoadmapMode() ? getTodayLearnedCount() : getTodaySeenCount();
  setDailyStatValue(todayEl, todayCount, "語");
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

function updateDailyStatLensUI() {
  var panelDaily = document.getElementById("panelDaily");
  if (panelDaily) {
    panelDaily.classList.toggle("is-roadmap-known", isKnownRoadmapMode());
    panelDaily.classList.toggle("is-roadmap-seen", !isKnownRoadmapMode());
  }
  var todayLabel = document.querySelector("#panelDaily .daily-stat-card.today .daily-stat-label");
  if (todayLabel) {
    todayLabel.textContent = isKnownRoadmapMode() ? "きょう 覚えた" : "きょう 見た";
  }
  var totalLabel = document.querySelector("#panelDaily .daily-stat-card.words .daily-stat-label");
  if (totalLabel) {
    totalLabel.textContent = "これまで 覚えた";
  }
}

function refreshLearnedCountDisplays(refreshRoadmapFully) {
  if (uiState.mode === "learn") {
    updateLiveHeader();
  }

  updateDailyStatLensUI();

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
  localStorage.setItem(getStorageKey("saved_roadmap_display"), uiState.roadmapDisplay);
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
  flashSession.lapStart = captureFlashLapStart(catName);
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

function canUnrevealFlashcard() {
  return !!(
    flashInteractionReady &&
    !flashSession.advancing &&
    !flashSession.completed &&
    flashSession.revealed &&
    flashSession.wordNames.length > 0
  );
}

function canUndoFlashcard() {
  if (!flashInteractionReady || flashSession.advancing) {
    return false;
  }
  if (canUnrevealFlashcard()) {
    return true;
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
  if (snap) {
    revertFlashLapProgress(snap.lapUndo);
  }
  scheduleDailyLogSync();
}

function unrevealFlashcard() {
  if (!canUnrevealFlashcard()) return;

  clearFlashcardAnswer();
  setFlashRevealState(false);
  persistFlashSession();
}

function undoFlashcard() {
  if (canUnrevealFlashcard()) {
    unrevealFlashcard();
    return;
  }
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

function buildFlashCompleteCopy() {
  return {
    message: pickFlashCompleteMessage(),
    restartLabel: "つづける"
  };
}

function clearFlashCompleteCopyCache() {
  flashCompleteCopyCache = null;
  resetFlashCompleteTodayAnimation();
}

function getFlashCompleteCopy() {
  if (!flashCompleteCopyCache) {
    flashCompleteCopyCache = buildFlashCompleteCopy();
  }
  return flashCompleteCopyCache;
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
    messageEl.textContent = getFlashSessionEmptyMessage(emptyCat);
    hideFlashCompleteProgress();
    if (detailEl) {
      detailEl.textContent = "";
      detailEl.hidden = true;
      detailEl.classList.remove("is-goal-met", "is-all-learned");
    }
    if (skipNoteEl) {
      skipNoteEl.hidden = poolStatus === "all_learned";
    }
    setFlashCompleteRestartLabel("もう" + FLASH_SESSION_SIZE + "つ つづける");
    updateFlashCompleteButtonsVisibility();
    return;
  }

  var copy = getFlashCompleteCopy();

  messageEl.textContent = copy.message;
  setFlashCompleteRestartLabel(copy.restartLabel);

  if (skipNoteEl) {
    skipNoteEl.hidden = false;
  }

  updateFlashCompleteButtonsVisibility();
  updateFlashCompleteProgress();
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
    if (allWordsList.length === 0) {
      return;
    }
    while (flashSession.index < flashSession.wordNames.length && !getCurrentFlashWordItem()) {
      flashSession.index++;
    }
    if (flashSession.index >= flashSession.wordNames.length) {
      flashSession.completed = true;
    }
    persistFlashSession();
    updateFlashSessionUI(options);
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

function isPrivateDeploy() {
  return /\/kaigo\/p\//.test(window.location.pathname);
}

function applyPrivateSeededAchievedDates() {
  if (!isPrivateDeploy() && !isTestDeploy()) {
    return false;
  }
  var changed = false;
  for (var i = 0; i < PRIVATE_SEEDED_ACHIEVED_DATES.length; i++) {
    var dateKey = PRIVATE_SEEDED_ACHIEVED_DATES[i];
    if (!dateKey || localAchievedDates[dateKey]) {
      continue;
    }
    localAchievedDates[dateKey] = true;
    changed = true;
  }
  if (changed) {
    persistAchievedDates();
  }
  return changed;
}

var dailyLogSyncTimer = null;
var dailyLogSyncInFlight = false;

function listTodayKnownWordNames() {
  var names = {};
  Object.keys(todayCommittedLearned).forEach(function (wordName) {
    if (!todayCommittedLearned[wordName]) {
      return;
    }
    if (pendingChecks.hasOwnProperty(wordName) && pendingChecks[wordName] === false) {
      return;
    }
    names[wordName] = true;
  });
  Object.keys(collectTodayLearnedWords()).forEach(function (wordName) {
    names[wordName] = true;
  });
  return Object.keys(names);
}

function listTodayUnknownWordNames() {
  refreshDailyBoundariesIfNeeded();
  var learned = collectTodayLearnedWords();
  var names = [];
  for (var wordName in todaySkippedWords) {
    if (!todaySkippedWords.hasOwnProperty(wordName) || learned[wordName]) {
      continue;
    }
    names.push(wordName);
  }
  return names;
}

function buildTodayDailyLogByCategory() {
  var byCat = {};
  CATEGORIES.forEach(function (cat) {
    byCat[cat] = { knownWords: [], unknownWords: [] };
  });

  // 知ってる: 端末の今日コミットを正とする（checked フラグ欠落で落とさない）
  Object.keys(todayCommittedLearned).forEach(function (wordName) {
    if (!todayCommittedLearned[wordName]) {
      return;
    }
    if (pendingChecks.hasOwnProperty(wordName) && pendingChecks[wordName] === false) {
      return;
    }
    var item = findWordByKey(wordName);
    var cat = item ? getWordCategoryKey(item) : "";
    if (!byCat[cat]) {
      return;
    }
    byCat[cat].knownWords.push(wordName);
  });

  // 画面上「きょう覚えた」に入る語も拾う（日付付きの今日分）
  var learned = collectTodayLearnedWords();
  Object.keys(learned).forEach(function (wordName) {
    var item = findWordByKey(wordName);
    var cat = item ? getWordCategoryKey(item) : "";
    if (!byCat[cat]) {
      return;
    }
    if (byCat[cat].knownWords.indexOf(wordName) === -1) {
      byCat[cat].knownWords.push(wordName);
    }
  });

  var knownSet = {};
  CATEGORIES.forEach(function (cat) {
    byCat[cat].knownWords.forEach(function (wordName) {
      knownSet[wordName] = true;
    });
  });

  Object.keys(todaySkippedWords).forEach(function (wordName) {
    if (!todaySkippedWords[wordName] || knownSet[wordName]) {
      return;
    }
    var item = findWordByKey(wordName);
    var cat = item ? getWordCategoryKey(item) : "";
    if (!byCat[cat]) {
      return;
    }
    byCat[cat].unknownWords.push(wordName);
  });

  return byCat;
}

function applyServerDailySeen(dailySeen) {
  if (!isPrivateDeploy() || !dailySeen) {
    return false;
  }
  var todayKey = getTodayJSTStr();
  if (String(dailySeen.date || "") !== todayKey) {
    return false;
  }

  var changed = false;
  var knownWords = Array.isArray(dailySeen.knownWords) ? dailySeen.knownWords : [];
  var unknownWords = Array.isArray(dailySeen.unknownWords) ? dailySeen.unknownWords : [];
  var i;

  for (i = 0; i < knownWords.length; i++) {
    var knownName = String(knownWords[i] || "").trim();
    if (!knownName) {
      continue;
    }
    if (!todayCommittedLearned[knownName]) {
      todayCommittedLearned[knownName] = true;
      changed = true;
    }
    var knownItem = findWordByKey(knownName);
    if (knownItem && !getWordChecked(knownItem)) {
      knownItem.isLearned = true;
      changed = true;
    }
    if (todaySkippedWords[knownName]) {
      delete todaySkippedWords[knownName];
      changed = true;
    }
  }

  for (i = 0; i < unknownWords.length; i++) {
    var unknownName = String(unknownWords[i] || "").trim();
    if (!unknownName || todayCommittedLearned[unknownName] || todaySkippedWords[unknownName]) {
      continue;
    }
    todaySkippedWords[unknownName] = true;
    changed = true;
  }

  if (dailySeen.star === true && !localAchievedDates[todayKey]) {
    localAchievedDates[todayKey] = true;
    changed = true;
  }

  if (changed) {
    persistTodayCommittedLearned();
    persistTodaySkippedWords();
    persistTodaySeenCount();
    persistAchievedDates();
  }
  return changed;
}

function scheduleDailyLogSync() {
  if (!isPrivateDeploy()) {
    return;
  }
  clearTimeout(dailyLogSyncTimer);
  dailyLogSyncTimer = setTimeout(function () {
    dailyLogSyncTimer = null;
    sendDailyLogNow();
  }, 700);
}

function sendDailyLogNow() {
  if (!isPrivateDeploy() || dailyLogSyncInFlight) {
    return;
  }

  refreshDailyBoundariesIfNeeded();
  var byCategory = buildTodayDailyLogByCategory();
  var knownWords = [];
  var unknownWords = [];
  CATEGORIES.forEach(function (cat) {
    knownWords = knownWords.concat(byCategory[cat].knownWords);
    unknownWords = unknownWords.concat(byCategory[cat].unknownWords);
  });
  var payload = {
    action: "dailyLog",
    date: getTodayJSTStr(),
    user: "J",
    byCategory: byCategory,
    knownWords: knownWords,
    unknownWords: unknownWords,
    star: hasTodayStreakAchievement()
  };

  dailyLogSyncInFlight = true;
  fetch(getApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload),
    keepalive: true
  }).then(function (res) {
    return res.json();
  }).then(function (data) {
    if (data && data.success) {
      applyServerDailySeen(data);
      reconcileTodayAchievement({ allowUnmarkToday: true });
      refreshLearnedCountDisplays(uiState.mode === "daily");
    }
  }).catch(function () {
  }).then(function () {
    dailyLogSyncInFlight = false;
  });
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
  } else if (wordName) {
    markWordSkippedToday(wordName);
  }
  undoSnapshot.lapUndo = applyFlashLapProgress(wordName);

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
  if (!item) return "";
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
  if (todaySkippedWords[wordName]) {
    delete todaySkippedWords[wordName];
    persistTodaySkippedWords();
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

function countUnlearnedWords() {
  var count = 0;
  for (var i = 0; i < allWordsList.length; i++) {
    if (!getWordChecked(allWordsList[i])) {
      count++;
    }
  }
  return count;
}

function getFlashLapPoolKey(catName) {
  return normalizeLearnCat(catName || flashSession.cat || uiState.learnCat);
}

function getFlashLapPoolWords(poolKey) {
  if (poolKey === LEARN_MODE_AUTO) {
    return allWordsList;
  }
  return getCategoryWords(poolKey);
}

function createEmptyFlashLapState() {
  return { lap: 1, seen: {} };
}

function getFlashLapState(poolKey) {
  var key = getFlashLapPoolKey(poolKey);
  if (!flashLapState[key]) {
    flashLapState[key] = createEmptyFlashLapState();
  }
  if (!flashLapState[key].seen || typeof flashLapState[key].seen !== "object") {
    flashLapState[key].seen = {};
  }
  if (typeof flashLapState[key].lap !== "number" || flashLapState[key].lap < 1) {
    flashLapState[key].lap = 1;
  }
  return flashLapState[key];
}

function persistFlashLapState() {
  try {
    localStorage.setItem(getStorageKey(FLASH_LAP_STORAGE_KEY), JSON.stringify(flashLapState));
  } catch (e) {}
}

function seedFlashLapSeenFromCursors(seen, catName) {
  var words = getCategoryWords(catName);
  var cursor = getCategoryCursorIndex(catName);
  for (var i = 0; i < cursor && i < words.length; i++) {
    var wordName = getWordKey(words[i]);
    if (wordName) {
      seen[wordName] = true;
    }
  }
}

function ensureFlashLapState() {
  if (flashLapStateReady || !allWordsList.length) {
    return;
  }
  flashLapStateReady = true;

  try {
    var raw = localStorage.getItem(getStorageKey(FLASH_LAP_STORAGE_KEY));
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        flashLapState = parsed;
        return;
      }
    }
  } catch (e) {}

  var autoSeen = {};
  CATEGORIES.forEach(function (catName) {
    var seen = {};
    seedFlashLapSeenFromCursors(seen, catName);
    Object.keys(seen).forEach(function (wordName) {
      autoSeen[wordName] = true;
    });
    flashLapState[catName] = { lap: 1, seen: seen };
  });
  flashLapState[LEARN_MODE_AUTO] = { lap: 1, seen: autoSeen };
  persistFlashLapState();
}

function countUnlearnedInPool(poolKey) {
  var words = getFlashLapPoolWords(poolKey);
  var count = 0;
  for (var i = 0; i < words.length; i++) {
    if (!getWordChecked(words[i])) {
      count++;
    }
  }
  return count;
}

function countLapRemaining(poolKey) {
  ensureFlashLapState();
  var state = getFlashLapState(poolKey);
  var words = getFlashLapPoolWords(poolKey);
  var count = 0;
  for (var i = 0; i < words.length; i++) {
    var wordName = getWordKey(words[i]);
    if (!wordName || getWordChecked(words[i]) || state.seen[wordName]) {
      continue;
    }
    count++;
  }
  return count;
}

function captureFlashLapStart(catName) {
  ensureFlashLapState();
  var poolKey = getFlashLapPoolKey(catName);
  return {
    poolKey: poolKey,
    lap: getFlashLapState(poolKey).lap,
    remaining: countLapRemaining(poolKey)
  };
}

function getFlashLapPoolKeysForWord(wordName) {
  var keys = [];
  var sessionCat = getFlashLapPoolKey(flashSession.cat || uiState.learnCat);
  keys.push(sessionCat);
  var item = findWordByKey(wordName);
  var wordCat = item ? getWordCategoryKey(item) : "";
  if (sessionCat === LEARN_MODE_AUTO && wordCat && keys.indexOf(wordCat) < 0) {
    keys.push(wordCat);
  }
  if (sessionCat !== LEARN_MODE_AUTO && keys.indexOf(LEARN_MODE_AUTO) < 0) {
    keys.push(LEARN_MODE_AUTO);
  }
  return keys;
}

function applyFlashLapProgress(wordName) {
  if (!wordName) {
    return [];
  }
  ensureFlashLapState();
  var undo = [];
  var keys = getFlashLapPoolKeysForWord(wordName);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var state = getFlashLapState(key);
    var entry = {
      key: key,
      wordName: wordName,
      wasSeen: !!state.seen[wordName],
      snapshot: null
    };
    if (!state.seen[wordName]) {
      state.seen[wordName] = true;
    }
    if (countLapRemaining(key) === 0 && countUnlearnedInPool(key) > 0) {
      entry.snapshot = {
        lap: state.lap,
        seen: Object.assign({}, state.seen)
      };
      state.lap += 1;
      state.seen = {};
    }
    undo.push(entry);
  }
  persistFlashLapState();
  return undo;
}

function revertFlashLapProgress(undoList) {
  if (!undoList || !undoList.length) {
    return;
  }
  for (var i = 0; i < undoList.length; i++) {
    var entry = undoList[i];
    var state = getFlashLapState(entry.key);
    if (entry.snapshot) {
      state.lap = entry.snapshot.lap;
      state.seen = Object.assign({}, entry.snapshot.seen);
    } else if (!entry.wasSeen) {
      delete state.seen[entry.wordName];
    }
  }
  persistFlashLapState();
}

function getFlashCompleteLapView() {
  ensureFlashLapState();
  var poolKey = getFlashLapPoolKey(flashSession.cat || uiState.learnCat);
  var unlearned = countUnlearnedInPool(poolKey);
  if (unlearned <= 0) {
    return { allLearned: true };
  }

  var state = getFlashLapState(poolKey);
  var start = flashSession.lapStart || {
    poolKey: poolKey,
    lap: state.lap,
    remaining: countLapRemaining(poolKey)
  };
  var completedLap = state.lap > start.lap ? start.lap : 0;

  if (completedLap) {
    return {
      allLearned: false,
      completedLap: completedLap,
      lap: state.lap,
      remainingStart: Math.max(0, start.remaining),
      remainingEnd: 0,
      nextRemaining: countLapRemaining(poolKey)
    };
  }

  return {
    allLearned: false,
    completedLap: 0,
    lap: state.lap,
    remainingStart: Math.max(0, start.remaining),
    remainingEnd: countLapRemaining(poolKey),
    nextRemaining: 0
  };
}

function formatWordCountLabel(count) {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function updateFlashCompleteGoalDetail(seenCount) {
  var detailEl = document.getElementById("flashCompleteDetail");
  if (!detailEl) {
    return;
  }

  var allLearned = countUnlearnedWords() <= 0;
  var goalMet = seenCount >= FLASH_TODAY_SEEN_GOAL;
  detailEl.classList.toggle("is-all-learned", allLearned);
  detailEl.classList.toggle("is-goal-met", !allLearned && goalMet);

  if (allLearned) {
    detailEl.textContent = "国試がスラスラ読めるところまで来た！！";
    detailEl.hidden = false;
    return;
  }

  if (goalMet) {
    detailEl.textContent = "クリア⭐️";
    detailEl.hidden = false;
    return;
  }

  detailEl.textContent = "1日" + FLASH_TODAY_SEEN_GOAL + "語 見ると ⭐️";
  detailEl.hidden = false;
}

function clearFlashCompleteAnimTimers() {
  for (var i = 0; i < flashCompleteAnimTimers.length; i++) {
    clearTimeout(flashCompleteAnimTimers[i]);
  }
  flashCompleteAnimTimers = [];
  if (flashCompleteAnimFrame) {
    window.cancelAnimationFrame(flashCompleteAnimFrame);
    flashCompleteAnimFrame = 0;
  }
}

function resetFlashCompleteTodayAnimation() {
  clearFlashCompleteAnimTimers();
  flashCompleteTodayAnimKey = "";
}

function hideFlashCompleteProgress() {
  resetFlashCompleteTodayAnimation();
  var progressEl = document.getElementById("flashCompleteProgress");
  if (progressEl) {
    progressEl.hidden = true;
  }
}

function scheduleFlashCompleteTimeout(fn, delay) {
  var timerId = window.setTimeout(fn, delay);
  flashCompleteAnimTimers.push(timerId);
  return timerId;
}

function getFlashCompleteTodayAnimKey() {
  return [
    flashSession.cat || "",
    flashSession.wordNames.join("\u0001"),
    String(flashSession.answerLog.length),
    String(getTodaySeenCount())
  ].join("::");
}

function animateCountSlot(countEl, fromValue, toValue, options) {
  if (!countEl) {
    return;
  }
  options = options || {};
  var useComma = !!options.useComma;
  var tickClass = options.tickClass || "is-ticking";
  var stepMs = options.stepMs || 100;
  var from = Math.max(0, fromValue);
  var to = Math.max(0, toValue);
  var format = function (n) {
    return useComma ? formatWordCountLabel(n) : String(n);
  };

  var onDone = typeof options.onDone === "function" ? options.onDone : null;

  if (from === to) {
    countEl.textContent = format(to);
    if (onDone) {
      onDone();
    }
    return;
  }

  var current = from;
  var step = from < to ? 1 : -1;
  countEl.textContent = format(current);

  function stepOnce() {
    if (current === to) {
      countEl.textContent = format(to);
      if (onDone) {
        onDone();
      }
      return;
    }
    current += step;
    countEl.textContent = format(current);
    countEl.classList.remove(tickClass);
    void countEl.offsetWidth;
    countEl.classList.add(tickClass);
    scheduleFlashCompleteTimeout(stepOnce, stepMs);
  }

  scheduleFlashCompleteTimeout(stepOnce, stepMs);
}

function renderFlashCompleteToday() {
  var todayEl = document.getElementById("flashCompleteToday");
  if (!todayEl) {
    return;
  }

  var animKey = getFlashCompleteTodayAnimKey();
  if (animKey === flashCompleteTodayAnimKey && todayEl.childNodes.length) {
    return;
  }

  resetFlashCompleteTodayAnimation();
  flashCompleteTodayAnimKey = animKey;

  var seenEnd = getTodaySeenCount();
  var newlySeen = countSessionNewlySeenToday();
  var seenStart = Math.max(0, seenEnd - newlySeen);
  if (seenStart >= seenEnd && flashSession.answerLog.length > 0) {
    seenStart = Math.max(0, seenEnd - Math.min(FLASH_SESSION_SIZE, flashSession.answerLog.length));
  }

  todayEl.innerHTML = "";

  var todayMain = document.createElement("p");
  todayMain.className = "flash-complete-today-main";
  todayMain.appendChild(document.createTextNode("きょう 見た "));
  var seenCountEl = document.createElement("span");
  seenCountEl.className = "flash-complete-today-count flash-complete-today-seen-count";
  seenCountEl.textContent = String(seenStart);
  todayMain.appendChild(seenCountEl);
  todayMain.appendChild(document.createTextNode(" / " + FLASH_TODAY_SEEN_GOAL + "語"));
  todayMain.classList.toggle("is-goal-met", seenEnd >= FLASH_TODAY_SEEN_GOAL);
  todayEl.appendChild(todayMain);

  updateFlashCompleteGoalDetail(seenStart);

  scheduleFlashCompleteTimeout(function () {
    animateCountSlot(seenCountEl, seenStart, seenEnd, {
      useComma: false,
      tickClass: "is-ticking",
      stepMs: 100,
      onDone: function () {
        if (seenStart < FLASH_TODAY_SEEN_GOAL && seenEnd >= FLASH_TODAY_SEEN_GOAL) {
          updateFlashCompleteGoalDetail(seenEnd);
        }
      }
    });
  }, 180);
}

function updateFlashCompleteProgress() {
  var progressEl = document.getElementById("flashCompleteProgress");
  var todayEl = document.getElementById("flashCompleteToday");
  if (!progressEl || !todayEl) {
    return;
  }

  progressEl.hidden = false;
  renderFlashCompleteToday();
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
      scheduleDailyLogSync();
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
      scheduleDailyLogSync();
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
    if (applyServerDailySeen(res.dailySeen)) {
      reconcileTodayAchievement({ allowUnmarkToday: true });
    }
  }
  roadmapData = res.roadmap || {};

  serverLearnedDatesMap = {};
  initialLearnedDatesMap = {};
  (roadmapData.learnedDates || []).forEach(function (d) {
    serverLearnedDatesMap[d] = true;
    initialLearnedDatesMap[d] = true;
  });

  syncAchievementCachesFromServer();
  ensureFlashLapState();
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
  document.getElementById("btnRoadmapDisplayMode").addEventListener("click", function () {
    toggleRoadmapDisplayMode();
  });
  document.getElementById("btnModeSearch").addEventListener("click", function () {
    switchMainMode("search");
  });

  document.getElementById("searchInput").addEventListener("input", function () {
    syncSearchClearButton();
    scheduleSearchFilterFromInput();
  });
  document.getElementById("searchInput").addEventListener("focus", showSearchChrome);
  var searchClearBtn = document.getElementById("searchClear");
  if (searchClearBtn) {
    searchClearBtn.addEventListener("click", function () {
      var input = document.getElementById("searchInput");
      if (!input) return;
      if (!input.value) {
        syncSearchClearButton();
        return;
      }
      input.value = "";
      syncSearchClearButton();
      input.focus();
      onSearchFilterChanged();
    });
  }
  syncSearchClearButton();

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
startRubyExtraPrefetch();

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
  /* B（追加辞書）を先に載せ、あとから A（DB語）で上書きする */
  if (extraRubyByWord) {
    for (var extraWord in extraRubyByWord) {
      if (Object.prototype.hasOwnProperty.call(extraRubyByWord, extraWord)) {
        byWord[extraWord] = extraRubyByWord[extraWord];
      }
    }
  }

  for (var i = 0; i < allWordsList.length; i++) {
    var item = allWordsList[i];
    var word = getWordKey(item);
    var ruby = (item.ruby || item.r || "").trim();
    if (!word || !ruby || word.length < MIN_VOCAB_RUBY_LENGTH) {
      continue;
    }
    if (isKanaOnlyWord(word)) {
      continue;
    }
    byWord[word] = ruby;
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
    if (!entry.word || isKanaOnlyWord(entry.word)) {
      continue;
    }
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

  var run = document.createElement("span");
  run.className = "vocab-ruby-run";

  var entries = getVocabularyRubyEntries();
  var matches = findVocabularyRubyMatches(text, entries);
  if (!matches.length) {
    run.textContent = text;
    container.appendChild(run);
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

  run.appendChild(fragment);
  container.appendChild(run);
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
    renderCurrentLearnCat(true);
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

function syncSearchClearButton() {
  var input = document.getElementById("searchInput");
  var clearBtn = document.getElementById("searchClear");
  if (!clearBtn || !input) return;
  clearBtn.hidden = !String(input.value || "").length;
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

function getExamCountdownDays() {
  var todayKey = getTodayJSTStr();
  var todayParts = todayKey.split("-").map(Number);
  var examParts = EXAM_DATE_JST.split("-").map(Number);
  if (todayParts.length !== 3 || examParts.length !== 3) {
    return null;
  }
  var todayUtc = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);
  var examUtc = Date.UTC(examParts[0], examParts[1] - 1, examParts[2]);
  return Math.round((examUtc - todayUtc) / 86400000);
}

function updateExamCountdown() {
  var root = document.getElementById("examCountdown");
  var daysEl = document.getElementById("examCountdownDays");
  var labelEl = root ? root.querySelector(".exam-countdown-label") : null;
  var unitEl = root ? root.querySelector(".exam-countdown-unit") : null;
  if (!root || !daysEl || !labelEl || !unitEl) {
    return;
  }

  var days = getExamCountdownDays();
  root.classList.remove("is-exam-day", "is-exam-over");

  if (days === null) {
    labelEl.textContent = "試験まで 残り";
    daysEl.textContent = "—";
    unitEl.hidden = false;
    unitEl.textContent = "日";
    return;
  }

  if (days > 0) {
    labelEl.textContent = "試験まで 残り";
    daysEl.textContent = String(days);
    unitEl.hidden = false;
    unitEl.textContent = "日";
    return;
  }

  if (days === 0) {
    root.classList.add("is-exam-day");
    labelEl.textContent = "試験日";
    daysEl.textContent = "きょう";
    unitEl.hidden = true;
    return;
  }

  root.classList.add("is-exam-over");
  labelEl.textContent = "試験";
  daysEl.textContent = "おわり";
  unitEl.hidden = true;
}

function renderRoadmap() {
  if (!roadmapData) return;

  var todayKey = getTodayJSTStr();
  var totalLearned = getLiveTotalLearnedCount();
  var dynamicLearnedMap = buildLearnedDatesMap();
  var showKnown = isKnownRoadmapMode();
  var dailyCountMap = showKnown ? buildDailyLearnedCountMap() : buildDailySeenCountMap();
  var streakCount = getStreakCount();

  setDailyStatValue(document.getElementById("valStreak"), streakCount, "日");
  setDailyStatValue(document.getElementById("valTotalWords"), totalLearned, "語");
  refreshTodayLearnedDisplay();
  updateDailyStatLensUI();
  updateExamCountdown();
  updateRoadmapDisplayToggleUI();

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
      var dayCount = dailyCountMap ? (dailyCountMap[targetKey] || 0) : 0;

      if (targetKey < "2026-08-28") {
        symbol = "";
      } else if (targetKey > EXAM_DATE_JST) {
        symbol = "";
      } else if (showKnown && (dayCount > 0 || dynamicLearnedMap[targetKey])) {
        // 達成日で知ってる0語なら「0」を出す（例: 9/15）
        symbol = String(dayCount);
      } else if (!showKnown && (dynamicLearnedMap[targetKey] || dayCount >= FLASH_TODAY_SEEN_GOAL)) {
        symbol = "⭐️";
      } else if (targetKey === EXAM_DATE_JST) {
        symbol = "📘";
      } else if (targetKey > todayKey) {
        symbol = "⚪️";
      } else {
        symbol = "⬜️";
      }

      var tdDay = document.createElement("td");
      tdDay.textContent = symbol;
      if (/^\d+$/.test(symbol)) {
        tdDay.className = "roadmap-day-count";
      } else if (symbol === "⭐️") {
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
