/* themes: kakomon 表示ロジック流用 + テーマ一覧/詳細 boot */
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
  { word: "正解", ruby: "せいかい" },
  { word: "全問", ruby: "ぜんもん" },
  { word: "表示", ruby: "ひょうじ" },
  { word: "開始", ruby: "かいし" },
  { word: "終了", ruby: "しゅうりょう" },
  { word: "科目", ruby: "かもく" },
  { word: "検索", ruby: "けんさく" },
  { word: "場合", ruby: "ばあい" },
  { word: "同じ", ruby: "おなじ" },
  { word: "押す", ruby: "おす" },
  { word: "見る", ruby: "みる" },
  { word: "本位", ruby: "ほんい" },
  { word: "人体", ruby: "じんたい" },
  { word: "攻略", ruby: "こうりゃく" },
  { word: "付録", ruby: "ふろく" },
  { word: "重要", ruby: "じゅうよう" },
  { word: "学習中", ruby: "がくしゅうちゅう" },
  { word: "学習", ruby: "がくしゅう" },
  /* 過去問バンクの塊ラベル */
  { word: "必須", ruby: "ひっす" },
  { word: "介護", ruby: "かいご" },
  { word: "医療", ruby: "いりょう" },
  { word: "社会", ruby: "しゃかい" },
  /* 「等」(とう)。長い「等しい」「等しく」を先に取り、「とうしい」にしない */
  { word: "等しい", ruby: "ひとしい" },
  { word: "等しく", ruby: "ひとしく" },
  { word: "等", ruby: "とう" },
  { word: "的", ruby: "てき" }
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

function createRubyPairElement(word, reading) {
  var pair = document.createElement("span");
  pair.className = "ruby-pair";
  if (reading) {
    var rt = document.createElement("span");
    rt.className = "ruby-text";
    rt.textContent = reading;
    pair.appendChild(rt);
  }
  var base = document.createElement("span");
  base.className = "ruby-base";
  base.textContent = word;
  pair.appendChild(base);
  return pair;
}

/* 長い語を短い nowrap 単位に分割し、単位の間だけで折り返す（ルビ重なり・横はみ出し防止） */
var RUBY_CHUNK_MAX_BASE_CHARS = 2;

function isRubyKanaChar(ch) {
  return /^[\u3041-\u3096\u309D-\u309E\u30A1-\u30F6\u30FD-\u30FFァ-ヶー・･]$/.test(
    ch || ""
  );
}

/* 漢字だけを長さで分割（かな対応が使えないときのフォールバック） */
function splitRubyChunksByLength(word, reading) {
  var bases = Array.from(word || "");
  var reads = Array.from(reading || "");
  if (!bases.length) {
    return [];
  }
  if (bases.length <= RUBY_CHUNK_MAX_BASE_CHARS) {
    return [{ word: word, ruby: reading || "" }];
  }

  var chunks = [];
  var readStart = 0;
  var totalBase = bases.length;
  var totalRead = reads.length;

  for (var i = 0; i < totalBase; i += RUBY_CHUNK_MAX_BASE_CHARS) {
    var end = Math.min(i + RUBY_CHUNK_MAX_BASE_CHARS, totalBase);
    /* 末尾1字だけ残るときは前チャンクに吸収（例: 7字 → 2+2+3） */
    if (totalBase - end === 1 && end - i === RUBY_CHUNK_MAX_BASE_CHARS) {
      end = totalBase;
    }
    var chunkWord = bases.slice(i, end).join("");
    var readEnd =
      end >= totalBase
        ? totalRead
        : Math.floor((end * totalRead) / totalBase);
    if (readEnd < readStart) {
      readEnd = readStart;
    }
    chunks.push({
      word: chunkWord,
      ruby: reads.slice(readStart, readEnd).join("")
    });
    readStart = readEnd;
    if (end >= totalBase) {
      break;
    }
  }

  if (readStart < totalRead && chunks.length) {
    chunks[chunks.length - 1].ruby += reads.slice(readStart).join("");
  }
  return chunks;
}

/*
 * 親字の仮名と読みの仮名を揃えて分割する。
 * 例: 調べた/しらべた → 調=しら + べた（ルビなし）
 *     優先して押さえる/ゆうせんしておさえる → 優先=ゆうせん + して + 押=お + さえる
 */
function splitRubyChunksKanaAligned(word, reading) {
  var bases = Array.from(word || "");
  var reads = Array.from(reading || "");
  if (!bases.length) {
    return [];
  }
  var chunks = [];
  var bi = 0;
  var ri = 0;

  while (bi < bases.length) {
    if (isRubyKanaChar(bases[bi])) {
      if (ri < reads.length && bases[bi] === reads[ri]) {
        chunks.push({ word: bases[bi], ruby: "" });
        bi += 1;
        ri += 1;
        continue;
      }
      /* 読み側に対応仮名が無い親字仮名はそのまま出す */
      if (ri >= reads.length || !isRubyKanaChar(reads[ri])) {
        chunks.push({ word: bases[bi], ruby: "" });
        bi += 1;
        continue;
      }
      return null;
    }

    var bj = bi;
    while (bj < bases.length && !isRubyKanaChar(bases[bj])) {
      bj += 1;
    }
    var kanji = bases.slice(bi, bj).join("");
    var nextKana = bj < bases.length ? bases[bj] : null;
    var rj = ri;
    if (nextKana != null) {
      var found = -1;
      for (var k = ri; k < reads.length; k++) {
        if (reads[k] === nextKana) {
          found = k;
          break;
        }
      }
      if (found < 0) {
        return null;
      }
      rj = found;
    } else {
      rj = reads.length;
    }
    if (rj < ri) {
      return null;
    }
    var ruby = reads.slice(ri, rj).join("");
    if (!kanji || !ruby) {
      return null;
    }
    var sub = splitRubyChunksByLength(kanji, ruby);
    for (var s = 0; s < sub.length; s++) {
      chunks.push(sub[s]);
    }
    bi = bj;
    ri = rj;
  }

  if (ri !== reads.length) {
    return null;
  }
  return chunks;
}

function splitRubyChunks(word, reading) {
  var aligned = splitRubyChunksKanaAligned(word, reading);
  if (aligned && aligned.length) {
    return aligned;
  }
  return splitRubyChunksByLength(word, reading);
}

function appendRubyChunks(fragment, word, reading) {
  var wrap = document.createElement("span");
  wrap.className = "vocab-term";
  wrap.setAttribute("data-vocab-word", word);
  if (vocabGlossByWord && vocabGlossByWord[word]) {
    wrap.classList.add("has-vocab-gloss");
  }
  var chunks = splitRubyChunks(word, reading);
  for (var i = 0; i < chunks.length; i++) {
    if (!chunks[i].ruby) {
      wrap.appendChild(document.createTextNode(chunks[i].word));
    } else {
      wrap.appendChild(createRubyPairElement(chunks[i].word, chunks[i].ruby));
    }
  }
  fragment.appendChild(wrap);
}

/* ことばアプリ（test）と同じスプレッドシート由来の英語・意味 */
var VOCAB_GLOSS_GAS_URL =
  "https://script.google.com/macros/s/AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec";
var VOCAB_GLOSS_ROOT_SEL =
  ".question-card, .koryaku-card, .koryaku-problem, .hikaku-modal-body, .hikaku-table, .hikaku-main, #questionList";
var vocabGlossByWord = null;
var vocabGlossPromise = null;
var vocabGlossActiveTerm = null;

function formatVocabGlossMeaning(text) {
  var cleaned = String(text || "").trim();
  if (!cleaned) return "";
  return cleaned.replace(/。/g, ".");
}

function extractVocabGlossWords(payload) {
  if (!payload) return [];
  if (payload.data && (payload.data.allWords || payload.data.roadmap)) {
    return payload.data.allWords || [];
  }
  if (payload.allWords) return payload.allWords;
  return [];
}

function ensureVocabGlossLoaded() {
  if (vocabGlossByWord) {
    return Promise.resolve(vocabGlossByWord);
  }
  if (vocabGlossPromise) {
    return vocabGlossPromise;
  }
  vocabGlossPromise = fetch(
    VOCAB_GLOSS_GAS_URL + "?app=kaigo&_t=" + Date.now()
  )
    .then(function (res) {
      return res.json();
    })
    .then(function (raw) {
      var words = extractVocabGlossWords(raw);
      var map = Object.create(null);
      for (var i = 0; i < words.length; i++) {
        var item = words[i] || {};
        var w = String(item.word || item.w || "").trim();
        var en = String(item.english || item.e || "").trim();
        var meaning = formatVocabGlossMeaning(item.meaning || item.m || "");
        if (!w || (!en && !meaning)) continue;
        if (!map[w]) {
          map[w] = { english: en, meaning: meaning };
        }
      }
      vocabGlossByWord = map;
      markVocabGlossTerms(document);
      return map;
    })
    .catch(function () {
      vocabGlossByWord = Object.create(null);
      return vocabGlossByWord;
    });
  return vocabGlossPromise;
}

function markVocabGlossTerms(root) {
  if (!vocabGlossByWord) return;
  var scope = root && root.querySelectorAll ? root : document;
  var terms = scope.querySelectorAll(".vocab-term[data-vocab-word]");
  for (var i = 0; i < terms.length; i++) {
    var el = terms[i];
    var w = el.getAttribute("data-vocab-word") || "";
    if (vocabGlossByWord[w]) {
      el.classList.add("has-vocab-gloss");
    } else {
      el.classList.remove("has-vocab-gloss");
    }
  }
}

function ensureVocabGlossPopup() {
  var el = document.getElementById("vocabGlossPopup");
  if (el) return el;
  el = document.createElement("div");
  el.id = "vocabGlossPopup";
  el.className = "vocab-gloss-popup";
  el.hidden = true;
  el.setAttribute("role", "tooltip");
  document.body.appendChild(el);
  return el;
}

function hideVocabGlossPopup() {
  var el = document.getElementById("vocabGlossPopup");
  if (el) {
    el.hidden = true;
    el.textContent = "";
  }
  if (vocabGlossActiveTerm) {
    vocabGlossActiveTerm.classList.remove("is-gloss-open");
    vocabGlossActiveTerm = null;
  }
}

function positionVocabGlossPopup(popup, anchor) {
  var rect = anchor.getBoundingClientRect();
  var pad = 8;
  popup.hidden = false;
  var pw = popup.offsetWidth;
  var ph = popup.offsetHeight;
  var left = rect.left + rect.width / 2 - pw / 2;
  var top = rect.bottom + 6;
  if (left < pad) left = pad;
  if (left + pw > window.innerWidth - pad) {
    left = window.innerWidth - pad - pw;
  }
  if (top + ph > window.innerHeight - pad && rect.top - ph - 6 > pad) {
    top = rect.top - ph - 6;
  }
  popup.style.left = Math.round(left) + "px";
  popup.style.top = Math.round(top) + "px";
}

function showVocabGlossFor(term) {
  if (isRubyHidden() || !term) return;
  var word = term.getAttribute("data-vocab-word") || "";
  var gloss = vocabGlossByWord && vocabGlossByWord[word];
  if (!gloss) return;
  if (!term.closest(VOCAB_GLOSS_ROOT_SEL)) return;

  var popup = ensureVocabGlossPopup();
  popup.textContent = "";
  if (gloss.english) {
    var en = document.createElement("div");
    en.className = "vocab-gloss-en";
    en.textContent = gloss.english;
    popup.appendChild(en);
  }
  if (gloss.meaning) {
    var meaning = document.createElement("div");
    meaning.className = "vocab-gloss-meaning";
    fillWithRuby(meaning, gloss.meaning);
    popup.appendChild(meaning);
  }
  if (vocabGlossActiveTerm && vocabGlossActiveTerm !== term) {
    vocabGlossActiveTerm.classList.remove("is-gloss-open");
  }
  vocabGlossActiveTerm = term;
  term.classList.add("is-gloss-open");
  positionVocabGlossPopup(popup, term);
}

function wireVocabGlossUi() {
  if (wireVocabGlossUi.done) return;
  wireVocabGlossUi.done = true;

  document.addEventListener("mouseover", function (ev) {
    if (isRubyHidden()) return;
    if (!window.matchMedia("(hover: hover)").matches) return;
    var term = ev.target.closest(".vocab-term.has-vocab-gloss");
    if (!term || !term.closest(VOCAB_GLOSS_ROOT_SEL)) return;
    showVocabGlossFor(term);
  });

  document.addEventListener("mouseout", function (ev) {
    if (!window.matchMedia("(hover: hover)").matches) return;
    var term = ev.target.closest(".vocab-term.has-vocab-gloss");
    if (!term) return;
    var next = ev.relatedTarget;
    if (next && (term.contains(next) || (next.closest && next.closest("#vocabGlossPopup")))) {
      return;
    }
    if (vocabGlossActiveTerm === term) {
      hideVocabGlossPopup();
    }
  });

  document.addEventListener("click", function (ev) {
    if (isRubyHidden()) {
      hideVocabGlossPopup();
      return;
    }
    var popup = document.getElementById("vocabGlossPopup");
    if (popup && popup.contains(ev.target)) return;
    var term = ev.target.closest(".vocab-term.has-vocab-gloss");
    if (term && term.closest(VOCAB_GLOSS_ROOT_SEL)) {
      ev.stopPropagation();
      if (vocabGlossActiveTerm === term && popup && !popup.hidden) {
        hideVocabGlossPopup();
      } else {
        showVocabGlossFor(term);
      }
      return;
    }
    hideVocabGlossPopup();
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") hideVocabGlossPopup();
  });

  window.addEventListener(
    "scroll",
    function () {
      hideVocabGlossPopup();
    },
    true
  );
}

function activateVocabGlossIfRubyOn() {
  wireVocabGlossUi();
  if (isRubyHidden()) {
    hideVocabGlossPopup();
    return;
  }
  ensureVocabGlossLoaded();
}

/* ルビ重なり避け用に入れた「漢字・かな同士の半角スペース」を表示前に除去 */
function stripRubySpacerSpaces(text) {
  return String(text || "").replace(
    /([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF々〆ヵヶ]) +(?=[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF々〆ヵヶ])/g,
    "$1"
  );
}

/*
 * ルビ幅を親字幅以下に収める（隣ルビとの重なり禁止・半角スペースなし）。
 * 字間圧縮 → それでも足りなければフォント縮小。下限でも収まらないときだけ親字より広くする。
 */
var MIN_RUBY_FIT_SCALE = 0.75;
var MIN_RUBY_LETTER_SPACING_EM = -0.38;

function fitRubyReadingToBase(pair) {
  if (!pair || !pair.getClientRects || !pair.getClientRects().length) {
    return;
  }
  var rt = null;
  var base = null;
  for (var i = 0; i < pair.children.length; i++) {
    var child = pair.children[i];
    if (child.classList.contains("ruby-text") || child.tagName === "RT") {
      rt = child;
    } else if (child.classList.contains("ruby-base")) {
      base = child;
    }
  }
  if (!rt || !base) {
    return;
  }

  rt.style.letterSpacing = "0px";
  rt.style.fontSize = "";

  var baseW = base.getBoundingClientRect().width;
  if (!(baseW > 0)) {
    return;
  }

  function readingWidth() {
    return rt.getBoundingClientRect().width;
  }

  var chars = Array.from(rt.textContent || "");
  var fontSize = parseFloat(window.getComputedStyle(rt).fontSize) || 0;
  var rtW = readingWidth();
  if (!(rtW > baseW + 0.25)) {
    return;
  }

  if (chars.length >= 2 && fontSize > 0) {
    var gaps = chars.length - 1;
    var need = (rtW - baseW) / gaps;
    var minLs = MIN_RUBY_LETTER_SPACING_EM * fontSize;
    rt.style.letterSpacing = Math.max(-need, minLs) + "px";
    rtW = readingWidth();
    if (!(rtW > baseW + 0.25)) {
      return;
    }
  }

  if (fontSize > 0) {
    var scale = Math.max(baseW / Math.max(rtW, 0.01), MIN_RUBY_FIT_SCALE);
    var fittedSize = fontSize * scale;
    rt.style.fontSize = fittedSize + "px";
    rt.style.letterSpacing = "0px";
    rtW = readingWidth();
    if (rtW > baseW + 0.25 && chars.length >= 2) {
      var gaps2 = chars.length - 1;
      var need2 = (rtW - baseW) / gaps2;
      var minLs2 = MIN_RUBY_LETTER_SPACING_EM * fittedSize;
      rt.style.letterSpacing = Math.max(-need2, minLs2) + "px";
    }
  }
}

function scheduleFitRubyIn(root) {
  var target = root || document;
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      if (!target || !target.querySelectorAll) {
        return;
      }
      var pairs = target.querySelectorAll(".ruby-pair");
      for (var i = 0; i < pairs.length; i++) {
        fitRubyReadingToBase(pairs[i]);
      }
    });
  });
}

function wireRubyFitRefresh() {
  if (wireRubyFitRefresh.done) {
    return;
  }
  wireRubyFitRefresh.done = true;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      scheduleFitRubyIn(document);
    });
  }
  window.addEventListener("resize", function () {
    scheduleFitRubyIn(document);
  });
}

function appendTextWithVocabularyRuby(container, text) {
  text = stripRubySpacerSpaces(text);
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
    /* 短単位分割: 単位内 nowrap。幅は fit で親字基準（ルビ重なり・スペースなし） */
    appendRubyChunks(fragment, m.word, m.ruby);
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
  appendHighlightedRuby(el, stripRubySpacerSpaces(text), activeHighlightTerms);
  scheduleFitRubyIn(el);
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
  "最も注意しなければならないもの",
  "主観的に記録したもの",
  "最も配慮すべき構成要素",
  "最も緊急度の高いもの",
  "最も優先度の高いもの",
  "最も可能性の高いもの",
  "最も可能性が高いもの",
  "最も割合が高いもの",
  "最も起こりやすいもの",
  "最も優先されるもの",
  "最も優先すべきもの",
  "最もふさわしいもの",
  "最も多かったもの",
  "最も適切なもの",
  "最も近い数値",
  "最も多いもの",
  "適切なもの",
  "正しいもの",
  "そのほか"
];

/* 「1つ選びなさい」等の直前の「1つ／１つ」だけ太字（本文中の別用途は除外） */
var STEM_BOLD_ONE_RE = /[1１]\s*つ(?=\s*選び)/g;

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
  STEM_BOLD_ONE_RE.lastIndex = from;
  var one = STEM_BOLD_ONE_RE.exec(text);
  if (one) {
    var oneStart = one.index;
    var oneEnd = oneStart + one[0].length;
    if (
      !best ||
      oneStart < best.start ||
      (oneStart === best.start && oneEnd - oneStart > best.end - best.start)
    ) {
      best = { start: oneStart, end: oneEnd, phrase: one[0] };
    }
  }
  return best;
}

function fillStemWithRuby(el, text) {
  text = stripRubySpacerSpaces(text);
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
  scheduleFitRubyIn(el);
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

/* 第29〜31回: QB印刷番号は第32型の科目配置。公式番号とは別。 */
var QB_PRINT_ALIAS_ROUNDS = { 29: 1, 30: 1, 31: 1 };
var OFFICIAL_RANGES_PRE32 = [
  ["人間の尊厳と自立", 1, 2],
  ["人間関係とコミュニケーション", 3, 6],
  ["社会の理解", 7, 18],
  ["こころとからだのしくみ", 19, 30],
  ["発達と老化の理解", 31, 38],
  ["認知症の理解", 39, 48],
  ["障害の理解", 49, 58],
  ["医療的ケア", 59, 63],
  ["介護の基本", 64, 73],
  ["コミュニケーション技術", 74, 79],
  ["生活支援技術", 80, 105],
  ["介護過程", 106, 113],
  ["総合問題", 114, 125]
];
var QB32_SUBJECT_RANGES = [
  ["人間の尊厳と自立", 1, 2],
  ["人間関係とコミュニケーション", 3, 4],
  ["社会の理解", 5, 16],
  ["介護の基本", 17, 26],
  ["コミュニケーション技術", 27, 34],
  ["生活支援技術", 35, 60],
  ["介護過程", 61, 68],
  ["発達と老化の理解", 69, 76],
  ["認知症の理解", 77, 86],
  ["障害の理解", 87, 96],
  ["こころとからだのしくみ", 97, 108],
  ["医療的ケア", 109, 113],
  ["総合問題", 114, 125]
];

function usesQbPrintAlias(round) {
  return !!QB_PRINT_ALIAS_ROUNDS[Number(round)];
}

function mapNumberAcrossLayouts(num, fromRanges, toRanges) {
  var n = Number(num);
  if (!n || isNaN(n)) {
    return null;
  }
  var toBySubject = {};
  for (var t = 0; t < toRanges.length; t++) {
    toBySubject[toRanges[t][0]] = toRanges[t];
  }
  for (var i = 0; i < fromRanges.length; i++) {
    var subject = fromRanges[i][0];
    var fromStart = fromRanges[i][1];
    var fromEnd = fromRanges[i][2];
    if (n < fromStart || n > fromEnd) {
      continue;
    }
    var dest = toBySubject[subject];
    if (!dest) {
      return null;
    }
    var out = dest[1] + (n - fromStart);
    if (out > dest[2]) {
      return null;
    }
    return out;
  }
  return null;
}

function qbPrintToOfficialNumber(round, qbNum) {
  if (!usesQbPrintAlias(round)) {
    return null;
  }
  return mapNumberAcrossLayouts(qbNum, QB32_SUBJECT_RANGES, OFFICIAL_RANGES_PRE32);
}

function officialToQbPrintNumber(round, officialNum) {
  if (!usesQbPrintAlias(round)) {
    return null;
  }
  return mapNumberAcrossLayouts(
    officialNum,
    OFFICIAL_RANGES_PRE32,
    QB32_SUBJECT_RANGES
  );
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

function countSubjectsForFilters(questions, sessionFrom, sessionTo, type, terms) {
  var range = normalizeRange(sessionFrom, sessionTo);
  var typeFilter = String(type || "").trim();
  var norms = (terms || []).map(normalizeForSearch).filter(Boolean);
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
    var s = String(q.subject || "").trim();
    if (!s) {
      continue;
    }
    counts[s] = (counts[s] || 0) + 1;
    total++;
  }
  return { counts: counts, total: total };
}

function countTypesForFilters(questions, sessionFrom, sessionTo, subject, terms) {
  var range = normalizeRange(sessionFrom, sessionTo);
  var subjectFilter = String(subject || "").trim();
  var norms = (terms || []).map(normalizeForSearch).filter(Boolean);
  var counts = {};
  var total = 0;
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var round = Number(q.round);
    if (round < range.from || round > range.to) {
      continue;
    }
    if (subjectFilter && String(q.subject || "") !== subjectFilter) {
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
    var typ = questionType(q);
    counts[typ] = (counts[typ] || 0) + 1;
    total++;
  }
  return { counts: counts, total: total };
}

function getFilterKeywordTerms() {
  var input = document.getElementById("searchInput");
  return parseTerms(input ? input.value : "");
}

function updateSubjectOptionCounts() {
  var el = document.getElementById("subjectSelect");
  if (!el || !questionsReady) {
    return;
  }
  var range = getSelectedRange();
  var type = getSelectedType();
  var terms = getFilterKeywordTerms();
  var result = countSubjectsForFilters(
    allQuestions,
    range.from,
    range.to,
    type,
    terms
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

function updateTypeOptionCounts() {
  var el = document.getElementById("typeSelect");
  if (!el || !questionsReady) {
    return;
  }
  var range = getSelectedRange();
  var subject = getSelectedSubject();
  var terms = getFilterKeywordTerms();
  var result = countTypesForFilters(
    allQuestions,
    range.from,
    range.to,
    subject,
    terms
  );
  for (var i = 0; i < el.options.length; i++) {
    var opt = el.options[i];
    if (!opt.value) {
      opt.textContent = "すべてのタイプ（" + result.total + "）";
      continue;
    }
    var n = result.counts[opt.value] || 0;
    opt.textContent = opt.value + "（" + n + "）";
  }
}


function updateFilterOptionCounts() {
  updateSubjectOptionCounts();
  updateTypeOptionCounts();
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
    updateFilterOptionCounts();
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
  updateFilterOptionCounts();
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

  if (open) {
    li.classList.remove("is-study-hidden");
  }
  li.classList.toggle("is-open", open);
  li.classList.toggle("is-correct", open && ok);
  li.classList.toggle("is-wrong", open && !ok);
  var expanded = open ? "true" : "false";
  li.setAttribute("aria-expanded", expanded);
  var hit = li.querySelector(".choice-toggle-hit");
  if (hit) {
    hit.setAttribute("aria-expanded", expanded);
  }

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
  btn.hidden = false;
  var labelOpen = btn.querySelector(".label-open");
  if (labelOpen) {
    labelOpen.textContent = "表示";
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
  btn.setAttribute("aria-label", allOpen ? "表示を閉じる" : "表示する");
}

function toggleChoice(li, trial, card) {
  /* 読むモード: ◯で✕展開／展開中は◯・✕どちらでも閉じる */
  if (card.classList.contains("is-read-mode")) {
    if (card.classList.contains("is-read-all")) {
      showReadCorrectOnly(card, trial);
      return;
    }
    var n = Number(li.getAttribute("data-choice-n"));
    if (isCorrectChoice(trial, n)) {
      showReadAllOnCard(card, trial);
    }
    return;
  }
  li.classList.remove("is-study-hidden");
  var open = !li.classList.contains("is-open");
  setChoiceOpen(li, trial, open);
  syncRevealAllButton(card);
}

function clearReadModeClasses(card) {
  card.classList.remove("is-read-mode", "is-read-all");
  var items = card.querySelectorAll(".choice");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove("is-study-hidden");
  }
  /* 旧1枚送りナビが残っていれば隠す */
  var nav = card.querySelector(".wrong-step-nav");
  if (nav) {
    nav.hidden = true;
  }
}

/* 読むモード初期: 正解だけ表示 */
function showReadCorrectOnly(card, trial) {
  card.classList.add("is-read-mode");
  card.classList.remove("is-read-all");
  var items = card.querySelectorAll(".choice");
  for (var i = 0; i < items.length; i++) {
    var li = items[i];
    var n = Number(li.getAttribute("data-choice-n"));
    var ok = isCorrectChoice(trial, n);
    if (ok) {
      li.classList.remove("is-study-hidden");
      setChoiceOpen(li, trial, true);
    } else {
      li.classList.add("is-study-hidden");
      setChoiceOpen(li, trial, false);
    }
  }
  syncRevealAllButton(card);
}

/* 解説: 正解を上、✕をその下に全部表示 */
function showReadAllOnCard(card, trial) {
  card.classList.add("is-read-mode", "is-read-all");
  var items = card.querySelectorAll(".choice");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove("is-study-hidden");
    setChoiceOpen(items[i], trial, true);
  }
  syncRevealAllButton(card);
}

function exitReadModeOnCard(card, trial) {
  clearReadModeClasses(card);
  var items = card.querySelectorAll(".choice");
  for (var i = 0; i < items.length; i++) {
    setChoiceOpen(items[i], trial, false);
  }
  syncRevealAllButton(card);
}

function setAllChoices(card, trial, open) {
  if (isAnswerShowOn()) {
    if (open) {
      showReadAllOnCard(card, trial);
    } else {
      showReadCorrectOnly(card, trial);
    }
    return;
  }
  clearReadModeClasses(card);
  var allItems = card.querySelectorAll(".choice");
  for (var j = 0; j < allItems.length; j++) {
    setChoiceOpen(allItems[j], trial, open);
  }
  syncRevealAllButton(card);
}

function applyAnswerShowToAllCards() {
  var cards = document.querySelectorAll(".question-card.is-quiz-trial");
  var reading = isAnswerShowOn();
  var explainAll = isExplainAllOn();
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var trial = card.__answerTrial;
    if (!trial) {
      continue;
    }
    if (reading) {
      if (explainAll) {
        showReadAllOnCard(card, trial);
      } else {
        showReadCorrectOnly(card, trial);
      }
    } else {
      exitReadModeOnCard(card, trial);
      if (explainAll) {
        setAllChoices(card, trial, true);
      }
    }
  }
}

function applyExplainAllToAllCards() {
  var cards = document.querySelectorAll(".question-card.is-quiz-trial");
  var open = isExplainAllOn();
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var trial = card.__answerTrial;
    if (!trial) {
      continue;
    }
    setAllChoices(card, trial, open);
  }
}

function wireAnswerCheck(card, q, trial) {
  card.classList.add("is-quiz-trial");
  card.__answerTrial = trial;

  var metaRow = card.querySelector(".meta-row");
  if (metaRow) {
    var revealAll = document.createElement("button");
    revealAll.type = "button";
    revealAll.className = "quiz-reveal-all";
    revealAll.setAttribute("aria-pressed", "false");
    revealAll.setAttribute("aria-label", "表示する");
    var labelOpen = document.createElement("span");
    labelOpen.className = "label-open";
    labelOpen.textContent = "表示";
    var labelClose = document.createElement("span");
    labelClose.className = "label-close";
    labelClose.textContent = "閉じる";
    labelClose.setAttribute("aria-hidden", "true");
    revealAll.appendChild(labelOpen);
    revealAll.appendChild(labelClose);
    revealAll.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var allOpen = revealAll.dataset.allOpen === "1";
      setAllChoices(card, trial, !allOpen);
    });
    var qbBadge = metaRow.querySelector(".badge-qb");
    if (qbBadge) {
      metaRow.insertBefore(revealAll, qbBadge);
    } else {
      metaRow.appendChild(revealAll);
    }
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
      var nWrap = li.querySelector(".choice-n-wrap");
      (nWrap || li.querySelector(".choice-body") || li).appendChild(mark);

      li.classList.add("is-tappable");
      li.setAttribute("aria-expanded", "false");

      var hit = document.createElement("button");
      hit.type = "button";
      hit.className = "choice-toggle-hit";
      hit.setAttribute("aria-label", "解説を開閉");
      hit.setAttribute("aria-expanded", "false");
      li.insertBefore(hit, li.firstChild);

      function onPick(ev) {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        /* 語句選択中は解説トグルしない（「これ、出た？」と衝突しない） */
        var sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed && sel.rangeCount) {
          try {
            var node = sel.getRangeAt(0).commonAncestorContainer;
            var host = node && node.nodeType === 1 ? node : node && node.parentElement;
            if (host && li.contains(host)) {
              return;
            }
          } catch (err) {
            /* ignore */
          }
        }
        toggleChoice(li, trial, card);
      }
      hit.addEventListener("click", onPick);
    })(choices[c]);
  }

  if (isAnswerShowOn()) {
    if (isExplainAllOn()) {
      showReadAllOnCard(card, trial);
    } else {
      showReadCorrectOnly(card, trial);
    }
  } else if (isExplainAllOn()) {
    setAllChoices(card, trial, true);
  } else {
    syncRevealAllButton(card);
  }
}

function kakomonAssetUrl(src) {
  var s = String(src || "");
  if (!s) {
    return s;
  }
  if (/^https?:\/\//i.test(s) || s.charAt(0) === "/") {
    return s;
  }
  if (s.indexOf("figures/") === 0) {
    return "/kaigo/kakomon/" + s;
  }
  return s;
}

/* クエスチョン・バンク教科書ページ（第38回は未収録のため 528〜） */
function resolveQbLabel(q) {
  if (!q) {
    return null;
  }
  if (q.qb != null && q.qb !== "") {
    return q.qb;
  }
  if (Number(q.round) === 38) {
    return "528〜";
  }
  return null;
}

function appendQuestionCard(parent, q) {
  if (!parent || !q) {
    return null;
  }
  var card = document.createElement("article");
  card.className = "question-card";
  card.id = "q-" + q.id;

  var metaRow = document.createElement("div");
  metaRow.className = "meta-row";

  var idBadge = document.createElement("span");
  idBadge.className = "badge badge-id";
  idBadge.textContent = q.round + "-" + q.number;
  metaRow.appendChild(idBadge);

  var qbPrintNum = officialToQbPrintNumber(q.round, q.number);
  if (qbPrintNum != null && Number(qbPrintNum) !== Number(q.number)) {
    var printBadge = document.createElement("span");
    printBadge.className = "badge badge-qb-print";
    printBadge.textContent = "QB " + q.round + "-" + qbPrintNum;
    metaRow.appendChild(printBadge);
  }

  if (q.subject) {
    var subBadge = document.createElement("span");
    subBadge.className = "badge badge-subject";
    fillWithRuby(subBadge, q.subject);
    metaRow.appendChild(subBadge);
  }
  var qbLabel = resolveQbLabel(q);
  if (qbLabel != null) {
    q.qb = qbLabel;
    var qbBadge = document.createElement("span");
    qbBadge.className = "badge badge-qb";
    qbBadge.textContent = "QB." + qbLabel;
    metaRow.appendChild(qbBadge);
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

  var figs = q.figures || [];
  if (figs.length) {
    var figWrap = document.createElement("div");
    figWrap.className = "question-figures";
    for (var fi = 0; fi < figs.length; fi++) {
      var fig = document.createElement("figure");
      fig.className = "question-figure";
      var img = document.createElement("img");
      img.className = "question-figure-img";
      img.src = kakomonAssetUrl(figs[fi] || "");
      img.alt = "問題" + q.number + "の図";
      img.loading = "lazy";
      fig.appendChild(img);
      figWrap.appendChild(fig);
    }
    card.appendChild(figWrap);
  }

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

    var choiceFigs = q.choiceFigures || {};
    var choiceFigSrc = choiceFigs[String(choice.n)];
    if (choiceFigSrc) {
      var cfig = document.createElement("img");
      cfig.className = "choice-figure-img";
      cfig.src = kakomonAssetUrl(choiceFigSrc);
      cfig.alt = "選択肢" + choice.n + "の図";
      cfig.loading = "lazy";
      li.appendChild(cfig);
    }

    ul.appendChild(li);
  }
  card.appendChild(ul);

  var trial = getAnswerCheck(q);
  if (trial) {
    wireAnswerCheck(card, q, trial);
  }

  parent.appendChild(card);
  return card;
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
    appendQuestionCard(root, questions[i]);
  }
  markVocabGlossTerms(root);
  activateVocabGlossIfRubyOn();
}

/* テキスト: 科目アコーディオン（指導順・区切り付き） */
var TEXT_THEME_SUBJECT_BLOCKS = [
  {
    label: "介護",
    subjects: [
      "生活支援技術",
      "人間の尊厳と自立",
      "介護の基本",
      "介護過程",
      "人間関係とコミュニケーション",
      "コミュニケーション技術"
    ]
  },
  {
    label: "医療",
    subjects: [
      "こころとからだのしくみ",
      "発達と老化の理解",
      "認知症の理解",
      "障害の理解",
      "医療的ケア"
    ]
  },
  {
    label: "社会",
    subjects: ["社会の理解", "総合問題"]
  }
];

var textThemeAllQuestions = null;

function ensureTextThemeSearchPanel() {
  if (document.getElementById("textThemeSearchPanel")) {
    return;
  }
  var header = document.querySelector(".page-header");
  if (!header) {
    return;
  }
  var panel = document.createElement("section");
  panel.id = "textThemeSearchPanel";
  panel.className = "panel panel-jump text-theme-search-panel";
  panel.setAttribute("aria-label", "テキストの検索");
  panel.innerHTML =
    '<form id="textThemeSearchForm" class="search-form" action="#" method="get">' +
    '<div class="field-block field-block-search">' +
    '<label class="range-caption" for="textThemeSearchInput">キーワード</label>' +
    '<div class="search-row">' +
    '<div class="search-input-wrap">' +
    '<input id="textThemeSearchInput" class="search-input" type="search" name="q" ' +
    'placeholder="例: アセスメント　ノーマライゼーション" maxlength="80" autocomplete="off" enterkeyhint="search">' +
    '<button type="button" id="textThemeSearchClear" class="search-clear" hidden aria-label="キーワードを消す">×</button>' +
    "</div>" +
    '<button type="submit" class="search-button">調べる</button>' +
    "</div></div></form>" +
    '<p id="textThemeSearchStatus" class="search-status" aria-live="polite" hidden></p>';
  header.appendChild(panel);

  var form = document.getElementById("textThemeSearchForm");
  var input = document.getElementById("textThemeSearchInput");
  var clearBtn = document.getElementById("textThemeSearchClear");
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    applyTextThemeSearch();
  });
  input.addEventListener("input", function () {
    clearBtn.hidden = !String(input.value || "").trim();
  });
  clearBtn.addEventListener("click", function () {
    input.value = "";
    clearBtn.hidden = true;
    applyTextThemeSearch();
    input.focus();
  });
}

function questionMatchesTerms(q, terms) {
  if (!terms || !terms.length) {
    return true;
  }
  var hay = questionSearchText(q);
  var norms = terms.map(normalizeForSearch).filter(Boolean);
  for (var i = 0; i < norms.length; i++) {
    if (hay.indexOf(norms[i]) === -1) {
      return false;
    }
  }
  return true;
}

function applyTextThemeSearch() {
  var input = document.getElementById("textThemeSearchInput");
  var status = document.getElementById("textThemeSearchStatus");
  var raw = input ? String(input.value || "") : "";
  var terms = parseTerms(raw);
  setActiveHighlightTerms(terms);
  var all = textThemeAllQuestions || [];
  var filtered = [];
  for (var i = 0; i < all.length; i++) {
    if (questionMatchesTerms(all[i], terms)) {
      filtered.push(all[i]);
    }
  }
  renderTextThemeBySubject(filtered, {
    forceOpen: terms.length > 0,
    emptyMessage: terms.length
      ? "該当する問題がありません。キーワードを変えて試してください。"
      : "該当する問題がありません。"
  });
  if (status) {
    if (!terms.length) {
      status.hidden = true;
      status.textContent = "";
    } else {
      status.hidden = false;
      status.textContent = "";
      fillWithRuby(status, filtered.length + " 問ヒット（閉じた科目も含む）");
    }
  }
  setStatus(filtered.length + " 問");
}

function appendTextThemeSubjectAccordion(parent, subject, questions, forceOpen) {
  var open = !!forceOpen && questions.length > 0;
  var panelId =
    "text-theme-subject-" +
    String(subject).replace(/[^\w\u3040-\u30ff\u4e00-\u9fff]+/g, "-");
  var section = document.createElement("section");
  section.className =
    "theme-group text-theme-subject" + (open ? " is-open" : "");
  section.setAttribute("data-subject", subject);

  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "theme-group-toggle text-theme-subject-toggle";
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.setAttribute("aria-controls", panelId);

  var chevron = document.createElement("span");
  chevron.className = "theme-group-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";
  toggle.appendChild(chevron);

  var textWrap = document.createElement("span");
  textWrap.className = "theme-group-toggle-text";
  var h2 = document.createElement("span");
  h2.className = "theme-group-title";
  fillWithRuby(h2, subject);
  textWrap.appendChild(h2);
  var gmeta = document.createElement("span");
  gmeta.className = "theme-group-meta";
  fillQuestionCountMeta(gmeta, questions.length);
  textWrap.appendChild(gmeta);
  toggle.appendChild(textWrap);
  section.appendChild(toggle);

  var list = document.createElement("div");
  list.className = "theme-group-list text-theme-subject-list";
  list.id = panelId;
  list.hidden = !open;
  section.appendChild(list);

  /* 閉じた科目はカード未生成。開いたタイミングで描画して初期表示を速くする */
  var rendered = false;
  function ensureCardsRendered() {
    if (rendered) {
      return;
    }
    rendered = true;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < questions.length; i++) {
      appendQuestionCard(frag, questions[i]);
    }
    list.appendChild(frag);
    markVocabGlossTerms(list);
    activateVocabGlossIfRubyOn();
  }
  if (open) {
    ensureCardsRendered();
  }

  toggle.addEventListener("click", function () {
    var next = !section.classList.contains("is-open");
    if (next) {
      ensureCardsRendered();
    }
    section.classList.toggle("is-open", next);
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
    list.hidden = !next;
  });

  parent.appendChild(section);
}

/* テキスト科目内: QBページ順 → 第38回は末尾・問題番号順 */
function compareTextThemeQuestionsByQb(a, b) {
  var ra = Number(a && a.round) || 0;
  var rb = Number(b && b.round) || 0;
  var a38 = ra === 38 ? 1 : 0;
  var b38 = rb === 38 ? 1 : 0;
  if (a38 !== b38) {
    return a38 - b38;
  }
  if (a38) {
    return (Number(a.number) || 0) - (Number(b.number) || 0);
  }
  function qbPage(q) {
    var v = q && q.qb;
    if (typeof v === "number" && isFinite(v)) {
      return v;
    }
    var n = Number(v);
    return isFinite(n) ? n : 1e9;
  }
  var pa = qbPage(a);
  var pb = qbPage(b);
  if (pa !== pb) {
    return pa - pb;
  }
  if (ra !== rb) {
    return ra - rb;
  }
  return (Number(a.number) || 0) - (Number(b.number) || 0);
}

var textThemeLeadTheme = null;

function appendTextThemeLeadAndBreak(root) {
  if (!textThemeLeadTheme) {
    return;
  }
  appendThemeCard(root, textThemeLeadTheme, "");
  var sepLead = document.createElement("p");
  sepLead.className = "theme-block-label theme-block-label-break";
  sepLead.setAttribute("aria-hidden", "true");
  sepLead.textContent = "-----";
  root.appendChild(sepLead);
}

function renderTextThemeBySubject(questions, options) {
  var root = document.getElementById("questionList");
  if (!root) {
    return;
  }
  options = options || {};
  root.textContent = "";
  root.classList.add("text-theme-question-list");

  var bySubject = {};
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var sub = String(q.subject || "").trim() || "未分類";
    if (!bySubject[sub]) {
      bySubject[sub] = [];
    }
    bySubject[sub].push(q);
  }
  Object.keys(bySubject).forEach(function (sub) {
    bySubject[sub].sort(compareTextThemeQuestionsByQb);
  });

  appendTextThemeLeadAndBreak(root);

  var any = false;
  for (var b = 0; b < TEXT_THEME_SUBJECT_BLOCKS.length; b++) {
    var block = TEXT_THEME_SUBJECT_BLOCKS[b];
    var blockHas = false;
    for (var s = 0; s < block.subjects.length; s++) {
      if ((bySubject[block.subjects[s]] || []).length) {
        blockHas = true;
        break;
      }
    }
    if (!blockHas) {
      continue;
    }
    if (b > 0) {
      var sep = document.createElement("p");
      sep.className = "theme-block-label theme-block-label-break";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "————";
      root.appendChild(sep);
    }
    for (var si = 0; si < block.subjects.length; si++) {
      var subject = block.subjects[si];
      var list = bySubject[subject] || [];
      if (!list.length) {
        continue;
      }
      any = true;
      appendTextThemeSubjectAccordion(
        root,
        subject,
        list,
        !!options.forceOpen
      );
      delete bySubject[subject];
    }
  }

  var leftovers = Object.keys(bySubject);
  if (leftovers.length) {
    if (any) {
      var sep2 = document.createElement("p");
      sep2.className = "theme-block-label theme-block-label-break";
      sep2.setAttribute("aria-hidden", "true");
      sep2.textContent = "————";
      root.appendChild(sep2);
    }
    leftovers.sort();
    for (var li = 0; li < leftovers.length; li++) {
      var sub2 = leftovers[li];
      any = true;
      appendTextThemeSubjectAccordion(
        root,
        sub2,
        bySubject[sub2],
        !!options.forceOpen
      );
    }
  }

  if (!any) {
    var empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent =
      options.emptyMessage || "該当する問題がありません。";
    root.appendChild(empty);
  }

  markVocabGlossTerms(root);
  activateVocabGlossIfRubyOn();
}

function applyVocabularyWords(words) {
  vocabularyRubyEntries = null;
  getVocabularyRubyEntries(words || []);
}

function setStatus(text) {
  var el = document.getElementById("searchStatus");
  if (!el) return;
  el.textContent = "";
  if (!text) return;
  fillWithRuby(el, text);
}

function showHint(message) {
  var root = document.getElementById("questionList") || document.getElementById("themeList");
  if (!root) return;
  root.textContent = "";
  var p = document.createElement("p");
  p.className = "hint";
  fillWithRuby(p, message);
  root.appendChild(p);
}

function showError(message) {
  var root = document.getElementById("questionList") || document.getElementById("themeList");
  if (!root) return;
  root.textContent = "";
  var p = document.createElement("p");
  p.className = "error";
  fillWithRuby(p, message);
  root.appendChild(p);
}

var RUBY_HIDDEN_KEY = "kakomon.rubyHidden";

function isRubyHidden() {
  try {
    return localStorage.getItem(RUBY_HIDDEN_KEY) === "1";
  } catch (err) {
    return false;
  }
}

function setRubyHidden(hidden) {
  try {
    localStorage.setItem(RUBY_HIDDEN_KEY, hidden ? "1" : "0");
  } catch (err) {
    /* ignore */
  }
  if (document.body) {
    document.body.classList.toggle("ruby-off", !!hidden);
  }
  var btn = document.getElementById("rubyToggle");
  if (btn) {
    btn.setAttribute("aria-pressed", hidden ? "false" : "true");
    btn.textContent = "ルビ";
    btn.setAttribute(
      "aria-label",
      hidden ? "ルビを表示する" : "ルビを非表示にする"
    );
  }
  if (hidden) {
    hideVocabGlossPopup();
  } else {
    activateVocabGlossIfRubyOn();
  }
}

function wireSiteNav() {
  var bar = document.querySelector(".site-bar");
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("siteNav");
  if (!bar || !toggle || !nav) {
    return;
  }
  function setOpen(open) {
    bar.classList.toggle("is-open", !!open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  toggle.addEventListener("click", function () {
    setOpen(!bar.classList.contains("is-open"));
  });
  document.addEventListener("click", function (ev) {
    if (!bar.contains(ev.target)) {
      setOpen(false);
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      setOpen(false);
    }
  });
}

/* 国試日（ローカル日付の差）。2026-11-05 → あと87日 */
var EXAM_DATE = { y: 2027, m: 0, d: 31 };

function daysUntilExam() {
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var exam = new Date(EXAM_DATE.y, EXAM_DATE.m, EXAM_DATE.d);
  return Math.round((exam.getTime() - today.getTime()) / 86400000);
}

var EXAM_COUNTDOWN_HIDE_KEY = "kakomon.examCountdown.hidden";
var HEADER_CHROME_MARK_HIDE = "▼";
var HEADER_CHROME_MARK_SHOW = "▶";

function isExamCountdownHidden() {
  try {
    return sessionStorage.getItem(EXAM_COUNTDOWN_HIDE_KEY) === "1";
  } catch (err) {
    return false;
  }
}

function setExamCountdownHidden(hidden) {
  try {
    if (hidden) {
      sessionStorage.setItem(EXAM_COUNTDOWN_HIDE_KEY, "1");
    } else {
      sessionStorage.removeItem(EXAM_COUNTDOWN_HIDE_KEY);
    }
  } catch (err) {
    /* ignore */
  }
}

function fillExamCountdownLabel(el) {
  var days = daysUntilExam();
  if (days > 0) {
    el.textContent = "";
    var prefix = document.createElement("span");
    prefix.className = "exam-countdown-prefix";
    prefix.textContent = "あと";
    el.appendChild(prefix);
    el.appendChild(document.createTextNode(String(days)));
    var unit = document.createElement("span");
    unit.className = "exam-countdown-unit";
    unit.textContent = "日";
    el.appendChild(unit);
    el.setAttribute(
      "aria-label",
      "介護福祉士国家試験まであと" + days + "日（2027年1月31日）"
    );
    return true;
  }
  if (days === 0) {
    el.textContent = "本日";
    el.setAttribute("aria-label", "介護福祉士国家試験は本日です");
    return true;
  }
  el.textContent = "";
  el.removeAttribute("aria-label");
  return false;
}

function unwrapPageTitleRow() {
  var row = document.getElementById("pageTitleRow");
  if (!row || !row.parentNode) {
    return;
  }
  var parent = row.parentNode;
  while (row.firstChild) {
    parent.insertBefore(row.firstChild, row);
  }
  parent.removeChild(row);
}

function applyHeaderChromeCollapsed(collapsed) {
  setExamCountdownHidden(collapsed);
  if (document.body) {
    document.body.classList.toggle("header-chrome-collapsed", !!collapsed);
  }
  var row = document.getElementById("headerToolRow") || ensureHeaderToolRow();
  if (row) {
    row.hidden = !!collapsed;
  }
  var toggle = document.getElementById("headerChromeToggle");
  if (toggle) {
    toggle.textContent = collapsed ? HEADER_CHROME_MARK_SHOW : HEADER_CHROME_MARK_HIDE;
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.title = collapsed ? "表示切替ボタンを再表示" : "表示切替ボタンを隠す";
    toggle.setAttribute(
      "aria-label",
      collapsed ? "表示切替ボタンを再表示" : "表示切替ボタンを隠す"
    );
  }
}

function ensureSiteBarEnd() {
  var bar = document.querySelector(".site-bar");
  if (!bar) {
    return null;
  }
  var end = document.getElementById("siteBarEnd");
  if (end) {
    if (end.parentNode !== bar) {
      bar.appendChild(end);
    } else if (end.nextSibling) {
      bar.appendChild(end);
    }
    return end;
  }
  end = document.createElement("div");
  end.id = "siteBarEnd";
  end.className = "site-bar-end";
  bar.appendChild(end);
  return end;
}

function ensureExamCountdown() {
  unwrapPageTitleRow();
  var end = ensureSiteBarEnd();
  if (!end) {
    return;
  }
  var el = document.getElementById("examCountdown");
  if (!el) {
    el = document.createElement("span");
    el.id = "examCountdown";
    el.className = "exam-countdown";
  }
  if (el.parentNode !== end) {
    end.insertBefore(el, end.firstChild);
  }
  if (!fillExamCountdownLabel(el)) {
    el.hidden = true;
  } else {
    el.hidden = false;
  }

  var toggle = document.getElementById("headerChromeToggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "headerChromeToggle";
    toggle.className = "header-chrome-toggle";
    toggle.setAttribute("aria-controls", "headerToolRow");
    toggle.addEventListener("click", function () {
      applyHeaderChromeCollapsed(!isExamCountdownHidden());
    });
  }
  if (toggle.parentNode !== end) {
    end.appendChild(toggle);
  }
  applyHeaderChromeCollapsed(isExamCountdownHidden());
}

/* 2行目: 読む・ルビ。3行目が見出し */
function ensureHeaderToolRow() {
  var header = document.querySelector(".page-header");
  if (!header) {
    return null;
  }
  var row = document.getElementById("headerToolRow");
  if (row) {
    return row;
  }
  row = document.createElement("div");
  row.id = "headerToolRow";
  row.className = "header-tool-row";
  row.setAttribute("role", "toolbar");
  row.setAttribute("aria-label", "表示切替");
  var h1 = header.querySelector(":scope > h1");
  if (h1) {
    header.insertBefore(row, h1);
  } else {
    header.appendChild(row);
  }
  return row;
}

function wireRubyToggle() {
  setRubyHidden(isRubyHidden());
  var row = ensureHeaderToolRow();
  if (!row || document.getElementById("rubyToggle")) {
    activateVocabGlossIfRubyOn();
    return;
  }
  var btn = document.createElement("button");
  btn.type = "button";
  btn.id = "rubyToggle";
  btn.className = "ruby-toggle";
  row.appendChild(btn);
  setRubyHidden(isRubyHidden());
  btn.addEventListener("click", function () {
    setRubyHidden(!isRubyHidden());
  });
  activateVocabGlossIfRubyOn();
}

function insertHeaderToolAfter(row, el, afterId) {
  var after = afterId ? document.getElementById(afterId) : null;
  if (after && after.parentNode === row) {
    if (after.nextSibling) {
      row.insertBefore(el, after.nextSibling);
    } else {
      row.appendChild(el);
    }
    return;
  }
  row.appendChild(el);
}

function pathIsUnder(prefix) {
  var path = (location && location.pathname) || "";
  return path === prefix || path.indexOf(prefix) === 0;
}

/* ルビの右隣: これ出た？・番号サーチ（全ページ共通） */
function wireQuickNavLinks() {
  var row = ensureHeaderToolRow();
  if (!row) {
    return;
  }
  if (!document.getElementById("termNavLink")) {
    var term = document.createElement("a");
    term.id = "termNavLink";
    term.className = "ruby-toggle themes-nav-link header-quick-nav";
    term.href = "/kaigo/kakomon/term/";
    term.textContent = "🔎";
    term.title = "これ、出た？";
    term.setAttribute("aria-label", "これ、出た？");
    if (pathIsUnder("/kaigo/kakomon/term")) {
      term.setAttribute("aria-current", "page");
      term.classList.add("is-current");
    }
    insertHeaderToolAfter(row, term, "rubyToggle");
  }
  if (!document.getElementById("numberNavLink")) {
    var num = document.createElement("a");
    num.id = "numberNavLink";
    num.className = "ruby-toggle themes-nav-link header-quick-nav";
    num.href = "/kaigo/kakomon/number/";
    num.textContent = "123";
    num.title = "番号サーチ";
    num.setAttribute("aria-label", "番号サーチ");
    if (pathIsUnder("/kaigo/kakomon/number")) {
      num.setAttribute("aria-current", "page");
      num.classList.add("is-current");
    }
    insertHeaderToolAfter(row, num, "termNavLink");
  }
}

function wireThemesNavLink() {
  var row = ensureHeaderToolRow();
  if (!row || document.getElementById("themesNavLink")) {
    return;
  }
  var link = document.createElement("a");
  link.id = "themesNavLink";
  link.className = "ruby-toggle themes-nav-link";
  link.href = "/kaigo/kakomon/themes/";
  link.textContent = "テーマ";
  link.setAttribute("aria-label", "テーマ一覧へ");
  if (pathIsUnder("/kaigo/kakomon/themes")) {
    link.setAttribute("aria-current", "page");
    link.classList.add("is-current");
  }
  /* ルビ → 🔎 → 123 の右隣 */
  var afterId = document.getElementById("numberNavLink")
    ? "numberNavLink"
    : document.getElementById("termNavLink")
      ? "termNavLink"
      : "rubyToggle";
  insertHeaderToolAfter(row, link, afterId);
}

/* 適切（◯）／比較（↔）／不適切（✕）マップ切替 */
var JIRITSU_SEIKAI_URL = "/kaigo/kakomon/themes/hikaku-jiritsu.html";
var JIRITSU_NG_URL = "/kaigo/kakomon/themes/hikaku-jiritsu-ng.html";

function wireJiritsuMapLinks() {
  /* ◯/✕ トグルは出さない */
  return;
  var row = ensureHeaderToolRow();
  if (!row || document.getElementById("jiritsuMapToggleGroup")) {
    return;
  }
  var path = (location && location.pathname) || "";
  var onNg = path.indexOf("hikaku-jiritsu-ng") !== -1;
  var onSeikai = !onNg && path.indexOf("hikaku-jiritsu") !== -1;
  if (!onNg && !onSeikai) {
    return;
  }

  var group = document.createElement("span");
  group.id = "jiritsuMapToggleGroup";
  group.className = "jiritsu-map-toggle-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "◯と✕の切替");

  var specs = [
    {
      id: "jiritsuMapToggleOk",
      href: JIRITSU_SEIKAI_URL,
      text: "◯",
      label: "国試で◯になる選択肢",
      current: onSeikai
    },
    {
      id: "jiritsuMapToggleNg",
      href: JIRITSU_NG_URL,
      text: "✕",
      label: "国試で✕になる選択肢",
      current: onNg
    }
  ];

  for (var i = 0; i < specs.length; i++) {
    var spec = specs[i];
    var btn = document.createElement("a");
    btn.id = spec.id;
    btn.className = "ruby-toggle themes-nav-link jiritsu-map-toggle";
    btn.href = spec.href;
    btn.textContent = spec.text;
    btn.title = spec.label;
    btn.setAttribute("aria-label", spec.label);
    btn.setAttribute("aria-pressed", spec.current ? "true" : "false");
    if (spec.current) {
      btn.setAttribute("aria-current", "page");
    }
    group.appendChild(btn);
  }

  var themes = document.getElementById("themesNavLink");
  var ruby = document.getElementById("rubyToggle");
  var anchor = themes || ruby;
  if (anchor && anchor.nextSibling) {
    row.insertBefore(group, anchor.nextSibling);
  } else if (anchor) {
    row.appendChild(group);
  } else {
    row.appendChild(group);
  }
}

var ANSWER_SHOW_KEY = "kakomon.answerShow.v2";

function isAnswerShowOn() {
  try {
    /* 未設定は表示（デフォルトON）。明示的に "0" のときだけ非表示 */
    return localStorage.getItem(ANSWER_SHOW_KEY) !== "0";
  } catch (err) {
    return true;
  }
}

function setAnswerShowOn(on) {
  try {
    localStorage.setItem(ANSWER_SHOW_KEY, on ? "1" : "0");
  } catch (err) {
    /* ignore */
  }
  if (document.body) {
    document.body.classList.toggle("answer-show-on", !!on);
  }
  var btn = document.getElementById("answerShowToggle");
  if (btn) {
    /* 表示は次に行くモード名: インプット中→「アウトプット」、アウトプット中→「インプット」 */
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "アウトプット" : "インプット";
    btn.setAttribute(
      "aria-label",
      on ? "アウトプットモードにする" : "インプットモードにする"
    );
  }
  applyAnswerShowToAllCards();
}

function wireAnswerShowToggle() {
  var row = ensureHeaderToolRow();
  if (!row) {
    setAnswerShowOn(isAnswerShowOn());
    return;
  }
  if (document.getElementById("answerShowToggle")) {
    setAnswerShowOn(isAnswerShowOn());
    return;
  }
  var btn = document.createElement("button");
  btn.type = "button";
  btn.id = "answerShowToggle";
  btn.className = "ruby-toggle answer-show-toggle";
  /* 読む → 全表示 → ルビ の順になるよう先頭へ */
  row.insertBefore(btn, row.firstChild);
  setAnswerShowOn(isAnswerShowOn());
  btn.addEventListener("click", function () {
    setAnswerShowOn(!isAnswerShowOn());
  });
}

var explainAllOn = false;

function isExplainAllOn() {
  return !!explainAllOn;
}

function setExplainAllOn(on) {
  explainAllOn = !!on;
  if (document.body) {
    document.body.classList.toggle("explain-all-on", explainAllOn);
  }
  var btn = document.getElementById("explainAllToggle");
  if (btn) {
    btn.setAttribute("aria-pressed", explainAllOn ? "true" : "false");
    btn.textContent = "全表示";
    btn.setAttribute(
      "aria-label",
      explainAllOn ? "すべての解説を閉じる" : "すべての解説を表示する"
    );
  }
  applyExplainAllToAllCards();
}

function wireExplainAllToggle() {
  var row = ensureHeaderToolRow();
  if (!row) {
    setExplainAllOn(isExplainAllOn());
    return;
  }
  if (document.getElementById("explainAllToggle")) {
    setExplainAllOn(isExplainAllOn());
    return;
  }
  var btn = document.createElement("button");
  btn.type = "button";
  btn.id = "explainAllToggle";
  btn.className = "ruby-toggle explain-all-toggle";
  /* 読む → 全表示 → ルビ の順 */
  var ruby = document.getElementById("rubyToggle");
  if (ruby) {
    row.insertBefore(btn, ruby);
  } else {
    row.appendChild(btn);
  }
  setExplainAllOn(false);
  btn.addEventListener("click", function () {
    setExplainAllOn(!isExplainAllOn());
  });
}

function wireHeaderChrome() {
  ensureHeaderToolRow();
  ensureExamCountdown();
  wireAnswerShowToggle();
  wireExplainAllToggle();
  wireRubyToggle();
  wireQuickNavLinks();
  wireThemesNavLink();
}

function wireBackToTop() {
  var btn = document.getElementById("backToTop");
  if (!btn) return;
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
        if (!btn.classList.contains("is-visible")) btn.hidden = true;
      }, 200);
    }
  }
  window.addEventListener("scroll", function () {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }, { passive: true });
  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  update();
}

function loadRubyThen(next) {
  var bust = "_t=" + Date.now();
  fetch("ruby.json?" + bust)
    .then(function (res) { return res.ok ? res.json() : []; })
    .catch(function () { return []; })
    .then(function (rubyWords) {
      if (Array.isArray(rubyWords) && rubyWords.length) {
        applyVocabularyWords(rubyWords.map(normalizeWordItem));
      }
      next();
    });
}

/* 番号と見出しのあいだの全角スペースを半角にして詰める（1　理念 → 1 理念） */
function tightenThemeIndexSpacing(text) {
  return String(text || "").replace(/(\d)\u3000/g, "$1 ");
}

/* 「科目（下位テーマ）」を親／子に分ける。分かれない場合は null */
function splitThemeHierarchyTitle(text) {
  var raw = tightenThemeIndexSpacing(text);
  var m = raw.match(/^(.+?)（(.+)）$/);
  if (!m) {
    return null;
  }
  var parent = String(m[1] || "").trim();
  var child = String(m[2] || "").trim();
  if (!parent || !child) {
    return null;
  }
  return { parent: parent, child: child };
}

function fillThemeHierarchyTitle(el, text) {
  var parts = splitThemeHierarchyTitle(text);
  el.textContent = "";
  if (!parts) {
    fillWithRuby(el, tightenThemeIndexSpacing(text));
    return;
  }
  el.classList.add("has-theme-hierarchy");
  var parent = document.createElement("span");
  parent.className = "theme-title-parent";
  fillWithRuby(parent, parts.parent);
  el.appendChild(parent);
  var child = document.createElement("span");
  child.className = "theme-title-child";
  fillWithRuby(child, "（" + parts.child + "）");
  el.appendChild(child);
}

var THEME_INDEX_RESTORE_KEY = "theme-index-restore";

function themeCardDomId(slug) {
  return "theme-card-" + String(slug || "").replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function saveThemeIndexRestore(slug, groupKey) {
  if (!slug) {
    return;
  }
  try {
    sessionStorage.setItem(
      THEME_INDEX_RESTORE_KEY,
      JSON.stringify({
        path: location.pathname,
        slug: String(slug),
        groupKey: groupKey ? String(groupKey) : ""
      })
    );
  } catch (err) {
    /* ignore */
  }
}

function consumeThemeIndexRestore() {
  try {
    var raw = sessionStorage.getItem(THEME_INDEX_RESTORE_KEY);
    if (!raw) {
      return null;
    }
    var data = JSON.parse(raw);
    if (!data || data.path !== location.pathname) {
      return null;
    }
    sessionStorage.removeItem(THEME_INDEX_RESTORE_KEY);
    return data;
  } catch (err) {
    return null;
  }
}

function openThemeGroupSection(section) {
  if (!section) {
    return;
  }
  var toggle = section.querySelector(".theme-group-toggle");
  var list = section.querySelector(".theme-group-list");
  section.classList.add("is-open");
  if (toggle) {
    toggle.setAttribute("aria-expanded", "true");
  }
  if (list) {
    list.hidden = false;
  }
}

/* 詳細からブラウザバックしたとき、開いていたテーマ位置へ戻す */
function restoreThemeIndexPosition() {
  var data = consumeThemeIndexRestore();
  if (!data || !data.slug) {
    return;
  }
  var card = document.getElementById(themeCardDomId(data.slug));
  if (!card) {
    return;
  }
  var section = card.closest(".theme-group");
  if (section) {
    openThemeGroupSection(section);
  }
  window.requestAnimationFrame(function () {
    card.classList.add("is-restore-focus");
    try {
      card.focus({ preventScroll: true });
    } catch (err) {
      try {
        card.focus();
      } catch (err2) {
        /* ignore */
      }
    }
    if (card.scrollIntoView) {
      card.scrollIntoView({ block: "center", behavior: "auto" });
    }
    window.setTimeout(function () {
      card.classList.remove("is-restore-focus");
    }, 1800);
  });
}

function fillQuestionCountMeta(el, n) {
  el.textContent = "";
  var num = document.createElement("span");
  num.className = "theme-count-num";
  num.textContent = String(n);
  var unit = document.createElement("span");
  unit.className = "theme-count-unit";
  unit.textContent = "問";
  el.appendChild(num);
  el.appendChild(unit);
}

function themeDisplayLabel(item) {
  if (item.label) return item.label;
  var title = item.title || "";
  if (item.points != null && item.points !== "") {
    return title + "（" + item.points + "）";
  }
  return title;
}

function appendThemeCard(parent, t, groupKey) {
  var a = document.createElement("a");
  a.className = "theme-card";
  a.href = t.href || ("view.html?t=" + encodeURIComponent(t.slug));
  if (t.slug) {
    a.id = themeCardDomId(t.slug);
    a.setAttribute("data-theme-slug", t.slug);
  }
  a.addEventListener("click", function () {
    saveThemeIndexRestore(t.slug, groupKey || "");
  });
  var title = document.createElement("h3");
  title.className = "theme-card-title";
  fillWithRuby(title, tightenThemeIndexSpacing(themeDisplayLabel(t)));
  a.appendChild(title);
  var meta = document.createElement("p");
  meta.className = "theme-card-meta";
  var shown = t.displayCount != null ? t.displayCount : t.count || 0;
  fillQuestionCountMeta(meta, shown);
  var onAppendix = location.pathname.indexOf("/appendix/") !== -1;
  // 参考テーマなど cardLow 指定のみ灰色（問数不足では灰色にしない）
  if (!onAppendix && t.cardLow) a.classList.add("theme-card-low");
  a.appendChild(meta);
  parent.appendChild(a);
}

var BANK_BLOCK_LABELS = {
  生活支援技術: "介護",
  こころとからだのしくみ: "医療",
  社会の理解: "社会"
};

function appendBankBlockLabel(root, text, withBreak) {
  var el = document.createElement("p");
  el.className =
    "theme-block-label" + (withBreak ? " theme-block-label-break" : "");
  fillWithRuby(el, text);
  root.appendChild(el);
}

function appendThemeGroup(root, group) {
  var title = group.title || "テーマ";
  var displayTitle = themeDisplayLabel(group) || title;
  var groupKey = group.id || title;
  /* リロード・ページ遷移では閉じた状態から（開閉は画面内のみ） */
  var open = false;
  var children = group.themes || [];
  var qN = group.displayCount != null ? group.displayCount : group.count || 0;
  var panelId = "theme-group-panel-" + String(groupKey).replace(/\s+/g, "-");

  var section = document.createElement("section");
  section.className = "theme-group" + (open ? " is-open" : "");
  section.setAttribute("aria-label", displayTitle);
  section.setAttribute("data-group-key", String(groupKey));

  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "theme-group-toggle";
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.setAttribute("aria-controls", panelId);

  var chevron = document.createElement("span");
  chevron.className = "theme-group-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";
  toggle.appendChild(chevron);

  var textWrap = document.createElement("span");
  textWrap.className = "theme-group-toggle-text";
  var h2 = document.createElement("span");
  h2.className = "theme-group-title";
  fillWithRuby(h2, displayTitle);
  textWrap.appendChild(h2);
  var gmeta = document.createElement("span");
  gmeta.className = "theme-group-meta";
  fillQuestionCountMeta(gmeta, qN);
  textWrap.appendChild(gmeta);
  toggle.appendChild(textWrap);
  section.appendChild(toggle);

  var list = document.createElement("div");
  list.className = "theme-group-list";
  list.id = panelId;
  list.hidden = !open;
  for (var i = 0; i < children.length; i++) {
    appendThemeCard(list, children[i], groupKey);
  }
  section.appendChild(list);

  toggle.addEventListener("click", function () {
    var next = !section.classList.contains("is-open");
    section.classList.toggle("is-open", next);
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
    list.hidden = !next;
  });

  root.appendChild(section);
}

var THEMES_KORYAKU_MAPS = {
  jiritsuVs: {
    href: "hikaku-jiritsu-vs.html",
    title: "国試を解くための比較表"
  },
  jiritsu: {
    href: "hikaku-jiritsu.html",
    title: "国試で◯になる選択肢"
  },
  jiritsuNg: {
    href: "hikaku-jiritsu-ng.html",
    title: "国試で✕になる選択肢"
  },
  kaigoShogai: {
    href: "hikaku-kaigo-shogai.html",
    title: "介護保険法・障害者総合支援法攻略マップ"
  },
  kaigoKatei: {
    href: "hikaku-kaigo-katei.html",
    title: "介護過程攻略マップ"
  },
  icf: {
    href: "hikaku-icf.html",
    title: "ICF（国際生活機能分類）攻略マップ"
  },
  jinbutsu: {
    href: "hikaku-jinbutsu.html",
    title: "福祉の関連人物攻略マップ"
  }
};

function appendKoryakuIndexCards(parent, mapKeys) {
  var keys = mapKeys || [
    "kaigoShogai",
    "icf",
    "jinbutsu",
    "jiritsuVs",
    "jiritsu",
    "jiritsuNg"
  ];
  for (var i = 0; i < keys.length; i++) {
    var item = THEMES_KORYAKU_MAPS[keys[i]];
    if (!item) {
      continue;
    }
    var card = document.createElement("a");
    card.className = "theme-card";
    card.href = item.href;
    var title = document.createElement("h3");
    title.className = "theme-card-title";
    fillWithRuby(title, item.title);
    card.appendChild(title);
    parent.appendChild(card);
  }
}

function findUngroupedTheme(ungrouped, title) {
  for (var i = 0; i < ungrouped.length; i++) {
    if ((ungrouped[i].title || "") === title) {
      return ungrouped[i];
    }
  }
  return null;
}

function findThemeGroup(groups, title) {
  for (var i = 0; i < groups.length; i++) {
    if ((groups[i].title || "") === title) {
      return groups[i];
    }
  }
  return null;
}

function renderThemeIndex(payload) {
  var root = document.getElementById("themeList");
  root.textContent = "";
  var themes = (payload && payload.themes) || [];
  var groups = (payload && payload.groups) || [];
  var ungrouped = (payload && payload.ungrouped) || [];
  if (!themes.length && !groups.length) {
    showHint("テーマがまだありません。work/theme_extract に .txt ファイルを置いてデプロイしてください。");
    setStatus("");
    return;
  }
  setStatus("");

  var onThemes =
    location.pathname.indexOf("/themes/") !== -1 ||
    /\/themes\/?$/.test(location.pathname);
  var onBank = location.pathname.indexOf("/bank/") !== -1;

  /* テーマ: 先頭にテキスト、その後は指定カテゴリ・指定順（優先して理解する問題は一覧に出さない） */
  if (onThemes && (groups.length || ungrouped.length || themes.length)) {
    var textTheme = findUngroupedTheme(ungrouped, "テキスト");
    if (!textTheme) {
      for (var ti = 0; ti < themes.length; ti++) {
        if ((themes[ti].title || "") === "テキスト") {
          textTheme = themes[ti];
          break;
        }
      }
    }
    if (textTheme) {
      appendThemeCard(root, textTheme, "");
    }
    /* グループ未所属の追加テーマ（テキスト／優先して理解する問題以外） */
    for (var uiExtra = 0; uiExtra < ungrouped.length; uiExtra++) {
      var extraTheme = ungrouped[uiExtra];
      var extraTitle = (extraTheme && extraTheme.title) || "";
      if (
        extraTitle === "テキスト" ||
        extraTitle === "優先して理解する問題"
      ) {
        continue;
      }
      appendThemeCard(root, extraTheme, "");
    }
    var gensokuGroup = findThemeGroup(groups, "原則");
    if (gensokuGroup) {
      appendThemeGroup(root, gensokuGroup);
    }
    appendKoryakuIndexCards(root, ["jiritsuVs"]);
    var jiritsuGroup = findThemeGroup(groups, "利用者主体・自立支援");
    if (jiritsuGroup) {
      appendThemeGroup(root, jiritsuGroup);
    }
    appendKoryakuIndexCards(root, [
      "kaigoShogai",
      "kaigoKatei",
      "icf",
      "jinbutsu",
      "jiritsu",
      "jiritsuNg"
    ]);
    var houritsuGroup = findThemeGroup(groups, "法律");
    if (houritsuGroup) {
      appendThemeGroup(root, houritsuGroup);
    }
    /* theme_extract のその他グループ（上記以外）も一覧に出す */
    var shownGroupTitles = {
      "原則": true,
      "利用者主体・自立支援": true,
      "法律": true
    };
    for (var giExtra = 0; giExtra < groups.length; giExtra++) {
      var gExtra = groups[giExtra];
      var gTitle = (gExtra && gExtra.title) || "";
      if (shownGroupTitles[gTitle]) {
        continue;
      }
      appendThemeGroup(root, gExtra);
    }
    restoreThemeIndexPosition();
    return;
  }

  if (groups.length || ungrouped.length) {
    for (var gi = 0; gi < groups.length; gi++) {
      var groupTitle = groups[gi].title || "";
      if (onBank && BANK_BLOCK_LABELS[groupTitle]) {
        appendBankBlockLabel(
          root,
          BANK_BLOCK_LABELS[groupTitle],
          groupTitle !== "生活支援技術"
        );
      }
      appendThemeGroup(root, groups[gi]);
    }
    if (ungrouped.length) {
      var flat = document.createElement("div");
      flat.className = "theme-ungrouped";
      flat.setAttribute("aria-label", "その他のテーマ");
      for (var ui = 0; ui < ungrouped.length; ui++) {
        appendThemeCard(flat, ungrouped[ui], "");
      }
      root.appendChild(flat);
    }
    restoreThemeIndexPosition();
    return;
  }

  if (onThemes) {
    appendKoryakuIndexCards(root);
  }
  for (var j = 0; j < themes.length; j++) {
    appendThemeCard(root, themes[j], "");
  }
  restoreThemeIndexPosition();
}

var THEME_RECENT_SESSION_MIN = 34;
var THEME_RECENT_SESSION_MAX = 38;

function partitionThemeQuestions(questions, recentMin, recentMax, showAllInOrder) {
  var list = questions || [];
  /* 同じ問題など: txt の並びのまま全件表示 */
  if (showAllInOrder) {
    return { initial: list.slice(), older: [] };
  }
  var min = recentMin != null ? Number(recentMin) : THEME_RECENT_SESSION_MIN;
  var max = recentMax != null ? Number(recentMax) : THEME_RECENT_SESSION_MAX;
  var recent = [];
  var older = [];
  for (var i = 0; i < list.length; i++) {
    var q = list[i];
    var round = Number(q && q.round);
    if (!isNaN(round) && round >= min && round <= max) {
      recent.push(q);
    } else {
      older.push(q);
    }
  }
  if (!recent.length) {
    return { initial: list.slice(), older: [] };
  }
  return { initial: recent, older: older };
}

function appendQuestions(questions) {
  var root = document.getElementById("questionList");
  if (!root || !questions || !questions.length) {
    return;
  }
  for (var i = 0; i < questions.length; i++) {
    appendQuestionCard(root, questions[i]);
  }
}

function renderThemeMoreButton(olderQuestions, displayCount) {
  var existing = document.getElementById("themeMoreWrap");
  if (existing) {
    existing.remove();
  }
  if (!olderQuestions || !olderQuestions.length) {
    return;
  }

  var main = document.getElementById("questionList");
  if (!main || !main.parentNode) {
    return;
  }

  var wrap = document.createElement("div");
  wrap.id = "themeMoreWrap";
  wrap.className = "theme-more-wrap";

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "theme-more-btn";
  btn.textContent = "あと5年分見る（" + olderQuestions.length + "問）";
  btn.addEventListener("click", function () {
    appendQuestions(olderQuestions);
    wrap.remove();
    setStatus(displayCount + " 問");
  });
  wrap.appendChild(btn);
  main.parentNode.insertBefore(wrap, main.nextSibling);
}

function getSiteIndexTitle() {
  var body = document.body;
  if (body && body.getAttribute("data-index-title")) {
    return body.getAttribute("data-index-title");
  }
  var h1 = document.querySelector(".page-header h1");
  if (h1 && h1.textContent.trim()) {
    return h1.textContent.trim();
  }
  return "テーマ";
}

function applySiteBrandRuby() {
  var brand = document.querySelector(".site-brand");
  if (!brand) return;
  var label = "介護福祉士国家試験対策";
  var href = "/kaigo/kakomon/themes/view.html?t=b146eeffd742";
  if (brand.tagName !== "A") {
    var link = document.createElement("a");
    link.className = brand.className;
    brand.parentNode.replaceChild(link, brand);
    brand = link;
  }
  brand.href = href;
  brand.setAttribute("aria-label", label);
  /* 1行目はルビなし。狭い画面でも省略せず全文を出す */
  brand.textContent = label;
}

function bootIndex() {
  wireSiteNav();
  wireHeaderChrome();
  wireRubyFitRefresh();
  wireBackToTop();
  setStatus("読み込み中…");
  loadRubyThen(function () {
    applySiteBrandRuby();
    var h1 = document.querySelector(".page-header h1");
    if (h1) fillWithRuby(h1, getSiteIndexTitle());
    fetch("index.json?_t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("index.json の読み込みに失敗しました");
        return res.json();
      })
      .then(renderThemeIndex)
      .catch(function (err) {
        showError(err && err.message ? err.message : "読み込みに失敗しました");
      });
  });
}

function getThemeSlugFromUrl() {
  try {
    var params = new URLSearchParams(window.location.search);
    return String(params.get("t") || "").trim();
  } catch (e) {
    return "";
  }
}

function bootView() {
  wireSiteNav();
  wireHeaderChrome();
  wireRubyFitRefresh();
  wireBackToTop();
  setStatus("読み込み中…");
  var slug = getThemeSlugFromUrl();
  if (!slug) {
    showError("テーマが指定されていません。一覧から選んでください。");
    return;
  }
  var bust = "_t=" + Date.now();
  var rubyPromise = fetch("ruby.json?" + bust)
    .then(function (res) {
      return res.ok ? res.json() : [];
    })
    .catch(function () {
      return [];
    });
  var dataPromise = fetch(
    "data/" + encodeURIComponent(slug) + ".json?" + bust
  ).then(function (res) {
    if (!res.ok) throw new Error("テーマデータの読み込みに失敗しました");
    return res.json();
  });
  Promise.all([rubyPromise, dataPromise])
    .then(function (pair) {
      var rubyWords = pair[0];
      var payload = pair[1];
      if (Array.isArray(rubyWords) && rubyWords.length) {
        applyVocabularyWords(rubyWords.map(normalizeWordItem));
      }
      applySiteBrandRuby();
      var title = tightenThemeIndexSpacing(payload.title || "テーマ");
      document.title = title;
      var h1 = document.getElementById("themeTitle");
      if (h1) {
        h1.classList.remove("has-theme-hierarchy");
        fillThemeHierarchyTitle(h1, title);
      }
      var questions = payload.questions || [];
      if (title === "テキスト") {
        textThemeAllQuestions = questions.slice();
        textThemeLeadTheme = payload.leadTheme || null;
        ensureTextThemeSearchPanel();
        setStatus(questions.length + " 問");
        setActiveHighlightTerms([]);
        renderTextThemeBySubject(questions, { forceOpen: false });
        renderThemeMoreButton([], questions.length);
        if (payload.missing && payload.missing.length) {
          console.warn("欠番", payload.missing);
        }
        return;
      }
      var parts = partitionThemeQuestions(
        questions,
        payload.recentSessionMin,
        payload.recentSessionMax,
        !!payload.showAllInOrder
      );
      var displayCount =
        payload.displayCount != null
          ? payload.displayCount
          : parts.initial.length;
      setStatus(displayCount + " 問");
      setActiveHighlightTerms([]);
      renderQuestions(parts.initial);
      renderThemeMoreButton(parts.older, displayCount);
      if (payload.missing && payload.missing.length) {
        console.warn("欠番", payload.missing);
      }
    })
    .catch(function (err) {
      showError(err && err.message ? err.message : "読み込みに失敗しました");
    });
}

function getKoryakuPageConfig() {
  var body = document.body;
  return {
    key: (body && body.getAttribute("data-koryaku-key")) || "kaigo-hoken",
    title:
      (body && body.getAttribute("data-koryaku-title")) || "介護保険法攻略",
    json:
      (body && body.getAttribute("data-koryaku-json")) ||
      "data/koryaku-kaigo-hoken.json"
  };
}

function appendKoryakuCard(parent, item) {
  if (item && item.missing) {
    var missing = document.createElement("article");
    missing.className = "koryaku-card is-missing";
    var mid = document.createElement("p");
    mid.className = "koryaku-id";
    mid.textContent = "【" + (item.id || "") + "】";
    missing.appendChild(mid);
    var mp = document.createElement("p");
    mp.textContent = "問題データなし";
    missing.appendChild(mp);
    parent.appendChild(missing);
    return;
  }

  var card = document.createElement("article");
  card.className = "koryaku-card is-tappable";
  card.setAttribute("role", "button");
  card.setAttribute("aria-expanded", "false");
  card.tabIndex = 0;

  var idRow = document.createElement("p");
  idRow.className = "koryaku-id";
  var idLink = document.createElement("a");
  idLink.className = "koryaku-id-link";
  idLink.href = item.href || "#";
  fillWithRuby(
    idLink,
    "【" + item.id + "｜" + (item.subject || "") + "】"
  );
  idLink.addEventListener("click", function (ev) {
    ev.stopPropagation();
  });
  idRow.appendChild(idLink);
  card.appendChild(idRow);

  var bodyWrap = document.createElement("div");
  bodyWrap.className = "koryaku-problem";
  var parts = item.body || [];
  for (var i = 0; i < parts.length; i++) {
    var p = document.createElement("p");
    p.className = "koryaku-problem-p";
    fillWithRuby(p, parts[i]);
    bodyWrap.appendChild(p);
  }
  card.appendChild(bodyWrap);

  // 注釈は問題側（重要テーマと同じ）。◯解説には混ぜない。
  if (item.note) {
    var note = document.createElement("p");
    note.className = "koryaku-note";
    fillWithRuby(note, item.note);
    card.appendChild(note);
  }

  var ans = document.createElement("div");
  ans.className = "koryaku-answer";
  var ansMain = document.createElement("div");
  ansMain.className = "koryaku-answer-main";
  var ansLabel = document.createElement("span");
  ansLabel.className = "koryaku-answer-label";
  fillWithRuby(ansLabel, "正解");
  ansMain.appendChild(ansLabel);
  var ansText = document.createElement("span");
  ansText.className = "koryaku-answer-text";
  fillWithRuby(ansText, item.answer || "");
  ansMain.appendChild(ansText);
  ans.appendChild(ansMain);
  var ansChevron = document.createElement("span");
  ansChevron.className = "koryaku-answer-chevron";
  ansChevron.setAttribute("aria-hidden", "true");
  ansChevron.textContent = "›";
  ans.appendChild(ansChevron);
  card.appendChild(ans);

  var explain = document.createElement("div");
  explain.className = "koryaku-explain";
  explain.hidden = true;
  var exHead = document.createElement("p");
  exHead.className = "koryaku-explain-head";
  fillWithRuby(exHead, "解説");
  explain.appendChild(exHead);
  var exBody = document.createElement("p");
  exBody.className = "koryaku-explain-body";
  fillWithRuby(exBody, item.explain || "解説がありません。");
  explain.appendChild(exBody);
  card.appendChild(explain);

  function toggle() {
    var open = card.classList.toggle("is-open");
    card.setAttribute("aria-expanded", open ? "true" : "false");
    explain.hidden = !open;
  }
  card.addEventListener("click", toggle);
  card.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggle();
    }
  });

  parent.appendChild(card);
}

function ensureKoryakuNowBar() {
  var bar = document.getElementById("koryakuNow");
  if (bar) return bar;
  var main = document.querySelector(".koryaku-main");
  if (!main) return null;
  bar = document.createElement("div");
  bar.id = "koryakuNow";
  bar.className = "koryaku-now";
  bar.hidden = true;
  bar.setAttribute("aria-live", "polite");
  var label = document.createElement("span");
  label.className = "koryaku-now-label";
  fillWithRuby(label, "いま学習中");
  bar.appendChild(label);
  var name = document.createElement("span");
  name.className = "koryaku-now-name";
  name.id = "koryakuNowName";
  bar.appendChild(name);
  main.insertBefore(bar, main.firstChild);
  return bar;
}

function setKoryakuCurrent(sectionEl) {
  var bar = ensureKoryakuNowBar();
  var nameEl = document.getElementById("koryakuNowName");
  var toc = document.getElementById("koryakuToc");
  var links = toc ? toc.querySelectorAll(".koryaku-toc-link") : [];
  for (var i = 0; i < links.length; i++) {
    links[i].classList.remove("is-current");
  }
  if (!sectionEl) {
    if (bar) bar.hidden = true;
    return;
  }
  var theme =
    sectionEl.getAttribute("data-theme") ||
    sectionEl.getAttribute("aria-label") ||
    "";
  if (bar && nameEl) {
    bar.hidden = false;
    fillWithRuby(nameEl, theme);
  }
  var idx = sectionEl.id && sectionEl.id.indexOf("sec-") === 0
    ? sectionEl.id.slice(4)
    : "";
  if (toc && idx) {
    var link = toc.querySelector('.koryaku-toc-link[data-sec="' + idx + '"]');
    if (link) link.classList.add("is-current");
  }
}

function updateKoryakuCurrentFromScroll() {
  var sections = document.querySelectorAll(".koryaku-section.is-open");
  if (!sections.length) {
    setKoryakuCurrent(null);
    return;
  }
  var bar = document.getElementById("koryakuNow");
  var marker = bar && !bar.hidden ? bar.getBoundingClientRect().bottom + 8 : 72;
  var current = null;
  for (var i = 0; i < sections.length; i++) {
    var rect = sections[i].getBoundingClientRect();
    if (rect.top <= marker && rect.bottom > marker + 40) {
      current = sections[i];
    }
  }
  if (!current) {
    // 画面内でいちばん上にある開いたカテゴリー
    for (var j = 0; j < sections.length; j++) {
      var r = sections[j].getBoundingClientRect();
      if (r.bottom > marker) {
        current = sections[j];
        break;
      }
    }
  }
  if (!current) current = sections[sections.length - 1];
  setKoryakuCurrent(current);
}

function wireKoryakuScrollSpy() {
  if (window.__koryakuScrollWired) return;
  window.__koryakuScrollWired = true;
  var ticking = false;
  window.addEventListener(
    "scroll",
    function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        updateKoryakuCurrentFromScroll();
      });
    },
    { passive: true }
  );
}

function appendKoryakuSection(root, section, index) {
  var theme = section.theme || "カテゴリー";
  var items = section.items || [];
  /* リロード・ページ遷移では閉じた状態から（開閉は画面内のみ） */
  var open = false;
  var panelId = "koryaku-panel-" + index;

  var sectionEl = document.createElement("section");
  sectionEl.className = "koryaku-section theme-group" + (open ? " is-open" : "");
  sectionEl.id = "sec-" + index;
  sectionEl.setAttribute("aria-label", theme);
  sectionEl.setAttribute("data-theme", theme);

  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "theme-group-toggle koryaku-section-toggle";
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.setAttribute("aria-controls", panelId);

  var chevron = document.createElement("span");
  chevron.className = "theme-group-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "›";
  toggle.appendChild(chevron);

  var textWrap = document.createElement("span");
  textWrap.className = "theme-group-toggle-text";
  var h2 = document.createElement("span");
  h2.className = "theme-group-title";
  fillWithRuby(h2, theme);
  textWrap.appendChild(h2);
  var gmeta = document.createElement("span");
  gmeta.className = "theme-group-meta";
  fillQuestionCountMeta(gmeta, items.length);
  textWrap.appendChild(gmeta);
  toggle.appendChild(textWrap);
  sectionEl.appendChild(toggle);

  var list = document.createElement("div");
  list.className = "koryaku-cards";
  list.id = panelId;
  list.hidden = !open;
  for (var i = 0; i < items.length; i++) {
    appendKoryakuCard(list, items[i]);
  }
  sectionEl.appendChild(list);

  toggle.addEventListener("click", function () {
    var next = !sectionEl.classList.contains("is-open");
    sectionEl.classList.toggle("is-open", next);
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
    list.hidden = !next;
    if (next) {
      setKoryakuCurrent(sectionEl);
    } else {
      updateKoryakuCurrentFromScroll();
    }
  });

  root.appendChild(sectionEl);
}

function renderKoryaku(payload) {
  var body = document.getElementById("koryakuBody");
  if (!body) return;
  ensureKoryakuNowBar();
  body.textContent = "";
  var sections = (payload && payload.sections) || [];
  var total = payload && payload.count != null ? payload.count : 0;
  setStatus("正解マップ · 全 " + total + " 問");

  if (!sections.length) {
    var empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "データがありません。";
    body.appendChild(empty);
    setKoryakuCurrent(null);
    return;
  }

  for (var i = 0; i < sections.length; i++) {
    appendKoryakuSection(body, sections[i], i + 1);
  }

  markVocabGlossTerms(body);
  activateVocabGlossIfRubyOn();
  wireKoryakuScrollSpy();
  updateKoryakuCurrentFromScroll();
}

function bootKoryaku() {
  wireSiteNav();
  wireHeaderChrome();
  wireRubyFitRefresh();
  wireBackToTop();
  setStatus("読み込み中…");
  var cfg = getKoryakuPageConfig();
  loadRubyThen(function () {
    applySiteBrandRuby();
    var h1 = document.querySelector(".page-header h1");
    if (h1) fillWithRuby(h1, cfg.title);
    fetch(cfg.json + "?_t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("攻略データの読み込みに失敗しました");
        return res.json();
      })
      .then(renderKoryaku)
      .catch(function (err) {
        var body = document.getElementById("koryakuBody");
        if (body) {
          body.textContent = "";
          var p = document.createElement("p");
          p.className = "error";
          p.textContent = err && err.message ? err.message : "読み込みに失敗しました";
          body.appendChild(p);
        }
      });
  });
}

/* 既存 DOM のテキストノードに語彙ルビを付与（比較表の strong / br を壊さない） */
function applyRubyToTextNodes(root) {
  if (!root) {
    return;
  }
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      var p = node.parentNode;
      if (!p || !p.closest) {
        return NodeFilter.FILTER_REJECT;
      }
      if (
        p.closest("ruby") ||
        p.closest(".vocab-ruby-run") ||
        p.closest(".ruby-pair") ||
        p.closest(".hikaku-qid") ||
        p.closest("button")
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  var nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var text = node.nodeValue;
    if (!text || !/\S/.test(text)) {
      continue;
    }
    var parent = node.parentNode;
    if (!parent) {
      continue;
    }
    var wrap = document.createElement("span");
    appendTextWithVocabularyRuby(wrap, stripRubySpacerSpaces(text));
    while (wrap.firstChild) {
      parent.insertBefore(wrap.firstChild, node);
    }
    parent.removeChild(node);
  }
  scheduleFitRubyIn(root);
}

var hikakuQuestionIndex = null;

function appendHikakuQuestionCard(parent, item) {
  if (!item || item.missing) {
    var missing = document.createElement("article");
    missing.className = "koryaku-card is-missing";
    var mid = document.createElement("p");
    mid.className = "koryaku-id";
    mid.textContent = "【" + ((item && item.id) || "") + "】";
    missing.appendChild(mid);
    var mp = document.createElement("p");
    mp.textContent = "この比較表用データに問題がありません。";
    missing.appendChild(mp);
    parent.appendChild(missing);
    return null;
  }
  var parts = String(item.id || "").split("-");
  var q = {
    id: item.id,
    round: item.round != null ? item.round : parts[0],
    number: item.number != null ? item.number : parts[1],
    subject: item.subject || "",
    body: item.body || [],
    choices: item.choices || [],
    answers: item.answers || [],
    explains: item.explains || {},
    note: item.note || "",
    figures: item.figures || [],
    choiceFigures: item.choiceFigures || {}
  };
  if (item.qb != null && item.qb !== "") {
    q.qb = item.qb;
  } else if (Number(q.round) === 38) {
    q.qb = "528〜";
  }
  return appendQuestionCard(parent, q);
}

function closeHikakuModal() {
  var modal = document.getElementById("hikakuModal");
  if (!modal) {
    return;
  }
  modal.hidden = true;
  document.body.classList.remove("hikaku-modal-open");
  var body = document.getElementById("hikakuModalBody");
  if (body) {
    body.textContent = "";
  }
}

function openHikakuModal(qid) {
  var modal = document.getElementById("hikakuModal");
  var body = document.getElementById("hikakuModalBody");
  var title = document.getElementById("hikakuModalTitle");
  if (!modal || !body) {
    return;
  }
  body.textContent = "";
  var item =
    hikakuQuestionIndex && hikakuQuestionIndex[qid]
      ? hikakuQuestionIndex[qid]
      : { id: qid, missing: true };
  if (title) {
    fillWithRuby(title, "【" + qid + "】");
  }
  appendHikakuQuestionCard(body, item);
  modal.hidden = false;
  document.body.classList.add("hikaku-modal-open");
  body.scrollTop = 0;
  var closeBtn = modal.querySelector(".hikaku-modal-close");
  if (closeBtn) {
    closeBtn.focus();
  }
}

function wireHikakuModal() {
  var modal = document.getElementById("hikakuModal");
  if (!modal) {
    return;
  }
  modal.addEventListener("click", function (ev) {
    var t = ev.target;
    if (t && t.getAttribute && t.getAttribute("data-hikaku-close") != null) {
      closeHikakuModal();
    }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && modal && !modal.hidden) {
      closeHikakuModal();
    }
  });
  var main = document.querySelector(".hikaku-main");
  if (main) {
    main.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest(".hikaku-qid") : null;
      if (!btn) {
        return;
      }
      ev.preventDefault();
      var round = btn.getAttribute("data-round");
      var number = btn.getAttribute("data-number");
      if (!round || !number) {
        return;
      }
      openHikakuModal(String(round) + "-" + String(number));
    });
  }
}

function wireJiritsuMoreToggles() {
  var buttons = document.querySelectorAll(".jiritsu-more-toggle");
  for (var i = 0; i < buttons.length; i++) {
    (function (btn) {
      if (btn.getAttribute("data-wired") === "1") {
        return;
      }
      btn.setAttribute("data-wired", "1");
      var count = Number(btn.getAttribute("data-more-count") || 0) || 0;
      var labelClosed = "QB以外を見る（" + count + "）";
      var labelOpen = "QB以外を閉じる";
      function setToggleLabel(open) {
        btn.textContent = "";
        var chev = document.createElement("span");
        chev.className = "jiritsu-more-chevron";
        chev.setAttribute("aria-hidden", "true");
        chev.textContent = open ? "▾" : "▸";
        btn.appendChild(chev);
        btn.appendChild(document.createTextNode(open ? labelOpen : labelClosed));
      }
      btn.addEventListener("click", function () {
        var wrap = btn.closest(".jiritsu-more");
        if (!wrap) {
          return;
        }
        var body = wrap.querySelector(".jiritsu-more-body");
        var open = btn.getAttribute("aria-expanded") === "true";
        var next = !open;
        btn.setAttribute("aria-expanded", next ? "true" : "false");
        if (body) {
          body.hidden = !next;
        }
        wrap.classList.toggle("is-open", next);
        setToggleLabel(next);
      });
    })(buttons[i]);
  }
}

function bootHikaku() {
  wireSiteNav();
  wireHeaderChrome();
  wireRubyFitRefresh();
  wireBackToTop();
  wireHikakuModal();
  wireJiritsuMoreToggles();
  loadRubyThen(function () {
    applySiteBrandRuby();
    var h1 = document.querySelector(".page-header h1");
    if (h1) {
      fillWithRuby(h1, h1.textContent || "");
    }
    var status = document.querySelector(".page-header .search-status");
    if (status) {
      fillWithRuby(status, status.textContent || "");
    }
    applyRubyToTextNodes(document.querySelector(".hikaku-main"));
    markVocabGlossTerms(document.querySelector(".hikaku-main"));
    activateVocabGlossIfRubyOn();
    var hikakuJson =
      (document.body && document.body.getAttribute("data-hikaku-json")) ||
      "data/hikaku-kaigo-shogai.json";
    fetch(hikakuJson + (hikakuJson.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now())
      .then(function (res) {
        if (!res.ok) {
          throw new Error("比較表データの読み込みに失敗しました");
        }
        return res.json();
      })
      .then(function (payload) {
        hikakuQuestionIndex = (payload && payload.items) || {};
      })
      .catch(function () {
        hikakuQuestionIndex = {};
      });
  });
}

function shuffleCopy(list) {
  var out = list.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function bootJiritsuCards() {
  wireSiteNav();
  wireHeaderChrome();
  wireRubyFitRefresh();
  wireBackToTop();
  wireHikakuModal();

  var qbSelect = document.getElementById("jiritsuCardsQb");
  var catSelect = document.getElementById("jiritsuCardsCategory");
  var kindSelect = document.getElementById("jiritsuCardsKind");
  var shuffleToggle = document.getElementById("jiritsuCardsShuffle");
  var progressEl = document.getElementById("jiritsuCardsProgress");
  var cardEl = document.getElementById("jiritsuCard");
  var revealBtn = document.getElementById("jiritsuCardReveal");
  var markEl = document.getElementById("jiritsuCardMark");
  var bodyEl = document.getElementById("jiritsuCardBody");
  var qidBtn = document.getElementById("jiritsuCardQid");
  var emptyEl = document.getElementById("jiritsuCardsEmpty");
  var prevBtn = document.getElementById("jiritsuCardsPrev");
  var nextBtn = document.getElementById("jiritsuCardsNext");

  var state = {
    all: [],
    deck: [],
    index: 0,
    revealed: false
  };

  function fillCategories(categories) {
    if (!catSelect) {
      return;
    }
    while (catSelect.options.length > 1) {
      catSelect.remove(1);
    }
    for (var i = 0; i < categories.length; i++) {
      var opt = document.createElement("option");
      opt.value = categories[i];
      opt.textContent = categories[i];
      catSelect.appendChild(opt);
    }
  }

  function rebuildDeck() {
    var qbMode = qbSelect ? qbSelect.value : "qb";
    var kindMode = kindSelect ? kindSelect.value : "all";
    var cat = catSelect ? catSelect.value : "";
    var filtered = [];
    for (var i = 0; i < state.all.length; i++) {
      var card = state.all[i];
      if (qbMode === "qb" && !card.inQb) {
        continue;
      }
      if (kindMode === "ok" && card.kind !== "ok") {
        continue;
      }
      if (kindMode === "ng" && card.kind !== "ng") {
        continue;
      }
      if (cat && card.category !== cat) {
        continue;
      }
      filtered.push(card);
    }
    if (shuffleToggle && shuffleToggle.checked) {
      state.deck = shuffleCopy(filtered);
    } else {
      state.deck = filtered;
    }
    state.index = 0;
    state.revealed = false;
    renderCard();
  }

  function currentCard() {
    if (!state.deck.length) {
      return null;
    }
    return state.deck[state.index] || null;
  }

  function renderCard() {
    var card = currentCard();
    if (!card) {
      if (cardEl) {
        cardEl.hidden = true;
      }
      if (emptyEl) {
        emptyEl.hidden = false;
      }
      if (progressEl) {
        progressEl.textContent = "0 / 0";
      }
      if (prevBtn) {
        prevBtn.disabled = true;
      }
      if (nextBtn) {
        nextBtn.disabled = true;
      }
      return;
    }
    if (emptyEl) {
      emptyEl.hidden = true;
    }
    if (cardEl) {
      cardEl.hidden = false;
    }
    if (progressEl) {
      progressEl.textContent = state.index + 1 + " / " + state.deck.length;
    }
    if (bodyEl) {
      bodyEl.textContent = "";
      fillWithRuby(bodyEl, card.text || "");
    }
    var isOk = card.kind === "ok";
    if (markEl) {
      markEl.hidden = !state.revealed;
      markEl.textContent = isOk ? "◯" : "✕";
      markEl.className =
        "jiritsu-card-mark " +
        (isOk ? "jiritsu-card-mark--ok" : "jiritsu-card-mark--ng");
    }
    if (qidBtn) {
      var parts = String(card.qid || "").split("-");
      qidBtn.textContent = "【" + (card.qid || "") + "】";
      qidBtn.setAttribute("data-round", parts[0] || "");
      qidBtn.setAttribute("data-number", parts[1] || "");
      qidBtn.hidden = !(state.revealed && card.qid);
    }
    if (prevBtn) {
      prevBtn.disabled = state.index <= 0;
    }
    if (nextBtn) {
      nextBtn.disabled = state.index >= state.deck.length - 1;
    }
  }

  function revealAnswer() {
    if (!currentCard()) {
      return;
    }
    state.revealed = true;
    renderCard();
  }

  function go(delta) {
    if (!state.deck.length) {
      return;
    }
    var next = state.index + delta;
    if (next < 0 || next >= state.deck.length) {
      return;
    }
    state.index = next;
    state.revealed = false;
    renderCard();
  }

  function onCardActivate() {
    if (state.revealed) {
      go(1);
      return;
    }
    revealAnswer();
  }

  if (revealBtn) {
    revealBtn.addEventListener("click", function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest(".jiritsu-card-qid")) {
        return;
      }
      onCardActivate();
    });
    revealBtn.addEventListener("keydown", function (ev) {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        onCardActivate();
      }
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", function () {
      go(-1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", function () {
      go(1);
    });
  }
  if (qbSelect) {
    qbSelect.addEventListener("change", rebuildDeck);
  }
  if (catSelect) {
    catSelect.addEventListener("change", rebuildDeck);
  }
  if (kindSelect) {
    kindSelect.addEventListener("change", rebuildDeck);
  }
  if (shuffleToggle) {
    shuffleToggle.addEventListener("change", rebuildDeck);
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.defaultPrevented) {
      return;
    }
    var tag = (ev.target && ev.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
      return;
    }
    if (ev.target === revealBtn) {
      return;
    }
    if (ev.key === "ArrowLeft") {
      go(-1);
    } else if (ev.key === "ArrowRight") {
      go(1);
    } else if (ev.key === " " || ev.key === "Enter") {
      ev.preventDefault();
      onCardActivate();
    }
  });

  loadRubyThen(function () {
    applySiteBrandRuby();
    var h1 = document.querySelector(".page-header h1");
    if (h1) {
      fillWithRuby(h1, h1.textContent || "");
    }
    var cardsJson =
      (document.body && document.body.getAttribute("data-cards-json")) ||
      (document.body && document.body.getAttribute("data-hikaku-json")) ||
      "data/hikaku-jiritsu-cards.json";
    fetch(cardsJson + (cardsJson.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now())
      .then(function (res) {
        if (!res.ok) {
          throw new Error("カードデータの読み込みに失敗しました");
        }
        return res.json();
      })
      .then(function (payload) {
        hikakuQuestionIndex = (payload && payload.items) || {};
        state.all = (payload && payload.cards) || [];
        fillCategories((payload && payload.categories) || []);
        rebuildDeck();
      })
      .catch(function () {
        hikakuQuestionIndex = {};
        state.all = [];
        rebuildDeck();
      });
  });
}

var TERM_LOOKUP_URL = "/kaigo/kakomon/term/";
var TERM_LOOKUP_MIN = 2;
var TERM_LOOKUP_MAX = 80;
var TERM_LOOKUP_HOST =
  ".question-card, .koryaku-card, .koryaku-problem, .hikaku-modal-body, .hikaku-table, #questionList, #hikakuModalBody";
var TERM_LOOKUP_TIP_KEY = "kakomon.termLookupTipDismissed.v1";
var termLookupTimer = 0;

function isTermLookupTipDismissed() {
  try {
    return localStorage.getItem(TERM_LOOKUP_TIP_KEY) === "1";
  } catch (err) {
    return false;
  }
}

function dismissTermLookupTip() {
  try {
    localStorage.setItem(TERM_LOOKUP_TIP_KEY, "1");
  } catch (err) {
    /* ignore */
  }
  var el = document.getElementById("termLookupTip");
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

function pageWantsTermLookupTip() {
  var body = document.body;
  if (!body) {
    return false;
  }
  return (
    body.classList.contains("themes-view") ||
    body.classList.contains("koryaku-page") ||
    body.classList.contains("kakomon-challenge") ||
    body.classList.contains("kakomon-number")
  );
}

function maybeShowTermLookupTip() {
  if (!pageWantsTermLookupTip() || isTermLookupTipDismissed()) {
    return;
  }
  if (document.getElementById("termLookupTip")) {
    return;
  }
  var tip = document.createElement("aside");
  tip.id = "termLookupTip";
  tip.className = "term-lookup-tip";
  tip.setAttribute("role", "note");

  var body = document.createElement("p");
  body.className = "term-lookup-tip-body";
  body.textContent =
    "問題文や選択肢の語句を選択すると、「これ、出た？」で出る頻度を調べられます。";
  tip.appendChild(body);

  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "term-lookup-tip-dismiss";
  btn.textContent = "わかった";
  btn.addEventListener("click", function () {
    dismissTermLookupTip();
  });
  tip.appendChild(btn);

  var list = document.getElementById("questionList");
  var main = document.querySelector(".koryaku-main");
  if (list && list.parentNode) {
    list.parentNode.insertBefore(tip, list);
  } else if (main && main.parentNode) {
    main.parentNode.insertBefore(tip, main);
  } else {
    var header = document.querySelector(".page-header");
    if (header && header.parentNode) {
      header.parentNode.insertBefore(tip, header.nextSibling);
    } else {
      document.body.insertBefore(tip, document.body.firstChild);
    }
  }
}

function selectionTextWithoutRuby(range) {
  if (!range) {
    return "";
  }
  var wrap = document.createElement("div");
  wrap.appendChild(range.cloneContents());
  var drop = wrap.querySelectorAll(".ruby-text, rt, rp");
  for (var i = 0; i < drop.length; i++) {
    var node = drop[i];
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
  return String(wrap.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getTermLookupQueryFromSelection() {
  var sel = window.getSelection && window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) {
    return "";
  }
  var range = sel.getRangeAt(0);
  var node = range.commonAncestorContainer;
  var el = node && node.nodeType === 1 ? node : node && node.parentElement;
  if (!el || !el.closest) {
    return "";
  }
  if (el.closest("button, a, input, select, textarea, .site-nav, .nav-toggle, .term-lookup-pop")) {
    return "";
  }
  if (!el.closest(TERM_LOOKUP_HOST)) {
    return "";
  }
  var text = selectionTextWithoutRuby(range);
  if (text.length > TERM_LOOKUP_MAX) {
    text = text.slice(0, TERM_LOOKUP_MAX);
  }
  if (text.length < TERM_LOOKUP_MIN) {
    return "";
  }
  return text;
}

function ensureTermLookupPop() {
  var pop = document.getElementById("termLookupPop");
  if (pop) {
    return pop;
  }
  pop = document.createElement("a");
  pop.id = "termLookupPop";
  pop.className = "term-lookup-pop";
  pop.hidden = true;
  pop.addEventListener("pointerdown", function (ev) {
    /* 選択解除でポップが消える前に遷移できるようにする */
    ev.preventDefault();
  });
  pop.addEventListener("click", function (ev) {
    var href = pop.getAttribute("href");
    if (!href) {
      ev.preventDefault();
      return;
    }
    window.location.href = href;
  });
  document.body.appendChild(pop);
  return pop;
}

function hideTermLookupPop() {
  var pop = document.getElementById("termLookupPop");
  if (pop) {
    pop.hidden = true;
  }
}

function placeTermLookupPop(pop, rect) {
  var edge = 8;
  /* スマホのOS選択メニュー（コピー／調べる等）と重ならないよう、上に余白を多めに取る */
  var touch =
    window.matchMedia &&
    window.matchMedia("(hover: none), (pointer: coarse)").matches;
  var aboveGap = touch ? 56 : 8;
  var w = pop.offsetWidth || 160;
  var h = pop.offsetHeight || 40;
  var top = rect.top - h - aboveGap;
  if (top < edge) {
    /* 上に出せないときだけ下へ（通常は上を維持） */
    top = rect.bottom + (touch ? 28 : edge);
  }
  if (top + h > window.innerHeight - edge) {
    top = Math.max(edge, window.innerHeight - h - edge);
  }
  var left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(edge, Math.min(left, window.innerWidth - w - edge));
  pop.style.top = Math.round(top) + "px";
  pop.style.left = Math.round(left) + "px";
}

function updateTermLookupPop() {
  var text = getTermLookupQueryFromSelection();
  if (!text) {
    hideTermLookupPop();
    return;
  }
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    hideTermLookupPop();
    return;
  }
  var rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    hideTermLookupPop();
    return;
  }
  var pop = ensureTermLookupPop();
  pop.href = TERM_LOOKUP_URL + "?q=" + encodeURIComponent(text);
  pop.textContent = "これ、出た？";
  pop.setAttribute("aria-label", "「" + text + "」をこれ、出た？で調べる");
  pop.hidden = false;
  placeTermLookupPop(pop, rect);
  dismissTermLookupTip();
}

function scheduleTermLookupPop() {
  if (termLookupTimer) {
    window.clearTimeout(termLookupTimer);
  }
  termLookupTimer = window.setTimeout(function () {
    termLookupTimer = 0;
    updateTermLookupPop();
  }, 80);
}

function wireTermLookupFromSelection() {
  if (window.__termLookupWired) {
    return;
  }
  window.__termLookupWired = true;
  document.addEventListener("selectionchange", scheduleTermLookupPop);
  document.addEventListener("mouseup", scheduleTermLookupPop);
  document.addEventListener(
    "touchend",
    function () {
      scheduleTermLookupPop();
    },
    { passive: true }
  );
  window.addEventListener(
    "scroll",
    function () {
      if (document.getElementById("termLookupPop") && !document.getElementById("termLookupPop").hidden) {
        updateTermLookupPop();
      }
    },
    { passive: true }
  );
  window.addEventListener("resize", hideTermLookupPop);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      hideTermLookupPop();
    }
  });
  maybeShowTermLookupTip();
}

function boot() {
  wireTermLookupFromSelection();
  if (document.body.classList.contains("koryaku-page")) {
    bootKoryaku();
    return;
  }
  if (document.body.classList.contains("hikaku-page--jiritsu-cards")) {
    bootJiritsuCards();
    return;
  }
  if (document.body.classList.contains("hikaku-page")) {
    bootHikaku();
    return;
  }
  if (document.body.classList.contains("themes-index")) {
    bootIndex();
    return;
  }
  if (document.body.classList.contains("themes-view")) {
    bootView();
    return;
  }
}

boot();
