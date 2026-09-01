var GAS_BASE_URL = "https://script.google.com/macros/s/AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec";
var FLASH_SESSION_SIZE = 5;
var FLASH_EXIT_KNOWN_MS = 480;
var FLASH_EXIT_SKIP_MS = 360;
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

function readWordsCache() {
  try {
    var raw = localStorage.getItem(getStorageKey("care_worker_words_cache_v3"));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeWordsCache(payload) {
  try {
    localStorage.setItem(getStorageKey("care_worker_words_cache_v3"), JSON.stringify(payload));
  } catch (e) {}
}

function normalizeWordItem(item) {
  if (!item || item.word !== undefined) {
    return item;
  }
  return {
    word: item.w,
    category: item.c,
    ruby: item.r,
    english: item.e,
    meaning: item.m,
    example: item.x,
    isLearned: !!item.l
  };
}

function normalizeApiPayload(res) {
  if (!res || res.error) {
    return res;
  }
  return {
    allWords: (res.allWords || []).map(normalizeWordItem),
    roadmap: res.roadmap || {}
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
var searchInputTimer = null;
var searchRenderToken = 0;
var SEARCH_RENDER_BATCH = 50;
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
  "基本": "#4255FF",
  "介護": "#23B26D",
  "医療": "#E11D48",
  "社会": "#A855F7"
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
  todayCommittedLearned = loadTodayCommittedLearned();
  todaySkippedWords = loadTodaySkippedWords();
  pendingChecks = loadPendingChecksFromStorage();
  localLearnedOverrides = loadLocalLearnedOverrides();
  trackedJSTDateKey = getTodayJSTStr();
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
  localStorage.setItem(getStorageKey("saved_today_committed_learned"), JSON.stringify({
    date: getTodayJSTStr(),
    words: todayCommittedLearned
  }));
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

  trackedJSTDateKey = todayKey;
  todayCommittedLearned = loadTodayCommittedLearned();
  todaySkippedWords = loadTodaySkippedWords();
  pendingChecks = loadPendingChecksFromStorage();
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

function getTodayLearnedCount() {
  var counted = {};
  var count = 0;

  for (var wordName in todayCommittedLearned) {
    if (!todayCommittedLearned.hasOwnProperty(wordName)) continue;
    if (!counted[wordName]) {
      counted[wordName] = true;
      count++;
    }
  }

  for (var pendingName in pendingChecks) {
    if (!pendingChecks.hasOwnProperty(pendingName)) continue;
    if (pendingChecks[pendingName] && !counted[pendingName]) {
      counted[pendingName] = true;
      count++;
    }
  }

  return count;
}

function hasTodayAchievement() {
  var todayKey = getTodayJSTStr();
  return !!(serverLearnedDatesMap[todayKey] || hasTodayCommittedLearned());
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
    if (!serverLearnedDatesMap[todayKey]) {
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
  for (var dKey in serverLearnedDatesMap) {
    if (serverLearnedDatesMap.hasOwnProperty(dKey)) {
      map[dKey] = true;
    }
  }

  var todayKey = getTodayJSTStr();
  if (hasTodayAchievement() && !map[todayKey]) {
    map[todayKey] = true;
  }

  return map;
}

function hasTodayStreakAchievement() {
  var todayKey = getTodayJSTStr();
  if (serverLearnedDatesMap[todayKey]) {
    return true;
  }
  return getTodayLearnedCount() > 0;
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

  var jstYesterday = getJSTDate();
  jstYesterday.setUTCDate(jstYesterday.getUTCDate() - 1);
  return countStreakEndingAt(map, jstYesterday);
}

function shouldKeepTodayCommittedWord(wordName) {
  if (postInFlightWords[wordName]) {
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

// れんぞく達成 = 昨日までの連続 +（今日1語以上覚えたら +1）
// 例: 昨日まで10日 → 今日達成前10日、達成後11日。昨日まで0日 → 達成前0日、達成後1日。
function getStreakCount() {
  var streakThroughYesterday = getYesterdayStreakCount();
  if (hasTodayStreakAchievement()) {
    return streakThroughYesterday + 1;
  }
  return streakThroughYesterday;
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

function getJSTDate(baseDate) {
  var checkDate = baseDate ? new Date(baseDate.getTime()) : new Date();
  var utc = checkDate.getTime() + (checkDate.getTimezoneOffset() * 60000);
  return new Date(utc + (9 * 60 * 60000));
}

function countStreakEndingAt(learnedMap, jstDate) {
  var streakCount = 0;
  var cursor = new Date(jstDate.getTime());

  while (true) {
    var k = formatJSTDateStr(cursor);
    if (learnedMap[k]) {
      streakCount++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
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
  var utc = base.getTime() + (base.getTimezoneOffset() * 60000);
  var jst = new Date(utc + (9 * 60 * 60000));
  var y = jst.getUTCFullYear();
  var m = ("0" + (jst.getUTCMonth() + 1)).slice(-2);
  var d = ("0" + jst.getUTCDate()).slice(-2);
  return y + "-" + m + "-" + d;
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

function getUnlearnedCategoryWords(catName) {
  return getCategoryWords(catName).filter(function (w) {
    var wordName = getWordKey(w);
    if (!wordName || getWordChecked(w) || isWordSkippedToday(wordName)) {
      return false;
    }
    return true;
  });
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

function getLearnModeLabel(catName) {
  if (catName === LEARN_MODE_AUTO) {
    return "すべて";
  }
  return catName;
}

function pickWordNamesFromCategory(catName, count) {
  var unlearned = getUnlearnedCategoryWords(catName);
  var names = [];
  for (var i = 0; i < unlearned.length && names.length < count; i++) {
    var wordName = getWordKey(unlearned[i]);
    if (wordName) {
      names.push(wordName);
    }
  }
  return names;
}

// 方針A: 未学習が5未満でもその数だけ出題。他カテゴリからの補充はしない。
function buildAutoFlashSessionWordNames() {
  var names = [];
  CATEGORIES.forEach(function (catName) {
    var count = AUTO_SESSION_PLAN[catName] || 0;
    if (count > 0) {
      names = names.concat(pickWordNamesFromCategory(catName, count));
    }
  });
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
  var revealBtn = document.getElementById("flashRevealBtn");
  var answerBtns = document.getElementById("flashAnswerBtns");
  if (!revealBtn || !answerBtns) return;

  var inStudy = !flashSession.completed && flashSession.wordNames.length > 0;
  var showReveal = inStudy && !flashSession.revealed && !flashSession.advancing;
  var showAnswer = inStudy && flashSession.revealed && !flashSession.advancing;

  revealBtn.hidden = !showReveal;
  answerBtns.hidden = !showAnswer;
}

function clearFlashcardAnimationState() {
  var card = document.getElementById("flashcard");
  if (!card) return;

  card.style.transition = "none";
  card.classList.remove("is-leaving-known", "is-leaving-skip", "is-arriving", "is-arriving-prep");
  card.style.removeProperty("opacity");
  card.style.removeProperty("transform");
  void card.offsetWidth;
  card.style.removeProperty("transition");
}

function flashButtonPressFeedback(markLearned) {
  var btnId = markLearned ? "flashKnownBtn" : "flashUnknownBtn";
  var btn = document.getElementById(btnId);
  if (!btn) return;

  btn.classList.remove("is-pressed-feedback");
  void btn.offsetWidth;
  btn.classList.add("is-pressed-feedback");
  window.setTimeout(function () {
    btn.classList.remove("is-pressed-feedback");
  }, 180);
}

function playFlashAdvanceFeedback(markLearned, done) {
  var card = document.getElementById("flashcard");
  var dotsEl = document.getElementById("flashProgressDots");
  var currentDot = dotsEl ? dotsEl.children[flashSession.index] : null;
  var duration = prefersReducedMotion()
    ? 200
    : (markLearned ? FLASH_EXIT_KNOWN_MS : FLASH_EXIT_SKIP_MS);

  if (!card) {
    if (done) done();
    return;
  }

  flashButtonPressFeedback(markLearned);
  clearFlashcardAnimationState();

  if (currentDot) {
    currentDot.style.transition = markLearned
      ? "transform 0.2s cubic-bezier(0.33, 1, 0.68, 1), background-color 0.2s ease, border-color 0.2s ease"
      : "background-color 0.18s ease, border-color 0.18s ease";
    if (markLearned) {
      currentDot.style.transform = "scale(1.1)";
    }
    currentDot.style.backgroundColor = "var(--learn-color-progress-done)";
    currentDot.style.borderColor = "var(--learn-color-progress-done)";
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
  var item = getCurrentFlashWordItem();
  var currentColor = themeColors[getFlashThemeCat(item)] || "#64748B";

  for (var i = 0; i < total; i++) {
    var dot = document.createElement("span");
    dot.className = "flash-progress-dot";
    dot.setAttribute("aria-hidden", "true");
    if (i < flashSession.index) {
      dot.classList.add("is-done");
    } else if (i === flashSession.index) {
      dot.classList.add("is-current");
      dot.style.backgroundColor = currentColor;
      dot.style.borderColor = currentColor;
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

function setFlashRevealState(isRevealed) {
  flashSession.revealed = isRevealed;

  var card = document.getElementById("flashcard");
  var back = document.getElementById("flashcardBack");
  if (!card || !back) return;

  back.setAttribute("aria-hidden", isRevealed ? "false" : "true");
  back.setAttribute("aria-label", isRevealed ? "タップで答えを隠す" : "タップで答えを表示");

  if (isRevealed) {
    card.classList.add("revealed");
  } else {
    card.classList.remove("revealed");
  }

  updateFlashAnswerButtonsVisibility();
  updateFlashUndoButton();
}

function toggleFlashcardAnswer() {
  if (!flashInteractionReady || flashSession.completed || flashSession.advancing) return;

  var item = getCurrentFlashWordItem();
  if (!item) return;

  if (flashSession.revealed) {
    setFlashRevealState(false);
    return;
  }

  fillFlashcardAnswer(item);
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
}

function getFlashSessionAnswerCounts() {
  var knownCount = 0;
  var skippedCount = 0;

  flashSession.answerLog.forEach(function (entry) {
    if (entry.markLearned) {
      knownCount++;
    } else {
      skippedCount++;
    }
  });

  return {
    knownCount: knownCount,
    skippedCount: skippedCount
  };
}

function buildFlashCompleteCopy(total, counts) {
  var knownCount = counts.knownCount;
  var skippedCount = counts.skippedCount;
  var copy = {
    message: total + "つ おわり！ おつかれさま",
    detail: "",
    detailHidden: true,
    restartLabel: "もう" + total + "つ つづける"
  };

  if (knownCount === total && total > 0) {
    copy.message = total + "つ ぜんぶ おぼえた！ 🎉";
    copy.restartLabel = "もう" + total + "つ やる";
    return copy;
  }

  if (knownCount === 0 && skippedCount === total && total > 0) {
    copy.message = total + "つ おわり！ また チャレンジしよう";
    copy.detail = "むずかしかった ことばは また でます";
    copy.detailHidden = false;
    return copy;
  }

  if (skippedCount > 0) {
    copy.message = total + "つ おわり！ おつかれさま";
    copy.detail = "おぼえた " + knownCount + "　まだ " + skippedCount;
    copy.detailHidden = false;
    return copy;
  }

  return copy;
}

function updateFlashCompleteUI() {
  var messageEl = document.getElementById("flashCompleteMessage");
  var detailEl = document.getElementById("flashCompleteDetail");
  var restartBtn = document.getElementById("flashRestartBtn");
  if (!messageEl || !restartBtn) return;

  if (flashSession.wordNames.length === 0) {
    messageEl.textContent = "単語がありません";
    if (detailEl) {
      detailEl.textContent = "";
      detailEl.hidden = true;
    }
    restartBtn.textContent = "もう" + FLASH_SESSION_SIZE + "つ つづける";
    return;
  }

  var total = flashSession.initialCount || flashSession.wordNames.length;
  var copy = buildFlashCompleteCopy(total, getFlashSessionAnswerCounts());

  messageEl.textContent = copy.message;
  restartBtn.textContent = copy.restartLabel;

  if (!detailEl) return;

  if (copy.detailHidden || !copy.detail) {
    detailEl.textContent = "";
    detailEl.hidden = true;
    return;
  }

  detailEl.textContent = copy.detail;
  detailEl.hidden = false;
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
    updateFlashCompleteUI();
    document.getElementById("flashRestartBtn").hidden = flashSession.wordNames.length === 0;

    document.getElementById("flashFinishBtn").hidden = flashSession.wordNames.length === 0;

    updateLiveHeader();
    updateCategoryTabsUI();
    updateFlashUndoButton();
    updateFlashAnswerButtonsVisibility();
    return;
  }

  studyEl.hidden = false;
  completeEl.hidden = true;
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

  var item = getCurrentFlashWordItem();
  if (!item) return;

  flashSession.advancing = true;
  setFlashAnswerButtonsBusy(true);

  var wordName = getWordKey(item);
  var undoSnapshot = captureFlashUndoSnapshot(wordName);
  if (markLearned && wordName) {
    applyKnownWordState(wordName);
  } else if (!markLearned && wordName) {
    markWordSkippedToday(wordName);
  }

  flashSession.answerLog.push({
    wordName: wordName,
    markLearned: markLearned,
    undoSnapshot: undoSnapshot
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
    .catch(function (err) {
      console.error("チェック同期エラー:", err);
    });
}

function flushPendingChecksOnce() {
  var wordsToCommit = Object.keys(pendingChecks);
  if (wordsToCommit.length === 0) {
    return Promise.resolve();
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
    currentWords: []
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
      applyAppData(res, { isInitial: isInitial, fromCache: false });
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
    switchMainMode(uiState.mode);
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

  var front = document.querySelector(".flashcard-front");
  var back = document.getElementById("flashcardBack");

  function bindFlashReveal(el) {
    if (!el) return;
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleFlashcardAnswer();
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleFlashcardAnswer();
      }
    });
  }

  bindFlashReveal(front);
  bindFlashReveal(back);
  document.getElementById("flashRevealBtn").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (!flashSession.revealed) {
      toggleFlashcardAnswer();
    }
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

  document.getElementById("searchResultList").addEventListener("click", function (e) {
    var chkWrap = e.target.closest(".search-item-chk-wrap");
    if (!chkWrap) return;
    var row = chkWrap.closest(".search-item-row");
    if (!row || !row.dataset.word) return;
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
}

window.onload = function () {
  applyDeployEnvUI();
  loadUiState();
  updateViewportForMode(uiState.mode);
  bindEvents();
  updateCategoryTabsUI();
  loadDataFromDB(true);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;

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
};

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

function switchMainMode(mode) {
  if ((mode === "daily" || mode === "search") && uiState.mode === "learn") {
    flushPendingChecksNow();
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
    onSearchFilterChanged();
  } else if (mode === "daily") {
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

  var newStatus = !getWordChecked(item);
  rowEl.classList.toggle("checked", newStatus);
  pendingChecks[wordName] = newStatus;
  persistPendingChecksToStorage();
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
    statusLabel = "おぼえた単語";
  } else if (hasUnlearned && !hasLearned) {
    statusLabel = "おぼえていない単語";
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

function onSearchFilterChanged() {
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
    if (isCurrentWeek) {
      weekLabel = "👉 " + startStr;
    } else if (w === totalWeeks - 1) {
      weekLabel = "📘 " + startStr;
    }

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
