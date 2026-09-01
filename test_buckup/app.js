var GAS_BASE_URL = "https://script.google.com/macros/s/AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec";
var LEARN_PAGE_SIZE = 5;
var CATEGORIES = ["基本", "介護", "医療", "社会"];

function isTestDeploy() {
  return /\/test(?:\/|$)/.test(window.location.pathname);
}

function getApiUrl() {
  var qs = "_t=" + Date.now();
  if (isTestDeploy()) {
    qs = "env=test&" + qs;
  }
  return GAS_BASE_URL + "?" + qs;
}

var WORDS_CACHE_KEY = "care_worker_words_cache_v2_test";
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
    var raw = localStorage.getItem(WORDS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeWordsCache(payload) {
  try {
    localStorage.setItem(WORDS_CACHE_KEY, JSON.stringify(payload));
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
    themeMeta.setAttribute("content", "#EA580C");
  }

  if (document.title.indexOf("【テスト】") !== 0) {
    document.title = "【テスト】" + document.title;
  }
}

var uiState = {
  mode: "learn",
  learnCat: "基本",
  detailsHidden: false,
  pageByCat: { "基本": 0, "介護": 0, "医療": 0, "社会": 0 }
};

var allWordsList = [];
var roadmapData = {};
var initialLearnedDatesMap = {};
var serverLearnedDatesMap = {};
var localAchievedDates = {};
var todayCommittedLearned = {};
var localLearnedOverrides = {};
var pendingChecks = {};
var postInFlightWords = {};
var pendingChecksSendPromise = Promise.resolve();
var searchCheckSendTimer = null;
var searchInputTimer = null;
var searchRenderToken = 0;
var SEARCH_RENDER_BATCH = 50;

var selectedStatuses = [];
var selectedCats = [];

var SMALL_GOALS = {
  "基本": [200, 250, 300, 400, 500, 600, 700, 750, 800, 900, 1000],
  "介護": [70, 100, 150, 200, 250, 300, 350, 400],
  "医療": [80, 100, 130, 170, 210, 250, 300, 350],
  "社会": [50, 75, 100, 125, 150, 200, 250]
};

var themeColors = {
  "基本": "#2563EB",
  "介護": "#16A34A",
  "医療": "#DC2626",
  "社会": "#9333EA"
};

function loadUiState() {
  uiState.mode = localStorage.getItem("saved_main_mode") || "learn";
  uiState.learnCat = localStorage.getItem("saved_learn_cat") || "基本";
  uiState.detailsHidden = localStorage.getItem("saved_details_hidden") === "true";

  var savedPages = JSON.parse(localStorage.getItem("saved_category_page") || "null");
  if (savedPages) {
    uiState.pageByCat = savedPages;
  }

  localAchievedDates = JSON.parse(localStorage.getItem("saved_achieved_dates") || "{}");
  todayCommittedLearned = loadTodayCommittedLearned();
  localLearnedOverrides = loadLocalLearnedOverrides();
}

function loadLocalLearnedOverrides() {
  try {
    return JSON.parse(sessionStorage.getItem("saved_local_learned_overrides") || "{}");
  } catch (e) {
    return {};
  }
}

function persistLocalLearnedOverrides() {
  sessionStorage.setItem("saved_local_learned_overrides", JSON.stringify(localLearnedOverrides));
}

function loadTodayCommittedLearned() {
  try {
    var saved = JSON.parse(sessionStorage.getItem("saved_today_committed_learned") || "null");
    if (!saved || saved.date !== getTodayJSTStr()) {
      return {};
    }
    return saved.words || {};
  } catch (e) {
    return {};
  }
}

function persistTodayCommittedLearned() {
  sessionStorage.setItem("saved_today_committed_learned", JSON.stringify({
    date: getTodayJSTStr(),
    words: todayCommittedLearned
  }));
}

function hasTodayCommittedLearned() {
  for (var wordName in todayCommittedLearned) {
    if (todayCommittedLearned.hasOwnProperty(wordName)) {
      return true;
    }
  }
  return false;
}

function reconcileTodayAchievement(options) {
  options = options || {};
  var todayKey = getTodayJSTStr();

  if (hasTodayCommittedLearned()) {
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
  localStorage.setItem("saved_achieved_dates", JSON.stringify(localAchievedDates));
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
  if (hasTodayCommittedLearned() && !map[todayKey]) {
    map[todayKey] = true;
  }

  return map;
}

function buildStreakDatesMap() {
  // 連続達成はサーバー記録の達成日だけを使う（未同期の今日分は含めない）
  return serverLearnedDatesMap;
}

function syncTodayCommittedLearnedWithServer() {
  var synced = {};

  for (var wordName in todayCommittedLearned) {
    if (!todayCommittedLearned.hasOwnProperty(wordName)) continue;

    if (localLearnedOverrides.hasOwnProperty(wordName) && localLearnedOverrides[wordName]) {
      synced[wordName] = true;
      continue;
    }

    var word = allWordsList.find(function (w) { return w.word === wordName; });
    if (word && word.isLearned) {
      synced[wordName] = true;
    }
  }

  todayCommittedLearned = synced;
  persistTodayCommittedLearned();
}

function syncAchievementCachesFromServer() {
  syncTodayCommittedLearnedWithServer();

  var todayKey = getTodayJSTStr();
  localAchievedDates = {};

  if (hasTodayCommittedLearned() && !serverLearnedDatesMap[todayKey]) {
    localAchievedDates[todayKey] = true;
  }
  persistAchievedDates();

  for (var wordName in localLearnedOverrides) {
    if (!localLearnedOverrides.hasOwnProperty(wordName)) continue;
    if (postInFlightWords[wordName]) continue;

    var target = allWordsList.find(function (w) { return w.word === wordName; });
    if (!target) {
      delete localLearnedOverrides[wordName];
      continue;
    }

    delete localLearnedOverrides[wordName];
  }
  persistLocalLearnedOverrides();
}

function getStreakCount() {
  return calculateStreakCount(buildStreakDatesMap());
}

function refreshStreakDisplay() {
  var streakEl = document.getElementById("valStreak");
  if (streakEl) {
    streakEl.textContent = getStreakCount() + " 日";
  }
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
    var k = formatDateStr(cursor);
    if (learnedMap[k]) {
      streakCount++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streakCount;
}

function calculateStreakCount(learnedMap) {
  var todayKey = getTodayJSTStr();
  var jstYesterday = getJSTDate();
  jstYesterday.setDate(jstYesterday.getDate() - 1);

  var yesterdayStreak = countStreakEndingAt(learnedMap, jstYesterday);
  if (learnedMap[todayKey]) {
    return yesterdayStreak + 1;
  }
  return yesterdayStreak;
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
    totalEl.textContent = getLiveTotalLearnedCount() + " 語";
  }

  refreshStreakDisplay();

  if (refreshRoadmapFully && uiState.mode === "daily") {
    renderRoadmap();
  }
}

function persistUiState() {
  localStorage.setItem("saved_main_mode", uiState.mode);
  localStorage.setItem("saved_learn_cat", uiState.learnCat);
  localStorage.setItem("saved_details_hidden", uiState.detailsHidden ? "true" : "false");
  localStorage.setItem("saved_category_page", JSON.stringify(uiState.pageByCat));
}

function getWordChecked(wordItem) {
  if (pendingChecks.hasOwnProperty(wordItem.word)) {
    return pendingChecks[wordItem.word];
  }
  if (localLearnedOverrides.hasOwnProperty(wordItem.word)) {
    return !!localLearnedOverrides[wordItem.word];
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
  var now = new Date();
  var utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  var jst = new Date(utc + (9 * 60 * 60000));
  return formatDateStr(jst);
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

function applyLearnListScrollMode(wordList) {
  wordList.classList.remove("word-list-fit", "word-list-fit-partial");
  wordList.classList.add("word-list-scroll");
}

function applyLearnListFitMode(wordList, isPartial) {
  wordList.classList.remove("word-list-scroll");
  wordList.classList.add("word-list-fit");
  wordList.classList.toggle("word-list-fit-partial", isPartial);
  wordList.scrollTop = 0;
}

function getLearnCardsStackHeight(wordList, cards) {
  if (cards.length === 0) return 0;

  var gap = parseFloat(getComputedStyle(wordList).rowGap) || 8;
  var stackHeight = 0;

  for (var i = 0; i < cards.length; i++) {
    stackHeight += cards[i].scrollHeight;
    if (i > 0) stackHeight += gap;
  }

  return stackHeight;
}

function measureLearnWordListAvailableHeight(wordList) {
  applyLearnListScrollMode(wordList);
  return wordList.clientHeight;
}

function canFitLearnListWithoutScroll(wordList, cards) {
  if (cards.length === 0) return false;

  var availableHeight = measureLearnWordListAvailableHeight(wordList);
  if (availableHeight <= 0) return false;

  return getLearnCardsStackHeight(wordList, cards) <= availableHeight;
}

var learnPageOffsetsCache = null;

function invalidateLearnPageOffsetsCache() {
  learnPageOffsetsCache = null;
}

function buildLearnPageOffsets(catName) {
  var list = getCategoryWords(catName);
  if (list.length === 0) return [0];

  var offsets = [0];
  for (var offset = LEARN_PAGE_SIZE; offset < list.length; offset += LEARN_PAGE_SIZE) {
    offsets.push(offset);
  }
  return offsets;
}

function getLearnPageOffsets(catName) {
  var list = getCategoryWords(catName);

  if (
    learnPageOffsetsCache &&
    learnPageOffsetsCache.cat === catName &&
    learnPageOffsetsCache.length === list.length
  ) {
    return learnPageOffsetsCache.offsets;
  }

  var offsets = buildLearnPageOffsets(catName);
  learnPageOffsetsCache = {
    cat: catName,
    length: list.length,
    offsets: offsets
  };
  return offsets;
}

function findLearnPageIndex(offsets, offset) {
  var idx = offsets.indexOf(offset);
  if (idx !== -1) return idx;

  var closest = 0;
  for (var i = 0; i < offsets.length; i++) {
    if (offsets[i] <= offset) closest = i;
    else break;
  }
  return closest;
}

function normalizeLearnPageOffset(catName) {
  var list = getCategoryWords(catName);
  if (list.length === 0) {
    uiState.pageByCat[catName] = 0;
    return 0;
  }

  var offset = uiState.pageByCat[catName] || 0;
  if (offset >= list.length) offset = 0;

  var offsets = getLearnPageOffsets(catName);
  var idx = findLearnPageIndex(offsets, offset);
  offset = offsets[idx];
  uiState.pageByCat[catName] = offset;
  return offset;
}

function getNextLearnPageOffset(catName, currentOffset) {
  var offsets = getLearnPageOffsets(catName);
  var idx = findLearnPageIndex(offsets, currentOffset);
  if (idx >= offsets.length - 1) return 0;
  return offsets[idx + 1];
}

function getPreviousLearnPageOffset(catName, currentOffset) {
  var offsets = getLearnPageOffsets(catName);
  var idx = findLearnPageIndex(offsets, currentOffset);
  if (idx <= 0) return offsets[offsets.length - 1];
  return offsets[idx - 1];
}

function syncLearnListLayout() {
  var wordList = document.getElementById("wordList");
  var panelLearn = document.getElementById("panelLearn");
  if (!wordList || !panelLearn || !panelLearn.classList.contains("active")) return;

  var cards = wordList.querySelectorAll(".word-card");
  if (cards.length === 0) return;

  if (canFitLearnListWithoutScroll(wordList, cards)) {
    applyLearnListFitMode(wordList, cards.length < LEARN_PAGE_SIZE);
  } else {
    applyLearnListScrollMode(wordList);
  }
}

function syncLearnListLayoutAfterPaint() {
  requestAnimationFrame(function () {
    syncLearnListLayout();
  });
}

var learnLayoutTimer = null;

function scheduleLearnListLayoutSync() {
  clearTimeout(learnLayoutTimer);
  learnLayoutTimer = setTimeout(function () {
    if (uiState.mode !== "learn") return;
    syncLearnListLayout();
  }, 150);
}

function getCategoryWords(catName) {
  var list = allWordsList.filter(function (w) { return w.category === catName; });
  list.sort(function (a, b) {
    return (a.originalIndex || 0) - (b.originalIndex || 0);
  });

  return list;
}

function getWordsForPage(catName, offset) {
  var list = getCategoryWords(catName);
  if (list.length === 0) return [];
  return list.slice(offset, offset + LEARN_PAGE_SIZE);
}

function getLearnPageInfo(catName) {
  var list = getCategoryWords(catName);
  if (list.length === 0) {
    return { current: 1, total: 1 };
  }

  var offsets = getLearnPageOffsets(catName);
  var pageOffset = normalizeLearnPageOffset(catName);

  return {
    current: findLearnPageIndex(offsets, pageOffset) + 1,
    total: offsets.length
  };
}

function updateLearnPageIndicator(catName) {
  var pageInfo = getLearnPageInfo(catName);

  document.getElementById("learnPageIndicator").textContent =
    pageInfo.current + " / " + pageInfo.total;
  document.getElementById("prevBtn").disabled = (pageInfo.total <= 1);
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
  reconcileTodayAchievement({ allowUnmarkToday: true });
  refreshLearnedCountDisplays(false);
  if (uiState.mode === "learn") {
    renderCurrentLearnCat();
  } else if (uiState.mode === "search") {
    onSearchFilterChanged();
  }
}

function applyLocalLearnedSnapshot(snapshot) {
  for (var wordName in snapshot) {
    if (!snapshot.hasOwnProperty(wordName)) continue;
    var item = allWordsList.find(function (w) { return w.word === wordName; });
    if (item) {
      item.isLearned = !!snapshot[wordName];
    }
  }
}

function mergePendingAndOverrideLearnedState() {
  for (var i = 0; i < allWordsList.length; i++) {
    var wordName = allWordsList[i].word;
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
      renderCurrentLearnCat();
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
        document.getElementById("learnHeaderText").textContent = "⚠️ 通信エラー: 再読み込みしてください";
      }
    });
}

function applyAppData(res, options) {
  options = options || {};

  if (res.error) {
    document.getElementById("learnHeaderText").textContent = "⚠️ " + res.error;
    return;
  }

  var rawWords = res.allWords || [];
  rawWords.forEach(function (w, idx) {
    w.originalIndex = idx;
  });
  allWordsList = rawWords;
  mergePendingAndOverrideLearnedState();
  roadmapData = res.roadmap || {};
  invalidateLearnPageOffsetsCache();

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
    return;
  }

  if (uiState.mode === "learn") {
    renderCurrentLearnCat();
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
  document.querySelector(".learn-tab-bar").addEventListener("click", function (e) {
    var btn = e.target.closest(".learn-tab-btn");
    if (!btn || !btn.dataset.cat) return;
    switchLearnCat(btn.dataset.cat);
  });

  document.getElementById("maskToggleBtn").addEventListener("click", toggleDetailsMask);
  document.getElementById("prevBtn").addEventListener("click", goBackLearnWords);
  document.getElementById("submitBtn").addEventListener("click", submitProgress);

  document.getElementById("wordList").addEventListener("click", function (e) {
    var card = e.target.closest(".word-card");
    if (!card || !card.dataset.word) return;
    onWordCardClick(card.dataset.word, card);
  });

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
  bindEvents();
  updateCategoryTabsUI();
  applyMaskStateUI();
  loadDataFromDB(true);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      bootPrefetchPromise = null;
      loadDataFromDB(false);
    }
  });

  window.addEventListener("resize", scheduleLearnListLayoutSync);
  window.addEventListener("orientationchange", scheduleLearnListLayoutSync);
};

startBootPrefetch();

function updateCategoryTabsUI() {
  document.querySelectorAll(".learn-tab-btn").forEach(function (btn) {
    btn.classList.remove("active");
  });
  var initCatBtn = document.querySelector(".learn-tab-btn.cat-" + uiState.learnCat);
  if (initCatBtn) initCatBtn.classList.add("active");
}

function toggleDetailsMask() {
  uiState.detailsHidden = !uiState.detailsHidden;
  persistUiState();
  applyMaskStateUI();
  scheduleLearnListLayoutSync();
}

function applyMaskStateUI() {
  var listEl = document.getElementById("wordList");
  var btnEl = document.getElementById("maskToggleBtn");
  if (uiState.detailsHidden) {
    listEl.classList.add("hide-details");
    btnEl.textContent = "みる";
    btnEl.setAttribute("aria-label", "英語と意味を見る");
  } else {
    listEl.classList.remove("hide-details");
    btnEl.textContent = "かくす";
    btnEl.setAttribute("aria-label", "英語と意味を隠す");
  }
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
    renderCurrentLearnCat();
  }

  refreshLearnedCountDisplays(mode === "daily");
}

function switchLearnCat(catName) {
  uiState.learnCat = catName;
  uiState.pageByCat[catName] = 0;
  persistUiState();
  invalidateLearnPageOffsetsCache();
  updateCategoryTabsUI();
  renderCurrentLearnCat();
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

function buildWordTextBlocks(item) {
  var fragment = document.createDocumentFragment();

  var jaBlock = document.createElement("div");
  jaBlock.className = "word-ja-block";

  var titleRow = document.createElement("div");
  titleRow.className = "word-title-row";

  var title = document.createElement("div");
  title.className = "word-title";
  title.textContent = item.word;

  titleRow.appendChild(title);

  var reading = document.createElement("div");
  reading.className = "word-reading";
  reading.textContent = item.ruby;
  titleRow.appendChild(reading);

  var eng = document.createElement("div");
  eng.className = "word-english";
  eng.textContent = item.english;
  titleRow.appendChild(eng);

  jaBlock.appendChild(titleRow);
  fragment.appendChild(jaBlock);

  var meaning = formatMeaningText(item.meaning);
  if (meaning) {
    var meaningEl = document.createElement("div");
    meaningEl.className = "word-meaning";
    meaningEl.textContent = meaning;
    fragment.appendChild(meaningEl);
  }

  var example = formatExampleText(item.example);
  if (example) {
    var exampleEl = document.createElement("div");
    exampleEl.className = "word-example";
    exampleEl.textContent = example;
    fragment.appendChild(exampleEl);
  }

  return fragment;
}

function createWordCard(item) {
  var card = document.createElement("div");
  card.className = "word-card";
  card.dataset.word = item.word;
  card.setAttribute("role", "listitem");

  var isChecked = getWordChecked(item);
  if (isChecked) {
    card.classList.add("checked");
  }

  var chkWrap = document.createElement("div");
  chkWrap.className = "word-chk-wrap";
  var innerChk = document.createElement("div");
  innerChk.className = "word-custom-chk chk-" + uiState.learnCat;
  innerChk.setAttribute("aria-hidden", "true");
  chkWrap.appendChild(innerChk);

  var content = document.createElement("div");
  content.className = "word-content";
  content.appendChild(buildWordTextBlocks(item));

  card.appendChild(chkWrap);
  card.appendChild(content);

  return card;
}

function onWordCardClick(wordName, cardEl) {
  var item = allWordsList.find(function (w) { return w.word === wordName; });
  if (!item) return;

  var newStatus = !getWordChecked(item);
  cardEl.classList.toggle("checked", newStatus);
  pendingChecks[wordName] = newStatus;
  updateLiveHeader();
  refreshLearnedCountDisplays(false);
}

function renderCurrentLearnCat() {
  var wordList = document.getElementById("wordList");
  var list = getCategoryWords(uiState.learnCat);
  var offset = normalizeLearnPageOffset(uiState.learnCat);
  var words = getWordsForPage(uiState.learnCat, offset);
  var color = themeColors[uiState.learnCat] || "#2563EB";

  var headerBanner = document.getElementById("learnHeaderBanner");
  headerBanner.className = "learn-header-banner bg-" + uiState.learnCat;

  document.getElementById("submitBtn").style.backgroundColor = color;

  wordList.innerHTML = "";

  if (words.length === 0 && allWordsList.length === 0) {
    document.getElementById("learnHeaderText").textContent = uiState.learnCat + "： 単語データがありません";
    updateLearnPageIndicator(uiState.learnCat);
    return;
  }

  words.forEach(function (item) {
    wordList.appendChild(createWordCard(item));
  });

  updateLearnPageIndicator(uiState.learnCat);
  updateLiveHeader();
  applyMaskStateUI();
  syncLearnListLayoutAfterPaint();
}

function updateLiveHeader() {
  var actualTotalInCat = allWordsList.filter(function (w) { return w.category === uiState.learnCat; }).length;
  var liveCatLearned = getLiveCategoryLearnedCount(uiState.learnCat);
  var headerText = document.getElementById("learnHeaderText");
  var catName = uiState.learnCat;

  if (actualTotalInCat === 0) {
    headerText.textContent = "登録単語 0 語";
    return;
  }

  if (liveCatLearned >= actualTotalInCat) {
    headerText.textContent = "全 " + actualTotalInCat + " 語 復習中 🔄";
    return;
  }

  var nextGoal = getNextSmallGoal(catName, liveCatLearned, actualTotalInCat);
  var remaining = Math.max(0, nextGoal - liveCatLearned);
  var catGoals = SMALL_GOALS[catName] || [];
  var isExactGoal = liveCatLearned > 0 && catGoals.indexOf(liveCatLearned) !== -1;
  var nextLabel = "　つぎは " + nextGoal + "語（あと" + remaining + "語）";
  var progressLabel;

  if (isExactGoal) {
    progressLabel = liveCatLearned + "語 おぼえた!! 🎉";
  } else if (liveCatLearned > 0) {
    progressLabel = liveCatLearned + "語 おぼえた";
  } else {
    progressLabel = "スタート";
  }

  headerText.textContent = progressLabel + nextLabel;
}

function submitProgress() {
  var list = getCategoryWords(uiState.learnCat);
  if (list.length === 0) return;

  invalidateLearnPageOffsetsCache();
  var currentOffset = uiState.pageByCat[uiState.learnCat] || 0;
  uiState.pageByCat[uiState.learnCat] = getNextLearnPageOffset(uiState.learnCat, currentOffset);
  persistUiState();

  flushPendingChecksNow();
  renderCurrentLearnCat();
}

function goBackLearnWords() {
  var list = getCategoryWords(uiState.learnCat);
  if (list.length === 0) return;

  invalidateLearnPageOffsetsCache();
  var currentOffset = uiState.pageByCat[uiState.learnCat] || 0;
  uiState.pageByCat[uiState.learnCat] = getPreviousLearnPageOffset(uiState.learnCat, currentOffset);
  persistUiState();

  flushPendingChecksNow();
  renderCurrentLearnCat();
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
  itemRow.dataset.word = item.word;
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
  var item = allWordsList.find(function (w) { return w.word === wordName; });
  if (!item) return;

  var newStatus = !getWordChecked(item);
  rowEl.classList.toggle("checked", newStatus);
  pendingChecks[wordName] = newStatus;
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

  document.getElementById("valStreak").textContent = streakCount + " 日";
  document.getElementById("valTotalWords").textContent = totalLearned + " 語";

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
