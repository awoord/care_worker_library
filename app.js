var GAS_BASE_URL = "https://script.google.com/macros/s/AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec";

// キャッシュ防止用のURL生成関数
function getApiUrl() {
        return GAS_BASE_URL + "?env=test&_t=" + Date.now();
}

var currentMode = localStorage.getItem("saved_main_mode") || "learn";
var currentLearnCat = localStorage.getItem("saved_learn_cat") || "基本";
var isDetailsHidden = localStorage.getItem("saved_details_hidden") === "true";

var allWordsList = [];
var roadmapData = {};
var initialLearnedDatesMap = {};
var isSyncing = false;

// ブラウザ操作した単語の操作保護記録
var locallyModifiedWords = JSON.parse(localStorage.getItem("saved_local_modified_words") || "{}");

// 連続タップ時の送信待ち管理
var pendingWordUpdates = {};
var syncDebounceTimer = null;

var categoryPage = {
        基本: 0,
        介護: 0,
        医療: 0,
        社会: 0,
};

var SMALL_GOALS = {
        基本: [200, 250, 300, 400, 500, 600, 700, 750, 800],
        介護: [70, 100, 150, 200, 250, 300],
        医療: [80, 100, 130, 170, 210, 250],
        社会: [50, 75, 100, 125, 150],
};

var selectedStatuses = [];
var selectedCats = [];

var themeColors = {
        基本: "#2563EB",
        介護: "#16A34A",
        医療: "#DC2626",
        社会: "#9333EA",
};

function getTodayJSTStr() {
        var now = new Date();
        var utc = now.getTime() + now.getTimezoneOffset() * 60000;
        var jst = new Date(utc + 9 * 60 * 60000);
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

function getCategoryWords(catName) {
        var list = allWordsList.filter(function (w) {
                return w.category === catName;
        });
        list.sort(function (a, b) {
                return (a.originalIndex || 0) - (b.originalIndex || 0);
        });
        return list;
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

// 確定したチェック状態のみを安全に送信
function queueWordUpdate(word, isLearned, category) {
        pendingWordUpdates[word] = { isLearned: isLearned, category: category };
        if (syncDebounceTimer) {
                clearTimeout(syncDebounceTimer);
        }
        syncDebounceTimer = setTimeout(flushWordUpdates, 300);
}

function flushWordUpdates() {
        var wordsToUpdate = Object.keys(pendingWordUpdates);
        if (wordsToUpdate.length === 0) return;

        var checkedWords = [];
        var uncheckedWords = [];
        var category = currentLearnCat;

        wordsToUpdate.forEach(function (w) {
                var info = pendingWordUpdates[w];
                category = info.category;
                if (info.isLearned) {
                        checkedWords.push(w);
                } else {
                        uncheckedWords.push(w);
                }
        });

        pendingWordUpdates = {};

        fetch(getApiUrl(), {
                method: "POST",
                body: JSON.stringify({
                        category: category,
                        checkedWords: checkedWords,
                        uncheckedWords: uncheckedWords,
                        currentWords: [],
                }),
        }).catch(function (err) {
                console.error("DB送信エラー:", err);
        });
}

window.onload = function () {
        updateCategoryTabsUI();
        applyMaskStateUI();
        showLoading(true);

        var savedPages = JSON.parse(localStorage.getItem("saved_category_page") || "null");
        if (savedPages) {
                categoryPage = savedPages;
        }

        fetch(getApiUrl())
                .then(function (res) {
                        return res.json();
                })
                .then(function (res) {
                        showLoading(false);
                        if (res.error) {
                                document.getElementById("learnHeaderText").textContent = "⚠️ " + res.error;
                                return;
                        }

                        var rawWords = res.allWords || [];
                        rawWords.forEach(function (w, idx) {
                                w.originalIndex = idx;
                                // ローカルで変更保護されている単語があればそれを適用
                                if (locallyModifiedWords.hasOwnProperty(w.word)) {
                                        w.isLearned = locallyModifiedWords[w.word];
                                }
                        });
                        allWordsList = rawWords;
                        roadmapData = res.roadmap || {};

                        initialLearnedDatesMap = {};
                        (roadmapData.learnedDates || []).forEach(function (d) {
                                initialLearnedDatesMap[d] = true;
                        });

                        renderCurrentLearnCat();
                        onSearchFilterChanged();
                        renderRoadmap();
                        switchMainMode(currentMode);

                        startAutoSync();
                })
                .catch(function (err) {
                        showLoading(false);
                        document.getElementById("learnHeaderText").textContent = "⚠️ 通信エラー: 再読み込みしてください";
                });
};

function syncWithDB() {
        if (isSyncing) return;
        isSyncing = true;

        fetch(getApiUrl())
                .then(function (res) {
                        return res.json();
                })
                .then(function (res) {
                        isSyncing = false;
                        if (!res || res.error || !res.allWords) return;

                        var remoteWords = res.allWords || [];
                        var changed = false;

                        var remoteMap = {};
                        remoteWords.forEach(function (rw) {
                                remoteMap[rw.word] = !!rw.isLearned;
                        });

                        allWordsList.forEach(function (w) {
                                if (remoteMap.hasOwnProperty(w.word)) {
                                        // ブラウザで直接操作された単語は、サーバーの古いデータで上書きしない
                                        if (locallyModifiedWords.hasOwnProperty(w.word)) {
                                                return;
                                        }

                                        var remoteStatus = remoteMap[w.word];
                                        if (w.isLearned !== remoteStatus) {
                                                w.isLearned = remoteStatus;
                                                changed = true;
                                        }
                                }
                        });

                        if (res.roadmap && res.roadmap.learnedDates) {
                                initialLearnedDatesMap = {};
                                (res.roadmap.learnedDates || []).forEach(function (d) {
                                        initialLearnedDatesMap[d] = true;
                                });
                                roadmapData = res.roadmap;
                        }

                        if (changed) {
                                updateCardCheckmarksUI();
                                updateLiveHeader();
                                renderRoadmap();
                                if (currentMode === "search") {
                                        onSearchFilterChanged();
                                }
                        }
                })
                .catch(function (err) {
                        isSyncing = false;
                });
}

function updateCardCheckmarksUI() {
        var words = getCurrentWords(currentLearnCat);
        words.forEach(function (item, idx) {
                var card = document.getElementById("card-" + idx);
                if (card) {
                        card.classList.toggle("checked", !!item.isLearned);
                }
        });
}

function startAutoSync() {
        setInterval(syncWithDB, 6000);

        document.addEventListener("visibilitychange", function () {
                if (!document.hidden) {
                        syncWithDB();
                }
        });
        window.addEventListener("focus", function () {
                syncWithDB();
        });
}

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

function switchMainMode(mode) {
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

function switchLearnCat(catName) {
        currentLearnCat = catName;
        localStorage.setItem("saved_learn_cat", catName);
        updateCategoryTabsUI();
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
        prevBtn.disabled = (categoryPage[currentLearnCat] || 0) === 0;

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

                if (item.isLearned) {
                        card.classList.add("checked");
                }

                // タップ時の切り替え
                card.onclick = function (e) {
                        var newChecked = !item.isLearned;
                        item.isLearned = newChecked;
                        item.uiChecked = newChecked;
                        card.classList.toggle("checked", newChecked);

                        // ブラウザ側の操作状態をローカルに完全保護
                        locallyModifiedWords[item.word] = newChecked;
                        localStorage.setItem("saved_local_modified_words", JSON.stringify(locallyModifiedWords));

                        var targetWord = allWordsList.find(function (w) {
                                return w.word === item.word;
                        });
                        if (targetWord) {
                                targetWord.isLearned = newChecked;
                        }

                        var today = getTodayJSTStr();
                        var todayActivity = JSON.parse(localStorage.getItem("saved_today_activity") || "{}");
                        todayActivity[today] = todayActivity[today] || {};
                        if (newChecked) {
                                todayActivity[today][item.word] = true;
                        } else {
                                delete todayActivity[today][item.word];
                        }
                        localStorage.setItem("saved_today_activity", JSON.stringify(todayActivity));

                        updateLiveHeader();
                        renderRoadmap();
                        if (currentMode === "search") {
                                onSearchFilterChanged();
                        }

                        queueWordUpdate(item.word, newChecked, currentLearnCat);
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

        var headerText = document.getElementById("learnHeaderText");

        if (totalInCat === 0) {
                headerText.textContent = currentLearnCat + "： 登録単語 0 語";
                return;
        }

        if (catLearned >= totalInCat && totalInCat > 0) {
                headerText.textContent = currentLearnCat + "： 全 " + totalInCat + " 語 復習中 🔄";
                return;
        }

        var currentGoal = getNextSmallGoal(currentLearnCat, catLearned, totalInCat);
        var remaining = Math.max(0, currentGoal - catLearned);

        var baseText = currentLearnCat + "： " + catLearned + " / " + currentGoal + " 語 （あと " + remaining + " 語）";

        var currentCatWords = getCurrentWords(currentLearnCat);
        var allCurrentChecked =
                currentCatWords.length > 0 &&
                currentCatWords.every(function (w) {
                        return w.isLearned;
                });

        if (allCurrentChecked) {
                headerText.textContent = baseText + "  👍";
        } else {
                headerText.textContent = baseText;
        }
}

function submitProgress() {
        var list = getCategoryWords(currentLearnCat);
        if (list.length === 0) return;

        var currentWords = getCurrentWords(currentLearnCat);
        var checkedWords = [];
        var uncheckedWords = [];

        currentWords.forEach(function (w) {
                locallyModifiedWords[w.word] = !!w.isLearned;
                if (w.isLearned) {
                        checkedWords.push(w.word);
                } else {
                        uncheckedWords.push(w.word);
                }
        });
        localStorage.setItem("saved_local_modified_words", JSON.stringify(locallyModifiedWords));

        var nextPage = (categoryPage[currentLearnCat] || 0) + 5;
        if (nextPage >= list.length) {
                nextPage = 0;
        }
        categoryPage[currentLearnCat] = nextPage;
        localStorage.setItem("saved_category_page", JSON.stringify(categoryPage));

        renderCurrentLearnCat();
        renderRoadmap();

        fetch(getApiUrl(), {
                method: "POST",
                body: JSON.stringify({
                        category: currentLearnCat,
                        checkedWords: checkedWords,
                        uncheckedWords: uncheckedWords,
                        currentWords: currentWords.map(function (w) {
                                return w.word;
                        }),
                }),
        }).catch(function (err) {
                console.error("DB送信エラー:", err);
        });
}

function goBackLearnWords() {
        var list = getCategoryWords(currentLearnCat);
        if (list.length === 0) return;

        var currentPage = categoryPage[currentLearnCat] || 0;
        if (currentPage <= 0) return;

        var prevPage = Math.max(0, currentPage - 5);
        categoryPage[currentLearnCat] = prevPage;
        localStorage.setItem("saved_category_page", JSON.stringify(categoryPage));

        renderCurrentLearnCat();
        renderRoadmap();
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
        var hasCatFilter = selectedCats.length > 0;
        var hasStatusFilter = selectedStatuses.length > 0;

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

                        var isPrefixMatch = w.indexOf(query) === 0 || r.indexOf(query) === 0 || e.indexOf(query) === 0;
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

function renderRoadmap() {
        if (!roadmapData) return;

        var todayKey = getTodayJSTStr();
        var totalLearned = getTotalLearnedCount();

        var todayActivity = JSON.parse(localStorage.getItem("saved_today_activity") || "{}");
        var todayCheckedWords = todayActivity[todayKey] || {};
        var isAchievedToday = Object.keys(todayCheckedWords).length > 0 || (initialLearnedDatesMap[todayKey] && totalLearned > 0);

        var dynamicLearnedMap = {};
        for (var dKey in initialLearnedDatesMap) {
                dynamicLearnedMap[dKey] = true;
        }
        if (isAchievedToday) {
                dynamicLearnedMap[todayKey] = true;
        } else {
                delete dynamicLearnedMap[todayKey];
        }

        var streakCount = 0;
        var checkDate = new Date();
        var utc = checkDate.getTime() + checkDate.getTimezoneOffset() * 60000;
        var jstDate = new Date(utc + 9 * 60 * 60000);

        if (!dynamicLearnedMap[todayKey]) {
                jstDate.setDate(jstDate.getDate() - 1);
        }

        while (true) {
                var k = formatDateStr(jstDate);
                if (dynamicLearnedMap[k]) {
                        streakCount++;
                        jstDate.setDate(jstDate.getDate() - 1);
                } else {
                        break;
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
                var thisMon = new Date(baseMonday.getFullYear(), baseMonday.getMonth(), baseMonday.getDate() + w * 7);
                var thisMonKey = formatDateStr(thisMon);
                var isCurrentWeek = thisMonKey === nowMondayKey;

                var tr = document.createElement("tr");
                if (isCurrentWeek) {
                        tr.className = "current-week";
                }

                var startStr = thisMon.getMonth() + 1 + "/" + thisMon.getDate() + "〜";
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
