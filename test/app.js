var GAS_BASE_URL = "https://script.google.com/macros/s/AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec";

function getApiUrl() {
  return GAS_BASE_URL + "?env=test&_t=" + Date.now();
}

var currentMode = localStorage.getItem("saved_main_mode") || "learn";
var currentLearnCat = localStorage.getItem("saved_learn_cat") || "基本";
var isDetailsHidden = localStorage.getItem("saved_details_hidden") === "true";

var allWordsList = [];
var roadmapData = {};
var initialLearnedDatesMap = {};

// 現在画面上で操作中の仮チェック状態（更新ボタンを押すまで未確定）
var temporaryCheckedMap = {};

var categoryPage = {
  "基本": 0,
  "介護": 0,
  "医療": 0,
  "社会": 0
};

var SMALL_GOALS = {
  "基本": [200, 250, 300, 400, 500, 600, 700, 750, 800],
  "介護": [70, 100, 150, 200, 250, 300],
  "医療": [80, 100, 130, 170, 210, 250],
  "社会": [50, 75, 100, 125, 150]
};

var selectedStatuses = [];
var selectedCats = [];

var themeColors = {
  "基本": "#2563EB",
  "介護": "#16A34A",
  "医療": "#DC2626",
  "社会": "#9333EA"
};

function getTodayJSTStr() {
  var now = new Date();
  var utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  var jst = new Date(utc + (9 * 60 * 60000));
  return formatDateStr(jst);
}

function getNextSmallGoal(catName, currentCount, maxCount) {
  var goals = SMALL_GOALS[catName] || [];
  for (var i = 0; i < goals.length; i++) {
    if (goals[i] > currentCount) {
      return Math.min(goals[i], maxCount);
    }
  }
  return maxCount;
}

// 未学習の単語を先に出し、全単語にチェックがついている場合（復習中）のみ学習済み単語を出す
function getCategoryWords(catName) {
  var list = allWordsList.filter(function (w) { return w.category === catName; });
  
  list.sort(function (a, b) {
    return (a.originalIndex || 0) - (b.originalIndex || 0);
  });

  var unlearned = list.filter(function (w) { return !w.isLearned; });
  var learned = list.filter(function (w) { return w.isLearned; });

  // 未学習が1件以上あれば未学習のみ、全件チェック済みなら学習済みを対象にする
  if (unlearned.length > 0) {
    return unlearned;
  } else {
    return learned;
  }
}

function getCurrentWords(catName) {
  var list = getCategoryWords(catName);
  if (list.length === 0) return [];
  var page = categoryPage[catName] || 0;
  if (page >= list.length) {
    page = 0;
    categoryPage[catName] = 0;
  }
  return list.slice(page, page + 5);
}

function getCategoryLearnedCount(catName) {
  return allWordsList.filter(function (w) {
    return w.category === catName && w.isLearned;
  }).length;
}

function getTotalLearnedCount() {
  return allWordsList.filter(function (w) {
    return w.isLearned;
  }).length;
}

// 更新ボタン（つぎへ／まえへ）押下時に現在の5単語を確定・db送信する関数
function commitAndSaveCurrentWords() {
  var currentWords = getCurrentWords(currentLearnCat);
  if (currentWords.length === 0) return;

  var checkedWords = [];
  var uncheckedWords = [];

  currentWords.forEach(function (w) {
    var finalStatus = temporaryCheckedMap.hasOwnProperty(w.word)
      ? temporaryCheckedMap[w.word]
      : !!w.isLearned;

    w.isLearned = finalStatus;

    if (finalStatus) {
      checkedWords.push(w.word);
    } else {
      uncheckedWords.push(w.word);
    }
  });

  temporaryCheckedMap = {};

  fetch(getApiUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      category: currentLearnCat,
      checkedWords: checkedWords,
      uncheckedWords: uncheckedWords,
      currentWords: []
    }),
    keepalive: true
  }).catch(function (err) {
    console.error("DB送信エラー:", err);
  });
}

// dbから確定済みデータを取得して画面描画
function loadDataFromDB(isInitial) {
  temporaryCheckedMap = {};

  if (isInitial) {
    showLoading(true);
  }

  fetch(getApiUrl())
    .then(function (res) { return res.json(); })
    .then(function (res) {
      if (isInitial) {
        showLoading(false);
      }
      if (res.error) {
        document.getElementById("learnHeaderText").textContent = "⚠️ " + res.error;
        return;
      }

      var rawWords = res.allWords || [];
      rawWords.forEach(function (w, idx) {
        w.originalIndex = idx;
      });
      allWordsList = rawWords;
      roadmapData = res.roadmap || {};

      initialLearnedDatesMap = {};
      (roadmapData.learnedDates || []).forEach(function (d) {
        initialLearnedDatesMap[d] = true;
      });

      renderCurrentLearnCat();
      onSearchFilterChanged();

      if (currentMode === "daily") {
        renderRoadmap();
      }

      if (isInitial) {
        switchMainMode(currentMode);
      }
    })
    .catch(function (err) {
      if (isInitial) {
        showLoading(false);
      }
      document.getElementById("learnHeaderText").textContent = "⚠️ 通信エラー: 再読み込みしてください";
    });
}

window.onload = function () {
  updateCategoryTabsUI();
  applyMaskStateUI();

  var savedPages = JSON.parse(localStorage.getItem("saved_category_page") || "null");
  if (savedPages) {
    categoryPage = savedPages;
  }

  loadDataFromDB(true);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      loadDataFromDB(false);
    }
  });
};

function updateCategoryTabsUI() {
  document.querySelectorAll(".learn-tab-btn").forEach(function (btn) {
    btn.classList.remove("active");
  });
  var initCatBtn = document.querySelector(".learn-tab-btn.cat-" + currentLearnCat);
  if (initCatBtn) initCatBtn.classList.add("active");
}

function toggleDetailsMask() {
  isDetailsHidden = !isDetailsHidden;
  localStorage.setItem("saved_details_hidden", isDetailsHidden ? "true" : "false");
  applyMaskStateUI();
}

function applyMaskStateUI() {
  var listEl = document.getElementById("wordList");
  var btnEl = document.getElementById("maskToggleBtn");
  if (isDetailsHidden) {
    listEl.classList.add("hide-details");
    btnEl.textContent = "みせる";
  } else {
    listEl.classList.remove("hide-details");
    btnEl.textContent = "かくす";
  }
}

// 画面モード切り替え（ことば / まいにち / さがす）
function switchMainMode(mode) {
  if (currentMode === "learn" && mode !== "learn") {
    commitAndSaveCurrentWords();
  }

  currentMode = mode;
  localStorage.setItem("saved_main_mode", mode);

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
  }
}

// カテゴリー切り替え
function switchLearnCat(catName) {
  commitAndSaveCurrentWords();

  currentLearnCat = catName;
  localStorage.setItem("saved_learn_cat", catName);
  updateCategoryTabsUI();
  categoryPage[currentLearnCat] = 0; // カテゴリー変更時は先頭ページにリセット
  renderCurrentLearnCat();
}

function renderCurrentLearnCat() {
  var words = getCurrentWords(currentLearnCat);
  var color = themeColors[currentLearnCat] || "#2563EB";

  var headerBanner = document.getElementById("learnHeaderBanner");
  headerBanner.className = "learn-header-banner bg-" + currentLearnCat;

  var submitBtn = document.getElementById("submitBtn");
  submitBtn.style.backgroundColor = color;

  var prevBtn = document.getElementById("prevBtn");
  prevBtn.disabled = ((categoryPage[currentLearnCat] || 0) === 0);

  var wordList = document.getElementById("wordList");
  wordList.innerHTML = "";

  if (words.length === 0 && allWordsList.length === 0) {
    document.getElementById("learnHeaderText").textContent = currentLearnCat + "： 単語データがありません";
    return;
  }

  words.forEach(function (item, idx) {
    var card = document.createElement("div");
    card.className = "word-card";
    card.id = "card-" + idx;

    var isChecked = temporaryCheckedMap.hasOwnProperty(item.word)
      ? temporaryCheckedMap[item.word]
      : !!item.isLearned;

    if (isChecked) {
      card.classList.add("checked");
    }

    card.onclick = function (e) {
      var currentStatus = temporaryCheckedMap.hasOwnProperty(item.word)
        ? temporaryCheckedMap[item.word]
        : !!item.isLearned;
      var newStatus = !currentStatus;

      card.classList.toggle("checked", newStatus);
      temporaryCheckedMap[item.word] = newStatus;

      updateLiveHeader();
    };

    var chkWrap = document.createElement("div");
    chkWrap.className = "word-chk-wrap";
    var innerChk = document.createElement("div");
    innerChk.className = "word-custom-chk chk-" + currentLearnCat;
    chkWrap.appendChild(innerChk);

    var content = document.createElement("div");
    content.className = "word-content";

    var mainRow = document.createElement("div");
    mainRow.className = "word-main-row";

    var title = document.createElement("div");
    title.className = "word-title";
    title.textContent = item.word + " (" + item.ruby + ")";

    var eng = document.createElement("div");
    eng.className = "word-english";
    eng.textContent = item.english;

    mainRow.appendChild(title);
    mainRow.appendChild(eng);

    var detail = document.createElement("div");
    detail.className = "word-detail";
    detail.textContent = item.meaning + (item.example ? "\n" + item.example : "");

    content.appendChild(mainRow);
    content.appendChild(detail);

    card.appendChild(chkWrap);
    card.appendChild(content);

    wordList.appendChild(card);
  });

  updateLiveHeader();
  applyMaskStateUI();
}

function updateLiveHeader() {
  var list = getCategoryWords(currentLearnCat);
  var totalInCat = list.length;
  var catLearned = getCategoryLearnedCount(currentLearnCat);

  var currentWords = getCurrentWords(currentLearnCat);
  var pendingDiff = 0;
  currentWords.forEach(function (w) {
    if (temporaryCheckedMap.hasOwnProperty(w.word)) {
      var tempStatus = temporaryCheckedMap[w.word];
      if (tempStatus && !w.isLearned) pendingDiff++;
      if (!tempStatus && w.isLearned) pendingDiff--;
    }
  });

  var liveCatLearned = Math.max(0, catLearned + pendingDiff);

  var headerText = document.getElementById("learnHeaderText");

  if (totalInCat === 0) {
    headerText.textContent = currentLearnCat + "： 登録単語 0 語";
    return;
  }

  if (liveCatLearned >= totalInCat && totalInCat > 0) {
    headerText.textContent = currentLearnCat + "： 全 " + totalInCat + " 語 復習中 🔄";
    return;
  }

  var currentGoal = getNextSmallGoal(currentLearnCat, liveCatLearned, totalInCat);
  var remaining = Math.max(0, currentGoal - liveCatLearned);

  headerText.textContent = currentLearnCat + "： " + liveCatLearned + " / " + currentGoal + " 語 （あと " + remaining + " 語）";
}

// 更新ボタン（つぎへ）
function submitProgress() {
  var list = getCategoryWords(currentLearnCat);
  if (list.length === 0) return;

  commitAndSaveCurrentWords();

  var nextPage = (categoryPage[currentLearnCat] || 0) + 5;
  if (nextPage >= list.length) {
    nextPage = 0;
  }
  categoryPage[currentLearnCat] = nextPage;
  localStorage.setItem("saved_category_page", JSON.stringify(categoryPage));

  renderCurrentLearnCat();
}

// 更新ボタン（まえへ）
function goBackLearnWords() {
  var list = getCategoryWords(currentLearnCat);
  if (list.length === 0) return;

  var currentPage = categoryPage[currentLearnCat] || 0;
  if (currentPage <= 0) return;

  commitAndSaveCurrentWords();

  var prevPage = Math.max(0, currentPage - 5);
  categoryPage[currentLearnCat] = prevPage;
  localStorage.setItem("saved_category_page", JSON.stringify(categoryPage));

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

function onSearchFilterChanged() {
  var query = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  var listEl = document.getElementById("searchResultList");
  listEl.innerHTML = "";

  var matchCount = 0;
  var hasCatFilter = (selectedCats.length > 0);
  var hasStatusFilter = (selectedStatuses.length > 0);

  var sortedList = [].concat(allWordsList);
  sortedList.sort(function (a, b) {
    return (a.originalIndex || 0) - (b.originalIndex || 0);
  });

  for (var i = 0; i < sortedList.length; i++) {
    var item = sortedList[i];

    if (hasCatFilter && selectedCats.indexOf(item.category) === -1) continue;

    if (hasStatusFilter) {
      var itemStatus = item.isLearned ? "learned" : "unlearned";
      if (selectedStatuses.indexOf(itemStatus) === -1) continue;
    }

    if (query !== "") {
      var w = (item.word || "").toLowerCase();
      var r = (item.ruby || "").toLowerCase();
      var e = (item.english || "").toLowerCase();

      var isPrefixMatch = (w.indexOf(query) === 0 || r.indexOf(query) === 0 || e.indexOf(query) === 0);
      if (!isPrefixMatch) {
        continue;
      }
    }

    matchCount++;

    var itemRow = document.createElement("div");
    itemRow.className = "search-item-row";

    var headerLine = document.createElement("div");
    headerLine.className = "search-item-header";

    var catBadge = document.createElement("span");
    catBadge.className = "search-item-badge bg-" + item.category;
    catBadge.textContent = item.category;

    var titleSpan = document.createElement("span");
    titleSpan.className = "search-item-title";
    titleSpan.textContent = item.word + " (" + item.ruby + ")";

    var engSpan = document.createElement("span");
    engSpan.className = "search-item-english";
    engSpan.textContent = item.english;

    headerLine.appendChild(catBadge);
    headerLine.appendChild(titleSpan);
    headerLine.appendChild(engSpan);

    var detailLine = document.createElement("div");
    detailLine.className = "search-item-detail";
    detailLine.textContent = item.meaning + (item.example ? "\n" + item.example : "");

    itemRow.appendChild(headerLine);
    itemRow.appendChild(detailLine);

    listEl.appendChild(itemRow);
  }

  var statusBar = document.getElementById("searchStatusBar");
  if (query === "" && !hasStatusFilter && !hasCatFilter) {
    statusBar.textContent = "全 " + allWordsList.length + " 語 を表示中";
  } else {
    var labels = [];
    if (hasStatusFilter) {
      if (selectedStatuses.indexOf("learned") !== -1) labels.push("覚えた単語");
      if (selectedStatuses.indexOf("unlearned") !== -1) labels.push("覚えていない単語");
    }
    if (hasCatFilter) labels.push(selectedCats.join("・"));

    var labelHeader = labels.length > 0 ? "【" + labels.join(" の中の ") + "】 " : "";
    var queryHeader = query !== "" ? "「" + query + "」: " : "";
    statusBar.textContent = labelHeader + queryHeader + matchCount + " 語";
  }
}

// まいにちシートの描画処理
function renderRoadmap() {
  if (!roadmapData) return;

  var todayKey = getTodayJSTStr();
  var totalLearned = getTotalLearnedCount();

  var dynamicLearnedMap = {};
  for (var dKey in initialLearnedDatesMap) {
    dynamicLearnedMap[dKey] = true;
  }

  if (totalLearned === 0) {
    delete dynamicLearnedMap[todayKey];
  }

  var streakCount = 0;
  var checkDate = new Date();
  var utc = checkDate.getTime() + (checkDate.getTimezoneOffset() * 60000);
  var jstDate = new Date(utc + (9 * 60 * 60000));

  if (!dynamicLearnedMap[todayKey]) {
    jstDate.setDate(jstDate.getDate() - 1);
  }

  if (totalLearned > 0) {
    while (true) {
      var k = formatDateStr(jstDate);
      if (dynamicLearnedMap[k]) {
        streakCount++;
        jstDate.setDate(jstDate.getDate() - 1);
      } else {
        break;
      }
    }
  }

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
