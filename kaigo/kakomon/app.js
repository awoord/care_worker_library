var MIN_VOCAB_RUBY_LENGTH = 2;
var vocabularyRubyEntries = null;
var allQuestions = [];
var questionsReady = false;
var pendingJump = false;
var lastView = { mode: null, query: "" };
var meta = {
  sessionMin: null,
  sessionMax: null,
  defaultFrom: null,
  defaultTo: null,
  count: 0
};

/* 試作: 答え合わせUIは 38-1（第38回・問題1）のみ */
function getAnswerCheck(q) {
  if (!q) {
    return null;
  }
  var answers = q.answers;
  if (!answers || !answers.length) {
    return null;
  }
  return {
    answers: answers,
    explains: q.explains || null
  };
}

function normalizeWordItem(item) {
  if (!item || item.word !== undefined) {
    return item;
  }
  return {
    word: item.w,
    ruby: item.r
  };
}

function getWordKey(item) {
  return ((item && (item.word || item.w)) || "").trim();
}

function getVocabularyRubyEntries(allWords) {
  if (vocabularyRubyEntries) {
    return vocabularyRubyEntries;
  }

  var byWord = {};
  for (var i = 0; i < allWords.length; i++) {
    var item = allWords[i];
    var word = getWordKey(item);
    var ruby = (item.ruby || item.r || "").trim();
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

  vocabularyRubyEntries = Object.keys(byWord)
    .map(function (word) {
      return { word: word, ruby: byWord[word] };
    })
    .sort(function (a, b) {
      return b.word.length - a.word.length;
    });

  return vocabularyRubyEntries;
}

/* 画面文言用の追加ルビ（語彙JSONに無い一般語）。カタカナ語には付けない。 */
var UI_RUBY_EXTRA = [
  { word: "介護福祉士", ruby: "かいごふくしし" },
  { word: "国家試験", ruby: "こっかしけん" },
  { word: "過去問", ruby: "かこもん" },
  { word: "問題不成立", ruby: "もんだいふせいりつ" },
  { word: "正答", ruby: "せいとう" },
  { word: "全問", ruby: "ぜんもん" },
  { word: "表示", ruby: "ひょうじ" },
  { word: "開始", ruby: "かいし" },
  { word: "終了", ruby: "しゅうりょう" },
  { word: "科目", ruby: "かもく" },
  { word: "検索", ruby: "けんさく" },
  { word: "場合", ruby: "ばあい" },
  { word: "同じ", ruby: "おなじ" },
  { word: "押す", ruby: "おす" },
  { word: "見る", ruby: "みる" }
];

function isKanaOnlyWord(word) {
  /* ひらがな・カタカナのみの語にはルビを付けない */
  return /^[\u3041-\u3096\u309D-\u309E\u30A1-\u30F6\u30F8-\u30FFァ-ヶー・･]+$/.test(
    word || ""
  );
}

function getEffectiveRubyEntries() {
  var base = vocabularyRubyEntries || [];
  if (!base.length) {
    return UI_RUBY_EXTRA.slice().sort(function (a, b) {
      return b.word.length - a.word.length;
    });
  }
  var seen = {};
  var merged = [];
  for (var i = 0; i < UI_RUBY_EXTRA.length; i++) {
    var u = UI_RUBY_EXTRA[i];
    if (!seen[u.word]) {
      seen[u.word] = true;
      merged.push(u);
    }
  }
  for (var j = 0; j < base.length; j++) {
    var b = base[j];
    if (!seen[b.word]) {
      seen[b.word] = true;
      merged.push(b);
    }
  }
  merged.sort(function (a, b) {
    return b.word.length - a.word.length;
  });
  return merged;
}

function findVocabularyRubyMatches(text, entries) {
  var matches = [];
  if (!text || !entries || !entries.length) {
    return matches;
  }
  var used = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var word = entry.word;
    if (!word || isKanaOnlyWord(word)) {
      continue;
    }
    var start = 0;
    while (start < text.length) {
      var idx = text.indexOf(word, start);
      if (idx === -1) {
        break;
      }
      var end = idx + word.length;
      var overlap = false;
      for (var u = 0; u < used.length; u++) {
        if (!(end <= used[u].start || idx >= used[u].end)) {
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        matches.push({ start: idx, end: end, word: word, ruby: entry.ruby });
        used.push({ start: idx, end: end });
      }
      start = idx + 1;
    }
  }
  matches.sort(function (a, b) {
    return a.start - b.start;
  });
  return matches;
}

function appendTextWithVocabularyRuby(container, text) {
  if (!text) {
    return;
  }

  var run = document.createElement("span");
  run.className = "vocab-ruby-run";

  var entries = getEffectiveRubyEntries();
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
    var pair = document.createElement("span");
    pair.className = "ruby-pair";
    var base = document.createElement("span");
    base.className = "ruby-base";
    base.textContent = m.word;
    var rt = document.createElement("span");
    rt.className = "ruby-text";
    rt.textContent = m.ruby;
    pair.appendChild(base);
    pair.appendChild(rt);
    fragment.appendChild(pair);
    cursor = m.end;
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }
  run.appendChild(fragment);
  container.appendChild(run);
}

function fillWithRuby(el, text) {
  el.textContent = "";
  appendHighlightedRuby(el, text, activeHighlightTerms);
}

/* キーワード検索のハイライト対象（空なら強調なし） */
var activeHighlightTerms = [];

function setActiveHighlightTerms(terms) {
  activeHighlightTerms = (terms || [])
    .map(function (t) {
      return String(t || "").trim();
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return b.length - a.length;
    });
}

function findNormalizedIndex(haystack, needle, from) {
  var normNeedle = normalizeForSearch(needle);
  if (!normNeedle) {
    return null;
  }
  var start = from || 0;
  for (var i = start; i < haystack.length; i++) {
    for (var j = i + 1; j <= haystack.length; j++) {
      var slice = haystack.slice(i, j);
      var normSlice = normalizeForSearch(slice);
      if (normSlice === normNeedle) {
        return { start: i, end: j };
      }
      if (normSlice.length > normNeedle.length) {
        break;
      }
    }
  }
  return null;
}

function findNextHighlightMatch(text, from, terms) {
  if (!terms || !terms.length) {
    return null;
  }
  var best = null;
  for (var t = 0; t < terms.length; t++) {
    var hit = findNormalizedIndex(text, terms[t], from);
    if (!hit) {
      continue;
    }
    if (
      !best ||
      hit.start < best.start ||
      (hit.start === best.start && hit.end - hit.start > best.end - best.start)
    ) {
      best = hit;
    }
  }
  return best;
}

function appendHighlightedRuby(container, text, terms) {
  if (!text) {
    return;
  }
  if (!terms || !terms.length) {
    appendTextWithVocabularyRuby(container, text);
    return;
  }
  var cursor = 0;
  while (cursor < text.length) {
    var hit = findNextHighlightMatch(text, cursor, terms);
    if (!hit) {
      appendTextWithVocabularyRuby(container, text.slice(cursor));
      break;
    }
    if (hit.start > cursor) {
      appendTextWithVocabularyRuby(container, text.slice(cursor, hit.start));
    }
    var mark = document.createElement("mark");
    mark.className = "search-hit";
    appendTextWithVocabularyRuby(mark, text.slice(hit.start, hit.end));
    container.appendChild(mark);
    cursor = hit.end;
  }
}

/* 国試どおり問題文の定型句を太字にする（長い語句から優先） */
var STEM_BOLD_PHRASES = [
  "最も適切なもの",
  "適切なもの",
  "正しいもの",
  "そのほか"
];

function findNextStemBoldMatch(text, from) {
  var best = null;
  for (var i = 0; i < STEM_BOLD_PHRASES.length; i++) {
    var phrase = STEM_BOLD_PHRASES[i];
    var idx = text.indexOf(phrase, from);
    if (idx === -1) {
      continue;
    }
    if (
      !best ||
      idx < best.start ||
      (idx === best.start && phrase.length > best.end - best.start)
    ) {
      best = { start: idx, end: idx + phrase.length, phrase: phrase };
    }
  }
  return best;
}

function fillStemWithRuby(el, text) {
  if (!text) {
    return;
  }
  var cursor = 0;
  while (cursor < text.length) {
    var match = findNextStemBoldMatch(text, cursor);
    if (!match) {
      appendHighlightedRuby(el, text.slice(cursor), activeHighlightTerms);
      break;
    }
    if (match.start > cursor) {
      appendHighlightedRuby(
        el,
        text.slice(cursor, match.start),
        activeHighlightTerms
      );
    }
    var strong = document.createElement("strong");
    strong.className = "stem-emphasis";
    appendHighlightedRuby(strong, match.phrase, activeHighlightTerms);
    el.appendChild(strong);
    cursor = match.end;
  }
}

function normalizeForSearch(text) {
  try {
    return String(text || "")
      .normalize("NFKC")
      .toLowerCase();
  } catch (err) {
    return String(text || "").toLowerCase();
  }
}

function parseTerms(raw) {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function questionSearchText(q) {
  var parts = [q.id || "", q.subject || ""];
  var body = q.body || [];
  for (var i = 0; i < body.length; i++) {
    parts.push(body[i]);
  }
  var choices = q.choices || [];
  for (var c = 0; c < choices.length; c++) {
    parts.push(choices[c].text || "");
  }
  return normalizeForSearch(parts.join("\n"));
}

function normalizeRange(sessionFrom, sessionTo) {
  var from = Number(sessionFrom);
  var to = Number(sessionTo);
  if (!(from <= to)) {
    var tmp = from;
    from = to;
    to = tmp;
  }
  return { from: from, to: to };
}

function findByRoundAndNumber(questions, round, number) {
  var r = Number(round);
  var n = Number(number);
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    if (Number(q.round) === r && Number(q.number) === n) {
      return q;
    }
  }
  return null;
}

function questionBodyText(q) {
  var body = q.body || [];
  var parts = [];
  for (var i = 0; i < body.length; i++) {
    parts.push(body[i] || "");
  }
  return parts.join("\n");
}

function questionType(q) {
  var text = questionBodyText(q);
  if (text.indexOf("最も適切なもの") !== -1) {
    return "最も適切なもの";
  }
  if (text.indexOf("適切なもの") !== -1) {
    return "適切なもの";
  }
  if (text.indexOf("正しいもの") !== -1) {
    return "正しいもの";
  }
  return "そのほか";
}

function searchQuestions(questions, terms, sessionFrom, sessionTo, subject, type) {
  var range = normalizeRange(sessionFrom, sessionTo);
  var from = range.from;
  var to = range.to;
  var subjectFilter = String(subject || "").trim();
  var typeFilter = String(type || "").trim();
  var norms = terms.map(normalizeForSearch).filter(Boolean);
  var hits = [];
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var round = Number(q.round);
    if (round < from || round > to) {
      continue;
    }
    if (subjectFilter && String(q.subject || "") !== subjectFilter) {
      continue;
    }
    if (typeFilter && questionType(q) !== typeFilter) {
      continue;
    }
    if (norms.length) {
      var hay = questionSearchText(q);
      var ok = true;
      for (var t = 0; t < norms.length; t++) {
        if (hay.indexOf(norms[t]) === -1) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        continue;
      }
    }
    hits.push(q);
  }
  return hits;
}

function countInRange(questions, sessionFrom, sessionTo, subject, type) {
  return searchQuestions(
    questions,
    [],
    sessionFrom,
    sessionTo,
    subject,
    type
  ).length;
}

function getSelectedRange() {
  var fromEl = document.getElementById("sessionFrom");
  var toEl = document.getElementById("sessionTo");
  var from = fromEl ? Number(fromEl.value) : meta.sessionMin;
  var to = toEl ? Number(toEl.value) : meta.sessionMax;
  if (from > to) {
    var swap = from;
    from = to;
    to = swap;
    if (fromEl) fromEl.value = String(from);
    if (toEl) toEl.value = String(to);
  }
  return { from: from, to: to };
}

function getSelectedSubject() {
  var el = document.getElementById("subjectSelect");
  return el ? String(el.value || "").trim() : "";
}

function getSelectedType() {
  var el = document.getElementById("typeSelect");
  return el ? String(el.value || "").trim() : "";
}

function getJumpInputs() {
  var roundEl = document.getElementById("jumpRound");
  var numEl = document.getElementById("jumpNumber");
  var roundRaw = roundEl ? String(roundEl.value || "").trim() : "";
  var numRaw = numEl ? String(numEl.value || "").trim() : "";
  var round = roundRaw === "" ? null : Number(roundRaw);
  var number = numRaw === "" ? null : Number(numRaw);
  if (round !== null && (isNaN(round) || round < 1)) {
    round = null;
  }
  if (number !== null && (isNaN(number) || number < 1)) {
    number = null;
  }
  return { round: round, number: number, partial: (round !== null) !== (number !== null) };
}

var SUBJECT_ORDER = [
  "人間の尊厳と自立",
  "介護の基本",
  "社会の理解",
  "人間関係とコミュニケーション",
  "コミュニケーション技術",
  "生活支援技術",
  "こころとからだのしくみ",
  "発達と老化の理解",
  "認知症の理解",
  "障害の理解",
  "医療的ケア",
  "介護過程",
  "総合問題"
];

function collectSubjects(questions) {
  var seen = {};
  for (var i = 0; i < questions.length; i++) {
    var s = String(questions[i].subject || "").trim();
    if (s) {
      seen[s] = true;
    }
  }
  var list = [];
  for (var o = 0; o < SUBJECT_ORDER.length; o++) {
    var name = SUBJECT_ORDER[o];
    if (seen[name]) {
      list.push(name);
      delete seen[name];
    }
  }
  var rest = Object.keys(seen).sort(function (a, b) {
    return a.localeCompare(b, "ja");
  });
  return list.concat(rest);
}

function fillSessionSelects() {
  var fromEl = document.getElementById("sessionFrom");
  var toEl = document.getElementById("sessionTo");
  if (!fromEl || !toEl) {
    return;
  }
  var prevFrom = fromEl.value;
  var prevTo = toEl.value;
  var fragFrom = document.createDocumentFragment();
  var fragTo = document.createDocumentFragment();
  for (var s = meta.sessionMin; s <= meta.sessionMax; s++) {
    var optFrom = document.createElement("option");
    optFrom.value = String(s);
    optFrom.textContent = sessionYearLabel(s);
    fragFrom.appendChild(optFrom);
    var optTo = document.createElement("option");
    optTo.value = String(s);
    optTo.textContent = sessionYearLabel(s);
    fragTo.appendChild(optTo);
  }
  fromEl.replaceChildren(fragFrom);
  toEl.replaceChildren(fragTo);
  if (prevFrom) fromEl.value = prevFrom;
  if (prevTo) toEl.value = prevTo;
  expandSessionYearOptions(fromEl);
  expandSessionYearOptions(toEl);
}

/* 第N回の実施年（例: 38 → 2026） */
function sessionYear(session) {
  return Number(session) + 1988;
}

function sessionYearLabel(session) {
  return String(session) + " （" + sessionYear(session) + "）";
}

function roundLabelWithYear(session) {
  return "第" + Number(session) + "回（" + sessionYear(session) + "）";
}

function expandSessionYearOptions(selectEl) {
  if (!selectEl) {
    return;
  }
  for (var i = 0; i < selectEl.options.length; i++) {
    var opt = selectEl.options[i];
    if (!opt.value) {
      continue;
    }
    opt.textContent = sessionYearLabel(opt.value);
  }
}

function wireSessionYearSelect(selectEl) {
  if (!selectEl || selectEl.dataset.yearWired === "1") {
    return;
  }
  selectEl.dataset.yearWired = "1";
  expandSessionYearOptions(selectEl);
}

function wireAllSessionYearSelects() {
  wireSessionYearSelect(document.getElementById("sessionFrom"));
  wireSessionYearSelect(document.getElementById("sessionTo"));
  wireSessionYearSelect(document.getElementById("jumpRound"));
}

function countSubjectsInRange(questions, sessionFrom, sessionTo, type) {
  var range = normalizeRange(sessionFrom, sessionTo);
  var typeFilter = String(type || "").trim();
  var counts = {};
  var total = 0;
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var round = Number(q.round);
    if (round < range.from || round > range.to) {
      continue;
    }
    if (typeFilter && questionType(q) !== typeFilter) {
      continue;
    }
    var s = String(q.subject || "").trim();
    if (!s) {
      continue;
    }
    counts[s] = (counts[s] || 0) + 1;
    total++;
  }
  return { counts: counts, total: total };
}

function updateSubjectOptionCounts() {
  var el = document.getElementById("subjectSelect");
  if (!el || !questionsReady) {
    return;
  }
  var range = getSelectedRange();
  var type = getSelectedType();
  var result = countSubjectsInRange(
    allQuestions,
    range.from,
    range.to,
    type
  );
  for (var i = 0; i < el.options.length; i++) {
    var opt = el.options[i];
    if (!opt.value) {
      opt.textContent = "すべての科目（" + result.total + "）";
      continue;
    }
    var n = result.counts[opt.value] || 0;
    opt.textContent = opt.value + "（" + n + "）";
  }
}

function fillSubjectSelect(subjects, selected) {
  var el = document.getElementById("subjectSelect");
  if (!el) {
    return;
  }
  // HTML に科目を埋め込済みなら再構築しない（表示ラグ防止）
  if (el.options.length > 1) {
    if (selected) {
      el.value = selected;
      if (el.value !== selected) {
        el.value = "";
      }
    }
    updateSubjectOptionCounts();
    return;
  }
  var frag = document.createDocumentFragment();
  var allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "すべての科目";
  frag.appendChild(allOpt);
  for (var i = 0; i < subjects.length; i++) {
    var opt = document.createElement("option");
    opt.value = subjects[i];
    opt.textContent = subjects[i];
    frag.appendChild(opt);
  }
  el.replaceChildren(frag);
  if (selected && subjects.indexOf(selected) !== -1) {
    el.value = selected;
  } else {
    el.value = "";
  }
  updateSubjectOptionCounts();
}

function setStatus(text, mode) {
  var el = document.getElementById("searchStatus");
  if (!el) {
    return;
  }
  el.textContent = "";
  if (!text) {
    return;
  }
  fillWithRuby(el, text);
}

function showHint(message) {
  var root = document.getElementById("questionList");
  root.textContent = "";
  var p = document.createElement("p");
  p.className = "hint";
  fillWithRuby(p, message);
  root.appendChild(p);
}

function showError(message) {
  var root = document.getElementById("questionList");
  root.textContent = "";
  var p = document.createElement("p");
  p.className = "error";
  fillWithRuby(p, message);
  root.appendChild(p);
}

function isCorrectChoice(trial, choiceN) {
  var answers = trial.answers || [];
  for (var i = 0; i < answers.length; i++) {
    if (Number(answers[i]) === Number(choiceN)) {
      return true;
    }
  }
  return false;
}

function getChoiceExplain(trial, choiceN) {
  var map = trial.explains || {};
  return map[choiceN] || map[String(choiceN)] || "";
}

function setChoiceOpen(li, trial, open) {
  var n = Number(li.getAttribute("data-choice-n"));
  var ok = isCorrectChoice(trial, n);
  var mark = li.querySelector(".choice-mark");
  var explain = li.querySelector(".choice-explain");

  li.classList.toggle("is-open", open);
  li.classList.toggle("is-correct", open && ok);
  li.classList.toggle("is-wrong", open && !ok);
  li.setAttribute("aria-expanded", open ? "true" : "false");

  if (mark) {
    mark.hidden = !open;
    if (open) {
      mark.textContent = ok ? "◯" : "✕";
      mark.className = "choice-mark " + (ok ? "is-ok" : "is-ng");
    }
  }
  if (explain) {
    explain.hidden = !open;
  }
}

function syncRevealAllButton(card) {
  var btn = card.querySelector(".quiz-reveal-all");
  if (!btn) {
    return;
  }
  var items = card.querySelectorAll(".choice");
  var openCount = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].classList.contains("is-open")) {
      openCount++;
    }
  }
  var allOpen = items.length > 0 && openCount === items.length;
  btn.setAttribute("aria-pressed", allOpen ? "true" : "false");
  btn.dataset.allOpen = allOpen ? "1" : "0";
  btn.setAttribute("aria-label", allOpen ? "全て閉じる" : "全て表示");
}

function toggleChoice(li, trial, card) {
  var open = !li.classList.contains("is-open");
  setChoiceOpen(li, trial, open);
  syncRevealAllButton(card);
}

function setAllChoices(card, trial, open) {
  var items = card.querySelectorAll(".choice");
  for (var i = 0; i < items.length; i++) {
    setChoiceOpen(items[i], trial, open);
  }
  syncRevealAllButton(card);
}

function wireAnswerCheck(card, q, trial) {
  card.classList.add("is-quiz-trial");

  var metaRow = card.querySelector(".meta-row");
  if (metaRow) {
    var revealAll = document.createElement("button");
    revealAll.type = "button";
    revealAll.className = "quiz-reveal-all";
    revealAll.setAttribute("aria-pressed", "false");
    revealAll.setAttribute("aria-label", "全て表示");
    var labelOpen = document.createElement("span");
    labelOpen.className = "label-open";
    labelOpen.textContent = "＋";
    var labelClose = document.createElement("span");
    labelClose.className = "label-close";
    labelClose.textContent = "−";
    labelClose.setAttribute("aria-hidden", "true");
    revealAll.appendChild(labelOpen);
    revealAll.appendChild(labelClose);
    revealAll.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var allOpen = revealAll.dataset.allOpen === "1";
      setAllChoices(card, trial, !allOpen);
    });
    metaRow.appendChild(revealAll);
  }

  var choices = card.querySelectorAll(".choice");
  for (var c = 0; c < choices.length; c++) {
    (function (li) {
      var n = Number(li.getAttribute("data-choice-n"));
      var explainText = getChoiceExplain(trial, n);
      if (explainText) {
        var explain = document.createElement("div");
        explain.className = "choice-explain";
        explain.hidden = true;
        fillWithRuby(explain, explainText);
        li.appendChild(explain);
      }

      var mark = document.createElement("span");
      mark.className = "choice-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.hidden = true;
      var body = li.querySelector(".choice-body") || li;
      body.appendChild(mark);

      li.classList.add("is-tappable");
      li.setAttribute("role", "button");
      li.setAttribute("aria-expanded", "false");
      li.tabIndex = 0;

      function onPick(ev) {
        if (ev.target && ev.target.closest && ev.target.closest(".quiz-reveal-all")) {
          return;
        }
        toggleChoice(li, trial, card);
      }
      li.addEventListener("click", onPick);
      li.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onPick(ev);
        }
      });
    })(choices[c]);
  }

  syncRevealAllButton(card);
}

function renderQuestions(questions) {
  var root = document.getElementById("questionList");
  root.textContent = "";

  if (!questions.length) {
    var empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "該当する問題がありません。条件を変えて試してください。";
    root.appendChild(empty);
    return;
  }

  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var card = document.createElement("article");
    card.className = "question-card";
    card.id = "q-" + q.id;

    var metaRow = document.createElement("div");
    metaRow.className = "meta-row";

    var idBadge = document.createElement("span");
    idBadge.className = "badge badge-id";
    idBadge.textContent = q.round + "-" + q.number;
    metaRow.appendChild(idBadge);

    if (q.subject) {
      var subBadge = document.createElement("span");
      subBadge.className = "badge badge-subject";
      subBadge.textContent = q.subject;
      metaRow.appendChild(subBadge);
    }
    card.appendChild(metaRow);

    var stem = document.createElement("div");
    stem.className = "stem";
    var bodyLines = q.body || [];
    for (var b = 0; b < bodyLines.length; b++) {
      var line = bodyLines[b];
      if (!line || !String(line).trim()) {
        continue;
      }
      var p = document.createElement("p");
      fillStemWithRuby(p, line);
      stem.appendChild(p);
    }
    card.appendChild(stem);

    if (q.note) {
      var note = document.createElement("p");
      note.className = "question-note";
      fillWithRuby(note, q.note);
      card.appendChild(note);
    }

    var ul = document.createElement("ol");
    ul.className = "choices";
    ul.start = 1;
    var choices = q.choices || [];
    for (var c = 0; c < choices.length; c++) {
      var choice = choices[c];
      var li = document.createElement("li");
      li.className = "choice";
      li.setAttribute("data-choice-n", String(choice.n));

      var body = document.createElement("div");
      body.className = "choice-body";

      var nWrap = document.createElement("span");
      nWrap.className = "choice-n-wrap";
      var n = document.createElement("span");
      n.className = "choice-n";
      n.textContent = String(choice.n);
      nWrap.appendChild(n);
      body.appendChild(nWrap);

      var text = document.createElement("span");
      text.className = "choice-text";
      fillWithRuby(text, choice.text || "");
      body.appendChild(text);

      li.appendChild(body);

      ul.appendChild(li);
    }
    card.appendChild(ul);

    var trial = getAnswerCheck(q);
    if (trial) {
      wireAnswerCheck(card, q, trial);
    }

    root.appendChild(card);
  }
}

function describeFilters(range, subject, type, terms) {
  var parts = [];
  if (range.from === range.to) {
    parts.push(roundLabelWithYear(range.from));
  } else {
    parts.push(
      "第" +
        range.from +
        "〜" +
        range.to +
        "回（" +
        sessionYear(range.from) +
        "〜" +
        sessionYear(range.to) +
        "）"
    );
  }
  if (subject) {
    parts.push("科目「" + subject + "」");
  }
  if (type) {
    parts.push("タイプ「" + type + "」");
  }
  if (terms.length) {
    parts.push("「" + terms.join(" ") + "」");
  }
  return parts.join(" ");
}

function runFilterSearch(rawQuery) {
  if (!questionsReady) {
    lastView = { mode: "filter", query: rawQuery || "" };
    setStatus("問題データを読み込み中…", "filter");
    return;
  }
  lastView = { mode: "filter", query: rawQuery || "" };
  var range = getSelectedRange();
  var subject = getSelectedSubject();
  var type = getSelectedType();
  var terms = parseTerms(rawQuery);
  setActiveHighlightTerms(terms);
  var inRange = countInRange(
    allQuestions,
    range.from,
    range.to,
    subject,
    type
  );
  var browseAll = !terms.length && !subject && !type;

  if (browseAll && range.from !== range.to) {
    setStatus("全問表示は開始回と終了回を同じにしてください。", "filter");
    showHint(
      "科目・すべてのタイプ・キーワードなしで全問を見る場合は、開始回と終了回を同じにして「検索」を押してください。"
    );
    return;
  }

  if (browseAll) {
    var hitsAll = searchQuestions(
      allQuestions,
      [],
      range.from,
      range.to,
      "",
      ""
    );
    setStatus(
      roundLabelWithYear(range.from) + "の全問 → " + hitsAll.length + " 問",
      "filter"
    );
    renderQuestions(hitsAll);
    return;
  }

  var hits = searchQuestions(
    allQuestions,
    terms,
    range.from,
    range.to,
    subject,
    type
  );
  setStatus(
    describeFilters(range, subject, type, terms) + " → " + hits.length + " 問",
    "filter"
  );
  renderQuestions(hits);
}

function runJumpSearch() {
  var jump = getJumpInputs();
  if (jump.round === null || jump.number === null) {
    setStatus("回と問題番号の両方を入力してください。", "jump");
    showHint("例: 第37回の問10 → 回に「37」、番号に「10」を入れて「この問題を表示」。");
    return;
  }

  if (!questionsReady) {
    pendingJump = true;
    lastView = { mode: "jump", query: "" };
    setStatus("問題データを読み込み中…", "jump");
    showHint("少々お待ちください。読み込みが終わると表示します。");
    return;
  }

  pendingJump = false;
  lastView = { mode: "jump", query: "" };
  setActiveHighlightTerms([]);
  var hit = findByRoundAndNumber(allQuestions, jump.round, jump.number);
  if (hit) {
    setStatus(
      roundLabelWithYear(jump.round) + " 問題" + jump.number + " を表示中",
      "jump"
    );
    renderQuestions([hit]);
  } else {
    setStatus(
      roundLabelWithYear(jump.round) +
        " 問題" +
        jump.number +
        " はデータにありません",
      "jump"
    );
    showHint("指定した回・問題番号の問題が見つかりませんでした。");
  }
}

function refreshCurrentView() {
  if (lastView.mode === "jump") {
    runJumpSearch();
  } else if (lastView.mode === "filter") {
    runFilterSearch(lastView.query);
  }
}

function applyVocabularyWords(words) {
  vocabularyRubyEntries = null;
  getVocabularyRubyEntries(words || []);
  refreshCurrentView();
}

function readStateFromUrl() {
  var state = {
    q: "",
    from: meta.defaultFrom,
    to: meta.defaultTo,
    subject: "",
    type: "",
    round: "",
    num: ""
  };
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.has("q")) {
      state.q = params.get("q") || "";
    }
    if (params.has("from")) {
      var from = Number(params.get("from"));
      if (!isNaN(from)) state.from = from;
    }
    if (params.has("to")) {
      var to = Number(params.get("to"));
      if (!isNaN(to)) state.to = to;
    }
    if (params.has("subject")) {
      state.subject = params.get("subject") || "";
    }
    if (params.has("type")) {
      state.type = params.get("type") || "";
    }
    if (params.has("round")) {
      state.round = params.get("round") || "";
    }
    if (params.has("num")) {
      state.num = params.get("num") || "";
    }
  } catch (err) {
    // ignore
  }
  state.from = Math.min(Math.max(state.from, meta.sessionMin), meta.sessionMax);
  state.to = Math.min(Math.max(state.to, meta.sessionMin), meta.sessionMax);
  if (state.from > state.to) {
    var swap = state.from;
    state.from = state.to;
    state.to = swap;
  }
  return state;
}

function writeFilterStateToUrl(rawQuery, sessionFrom, sessionTo, subject, type) {
  try {
    var url = new URL(window.location.href);
    var trimmed = String(rawQuery || "").trim();
    if (trimmed) {
      url.searchParams.set("q", trimmed);
    } else {
      url.searchParams.delete("q");
    }
    if (
      Number(sessionFrom) === Number(meta.defaultFrom) &&
      Number(sessionTo) === Number(meta.defaultTo)
    ) {
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    } else {
      url.searchParams.set("from", String(sessionFrom));
      url.searchParams.set("to", String(sessionTo));
    }
    if (subject) {
      url.searchParams.set("subject", subject);
    } else {
      url.searchParams.delete("subject");
    }
    if (type) {
      url.searchParams.set("type", type);
    } else {
      url.searchParams.delete("type");
    }
    url.searchParams.delete("round");
    url.searchParams.delete("num");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch (err) {
    // ignore
  }
}

function writeJumpStateToUrl(jump) {
  try {
    var url = new URL(window.location.href);
    if (jump && jump.round !== null && jump.number !== null) {
      url.searchParams.set("round", String(jump.round));
      url.searchParams.set("num", String(jump.number));
    } else {
      url.searchParams.delete("round");
      url.searchParams.delete("num");
    }
    url.searchParams.delete("q");
    url.searchParams.delete("subject");
    url.searchParams.delete("type");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch (err) {
    // ignore
  }
}

function fillJumpNumberSelect() {
  var numEl = document.getElementById("jumpNumber");
  if (!numEl) {
    return;
  }
  // すでに 1〜125 が入っていれば触らない（再描画によるちらつき防止）
  if (numEl.options.length > 1) {
    return;
  }
  var frag = document.createDocumentFragment();
  for (var n = 1; n <= 125; n++) {
    var opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = String(n);
    if (n === 1) {
      opt.selected = true;
    }
    frag.appendChild(opt);
  }
  numEl.replaceChildren(frag);
}

function showIdleState() {
  var from = meta.defaultFrom != null ? meta.defaultFrom : 38;
  setStatus("条件を選んで「検索」を押してください。");
  showHint(
    "初期表示は" + roundLabelWithYear(from) + "です。「検索」で問題を表示します。"
  );
}

function applyTitleRuby() {
  var h1 = document.querySelector(".page-header h1");
  if (!h1) {
    return;
  }
  fillWithRuby(h1, "介護福祉士国家試験 過去問検索");
}

function wireBackToTop() {
  var btn = document.getElementById("backToTop");
  if (!btn) {
    return;
  }
  var threshold = 320;
  var ticking = false;

  function update() {
    ticking = false;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    if (y > threshold) {
      btn.hidden = false;
      btn.classList.add("is-visible");
    } else {
      btn.classList.remove("is-visible");
      window.setTimeout(function () {
        if (!btn.classList.contains("is-visible")) {
          btn.hidden = true;
        }
      }, 200);
    }
  }

  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    },
    { passive: true }
  );

  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  update();
}

function boot() {
  var filterForm = document.getElementById("filterForm");
  var jumpForm = document.getElementById("jumpForm");
  var input = document.getElementById("searchInput");
  var fromEl = document.getElementById("sessionFrom");
  var toEl = document.getElementById("sessionTo");
  var subjectEl = document.getElementById("subjectSelect");
  var typeEl = document.getElementById("typeSelect");
  var jumpRoundEl = document.getElementById("jumpRound");
  var jumpNumberEl = document.getElementById("jumpNumber");

  // 問番号は HTML に 1〜125 を埋め済み。不足時のみ補完
  fillJumpNumberSelect();
  wireAllSessionYearSelects();
  applyTitleRuby();
  wireBackToTop();
  setStatus("問題データを読み込み中…");
  showHint("少々お待ちください。");

  function refreshSubjectCounts() {
    updateSubjectOptionCounts();
  }
  if (fromEl) {
    fromEl.addEventListener("change", refreshSubjectCounts);
  }
  if (toEl) {
    toEl.addEventListener("change", refreshSubjectCounts);
  }
  if (typeEl) {
    typeEl.addEventListener("change", refreshSubjectCounts);
  }

  function submitFilter() {
    var range = getSelectedRange();
    var q = input.value;
    var subject = getSelectedSubject();
    var type = getSelectedType();
    if (jumpRoundEl) {
      jumpRoundEl.value = "";
    }
    if (jumpNumberEl) {
      jumpNumberEl.value = "";
    }
    writeFilterStateToUrl(q, range.from, range.to, subject, type);
    runFilterSearch(q);
  }

  function submitJump() {
    var jump = getJumpInputs();
    writeJumpStateToUrl(jump);
    runJumpSearch();
  }

  filterForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    submitFilter();
  });
  jumpForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    submitJump();
  });

  function onQuestionsLoaded(data) {
    allQuestions = (data && data.questions) || [];
    meta.sessionMin = Number(data.sessionMin);
    meta.sessionMax = Number(data.sessionMax);
    meta.defaultFrom = Number(
      data.defaultFrom != null ? data.defaultFrom : data.sessionMin
    );
    meta.defaultTo = Number(
      data.defaultTo != null ? data.defaultTo : data.sessionMax
    );
    meta.count = data.count || allQuestions.length;
    questionsReady = true;

    fillSessionSelects();
    var state = readStateFromUrl();
    fillSubjectSelect(collectSubjects(allQuestions), state.subject);
    fromEl.value = String(state.from);
    toEl.value = String(state.to);
    input.value = state.q;
    if (typeEl) {
      typeEl.value = state.type || "";
    }
    // 試作中は暫定で第38回・問題1を初期選択
    if (jumpRoundEl) {
      jumpRoundEl.value = state.round || "38";
    }
    if (jumpNumberEl) {
      jumpNumberEl.value = state.num || "1";
    }

    if (pendingJump || (state.round && state.num)) {
      runJumpSearch();
    } else {
      showIdleState();
    }
  }

  // 問題JSONとルビ辞書を同時に読む（同一サーバ・即時表示）
  var bust = "_t=" + Date.now();
  Promise.all([
    fetch("questions.json?" + bust).then(function (res) {
      if (!res.ok) {
        throw new Error("questions.json の読み込みに失敗しました");
      }
      return res.json();
    }),
    fetch("ruby.json?" + bust)
      .then(function (res) {
        if (!res.ok) {
          return [];
        }
        return res.json();
      })
      .catch(function () {
        return [];
      })
  ])
    .then(function (results) {
      var data = results[0];
      var rubyWords = results[1] || [];
      if (Array.isArray(rubyWords) && rubyWords.length) {
        applyVocabularyWords(rubyWords.map(normalizeWordItem));
      }
      applyTitleRuby();
      onQuestionsLoaded(data);
    })
    .catch(function (err) {
      showError(err && err.message ? err.message : "読み込みに失敗しました");
    });
}

boot();
