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
  { word: "用語", ruby: "ようご" },
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
  /* 「これ、出た？」診断結果 */
  { word: "優先して押さえる", ruby: "ゆうせんしておさえる" },
  { word: "後回しで良い", ruby: "あとまわしでよい" },
  { word: "調べた用語", ruby: "しらべたようご" },
  { word: "出た科目", ruby: "でたかもく" },
  { word: "判定の目安", ruby: "はんていのめやす" },
  { word: "直近", ruby: "ちょっきん" },
  { word: "押さえる", ruby: "おさえる" },
  { word: "優先", ruby: "ゆうせん" },
  { word: "後回し", ruby: "あとまわし" },
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
  ".question-card, .koryaku-card, .koryaku-problem, .hikaku-modal-body, .hikaku-table, #questionList";
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

/* 原文1文字→NFKC後の対応表。ハイライト位置の往復に使う */
function buildNormalizedIndex(text) {
  var norm = "";
  var starts = [];
  for (var i = 0; i < text.length; i++) {
    var piece = normalizeForSearch(text.charAt(i));
    for (var p = 0; p < piece.length; p++) {
      starts.push(i);
      norm += piece.charAt(p);
    }
  }
  return { norm: norm, starts: starts };
}

function findInNormalizedIndex(index, normNeedle, fromOrig) {
  if (!normNeedle || !index || !index.norm) {
    return null;
  }
  var fromNorm = 0;
  if (fromOrig > 0) {
    while (fromNorm < index.starts.length && index.starts[fromNorm] < fromOrig) {
      fromNorm++;
    }
  }
  var at = index.norm.indexOf(normNeedle, fromNorm);
  if (at === -1) {
    return null;
  }
  var endNorm = at + normNeedle.length;
  var origStart = index.starts[at];
  var origEnd = index.starts[endNorm - 1] + 1;
  return { start: origStart, end: origEnd };
}

function findNextHighlightMatch(text, from, terms, normIndex) {
  if (!terms || !terms.length) {
    return null;
  }
  var index = normIndex || buildNormalizedIndex(text);
  var best = null;
  for (var t = 0; t < terms.length; t++) {
    var normNeedle = normalizeForSearch(terms[t]);
    var hit = findInNormalizedIndex(index, normNeedle, from);
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
  var normIndex = buildNormalizedIndex(text);
  var cursor = 0;
  while (cursor < text.length) {
    var hit = findNextHighlightMatch(text, cursor, terms, normIndex);
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

/* 極端に長い入力で検索・ハイライトが重くならないようにする */
var MAX_KEYWORD_QUERY_LENGTH = 80;
var MAX_KEYWORD_TERM_COUNT = 8;
var MAX_KEYWORD_TERM_LENGTH = 40;

function sanitizeKeywordQuery(raw) {
  var text = String(raw == null ? "" : raw);
  if (text.length > MAX_KEYWORD_QUERY_LENGTH) {
    text = text.slice(0, MAX_KEYWORD_QUERY_LENGTH);
  }
  return text;
}

function clampSearchInputValue(input) {
  if (!input) {
    return "";
  }
  var next = sanitizeKeywordQuery(input.value);
  if (input.value !== next) {
    input.value = next;
  }
  return input.value;
}

function parseTerms(raw) {
  var terms = sanitizeKeywordQuery(raw)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(function (term) {
      return term.length > MAX_KEYWORD_TERM_LENGTH
        ? term.slice(0, MAX_KEYWORD_TERM_LENGTH)
        : term;
    });
  if (terms.length > MAX_KEYWORD_TERM_COUNT) {
    terms = terms.slice(0, MAX_KEYWORD_TERM_COUNT);
  }
  return terms;
}

function questionSearchText(q, mode) {
  /* mode === "term": 問題文・選択肢のみ（科目名・IDは見ない） */
  var cacheKey = mode === "term" ? "_searchTextTerm" : "_searchText";
  if (q && typeof q[cacheKey] === "string") {
    return q[cacheKey];
  }
  var parts = [];
  if (mode !== "term") {
    parts.push(q.id || "", q.subject || "");
  }
  var body = q.body || [];
  for (var i = 0; i < body.length; i++) {
    parts.push(body[i]);
  }
  var choices = q.choices || [];
  for (var c = 0; c < choices.length; c++) {
    parts.push(choices[c].text || "");
  }
  var hay = normalizeForSearch(parts.join("\n"));
  if (q && typeof q === "object") {
    q[cacheKey] = hay;
  }
  return hay;
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

/** QB印刷番号 → 公式番号（変換不可なら null） */
function qbPrintToOfficialNumber(round, qbNum) {
  if (!usesQbPrintAlias(round)) {
    return null;
  }
  return mapNumberAcrossLayouts(qbNum, QB32_SUBJECT_RANGES, OFFICIAL_RANGES_PRE32);
}

/** 公式番号 → QB印刷番号（変換不可なら null） */
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


function searchQuestions(questions, terms, sessionFrom, sessionTo, subject, type, searchMode) {
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
      var hay = questionSearchText(q, searchMode);
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

function subjectOptionLabel(subject, count) {
  var name = String(subject || "").trim();
  if (!name) {
    return count == null ? "すべての科目" : "すべての科目（" + count + "）";
  }
  if (count == null) {
    return name;
  }
  return name + "（" + count + "）";
}

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
  for (var s = meta.sessionMax; s >= meta.sessionMin; s--) {
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
  var selected = selectEl.value;
  var opts = Array.prototype.slice.call(selectEl.options);
  opts.sort(function (a, b) {
    var av = a.value === "" ? -Infinity : Number(a.value);
    var bv = b.value === "" ? -Infinity : Number(b.value);
    if (isNaN(av) && isNaN(bv)) {
      return 0;
    }
    if (isNaN(av)) {
      return 1;
    }
    if (isNaN(bv)) {
      return -1;
    }
    return bv - av;
  });
  var frag = document.createDocumentFragment();
  for (var i = 0; i < opts.length; i++) {
    var opt = opts[i];
    if (opt.value) {
      opt.textContent = sessionYearLabel(opt.value);
    }
    frag.appendChild(opt);
  }
  selectEl.replaceChildren(frag);
  if (selected) {
    selectEl.value = selected;
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
  wireSessionYearSelect(document.getElementById("challengeRound"));
  wireSessionYearSelect(document.getElementById("typeRound"));
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
  var from;
  var to;
  var type;
  var terms;
  if (isChallengePage()) {
    from = to = getChallengeRound();
    type = "";
    terms = [];
  } else {
    var range = getSelectedRange();
    from = range.from;
    to = range.to;
    type = getSelectedType();
    terms = getFilterKeywordTerms();
  }
  var result = countSubjectsForFilters(allQuestions, from, to, type, terms);
  for (var i = 0; i < el.options.length; i++) {
    var opt = el.options[i];
    if (!opt.value) {
      opt.textContent = subjectOptionLabel("", result.total);
      continue;
    }
    var n = result.counts[opt.value] || 0;
    opt.textContent = subjectOptionLabel(opt.value, n);
  }
}

function updateTypeOptionCounts() {
  var el = document.getElementById("typeSelect");
  if (!el || !questionsReady) {
    return;
  }
  var from;
  var to;
  var subject;
  var terms;
  if (isTypeBrowsePage()) {
    from = to = getTypeBrowseRound();
    subject = "";
    terms = [];
  } else {
    var range = getSelectedRange();
    from = range.from;
    to = range.to;
    subject = getSelectedSubject();
    terms = getFilterKeywordTerms();
  }
  var result = countTypesForFilters(
    allQuestions,
    from,
    to,
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

function buildQuestionCard(q) {
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
  return card;
}

function renderQuestions(questions, options) {
  var root = document.getElementById("questionList");
  var append = !!(options && options.append);
  if (!append) {
    root.textContent = "";
  }

  if (!questions.length) {
    if (!append) {
      var empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "該当する問題がありません。条件を変えて試してください。";
      root.appendChild(empty);
    }
    return;
  }

  var frag = document.createDocumentFragment();
  for (var i = 0; i < questions.length; i++) {
    frag.appendChild(buildQuestionCard(questions[i]));
  }
  root.appendChild(frag);
  markVocabGlossTerms(root);
  activateVocabGlossIfRubyOn();
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
    describeFilters(range, subject, type, terms) +
      " → " +
      hits.length +
      " 問",
    "filter"
  );
  renderQuestions(hits);
}

function scrollToShownQuestion() {
  var root = document.getElementById("questionList");
  if (!root) return;
  var card = root.querySelector(".question-card");
  var target = card || root;
  // 描画直後にレイアウトが確定してから寄せる
  window.requestAnimationFrame(function () {
    var top = target.getBoundingClientRect().top + window.pageYOffset - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });
}

function runJumpSearch() {
  var jump = getJumpInputs();
  var numberPage = isNumberSearchPage();
  if (jump.round === null || jump.number === null) {
    setStatus(
      numberPage ? "" : "回と問題番号の両方を入力してください。",
      "jump"
    );
    showHint(
      numberPage
        ? "回と問題番号を選んでください。"
        : "例: 第37回の問10 → 回に「37」、番号に「10」を入れて「この問題を表示」。"
    );
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
  var entries = resolveJumpEntries(allQuestions, jump.round, jump.number);
  if (entries.length) {
    if (numberPage) {
      setStatus("", "jump");
    } else if (entries.length === 1 && entries[0].viaQb) {
      setStatus(
        "QB印刷 " +
          jump.round +
          "-" +
          jump.number +
          " → 公式 " +
          entries[0].q.round +
          "-" +
          entries[0].q.number +
          " を表示中",
        "jump"
      );
    } else {
      setStatus(
        roundLabelWithYear(jump.round) + " 問題" + jump.number + " を表示中",
        "jump"
      );
    }
    renderJumpEntries(entries);
    if (!numberPage) {
      scrollToShownQuestion();
    }
  } else {
    setStatus(
      numberPage
        ? ""
        : roundLabelWithYear(jump.round) +
            " 問題" +
            jump.number +
            " はデータにありません",
      "jump"
    );
    showHint("指定した回・問題番号の問題が見つかりませんでした。");
  }
}

function resolveJumpEntries(questions, round, number) {
  var officialHit = findByRoundAndNumber(questions, round, number);
  var entries = [];
  var seen = {};
  function pushEntry(q, viaQb, caption) {
    if (!q || seen[q.id]) {
      return;
    }
    seen[q.id] = 1;
    entries.push({ q: q, viaQb: !!viaQb, caption: caption || "" });
  }
  if (usesQbPrintAlias(round)) {
    var officialNum = qbPrintToOfficialNumber(round, number);
    var qbHit =
      officialNum != null
        ? findByRoundAndNumber(questions, round, officialNum)
        : null;
    if (qbHit && officialHit && qbHit.id !== officialHit.id) {
      pushEntry(
        qbHit,
        true,
        "QB印刷番号 " + round + "-" + number + " → 公式 " + qbHit.round + "-" + qbHit.number
      );
      pushEntry(
        officialHit,
        false,
        "公式の問題番号 " + round + "-" + number + " としてもヒット"
      );
      return entries;
    }
    if (qbHit) {
      pushEntry(
        qbHit,
        officialNum !== Number(number),
        officialNum !== Number(number)
          ? "QB印刷番号 " +
              round +
              "-" +
              number +
              " → 公式 " +
              qbHit.round +
              "-" +
              qbHit.number
          : ""
      );
      return entries;
    }
  }
  pushEntry(officialHit, false, "");
  return entries;
}

function renderJumpEntries(entries) {
  var root = document.getElementById("questionList");
  if (!root) {
    return;
  }
  root.textContent = "";
  var frag = document.createDocumentFragment();
  var showCaptions =
    entries.length > 1 || (entries.length === 1 && entries[0].caption);
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (showCaptions && entry.caption) {
      var label = document.createElement("p");
      label.className = "jump-hit-label";
      fillWithRuby(label, entry.caption);
      frag.appendChild(label);
    }
    frag.appendChild(buildQuestionCard(entry.q));
  }
  root.appendChild(frag);
  markVocabGlossTerms(root);
  activateVocabGlossIfRubyOn();
}

function refreshCurrentView() {
  if (lastView.mode === "jump") {
    runJumpSearch();
  } else if (lastView.mode === "challenge") {
    runChallengeSearch();
  } else if (lastView.mode === "type") {
    runTypeBrowseSearch();
  } else if (lastView.mode === "term") {
    runTermSearch(lastView.query);
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
      state.q = sanitizeKeywordQuery(params.get("q") || "");
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
    var trimmed = sanitizeKeywordQuery(rawQuery).trim();
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
    url.searchParams.delete("fig");
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
    url.searchParams.delete("fig");
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

function isNumberSearchPage() {
  return !!(document.body && document.body.classList.contains("kakomon-number"));
}

function isChallengePage() {
  return !!(
    document.body && document.body.classList.contains("kakomon-challenge")
  );
}

function isTypeBrowsePage() {
  return !!(document.body && document.body.classList.contains("kakomon-type"));
}

function isTermCheckPage() {
  return !!(document.body && document.body.classList.contains("kakomon-term"));
}

/* テーマ一覧と同じ直近5年（回） */
var TERM_RECENT_MIN = 34;
var TERM_RECENT_MAX = 38;

function writeTermStateToUrl(rawQuery) {
  try {
    var url = new URL(window.location.href);
    var trimmed = sanitizeKeywordQuery(rawQuery).trim();
    if (trimmed) {
      url.searchParams.set("q", trimmed);
    } else {
      url.searchParams.delete("q");
    }
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    url.searchParams.delete("subject");
    url.searchParams.delete("type");
    url.searchParams.delete("round");
    url.searchParams.delete("num");
    url.searchParams.delete("fig");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch (err) {
    /* ignore */
  }
}

function clearTermSummary() {
  var el = document.getElementById("termSummary");
  if (!el) {
    return;
  }
  el.hidden = true;
  el.className = "term-summary";
  el.textContent = "";
}

function termGuidance(recentCount) {
  /* 押さえる: 直近5回で3問以上
     後回し: それ以外（出現回の分散だけでは上げない） */
  if (recentCount >= 3) {
    return { level: "high", label: "優先して押さえる" };
  }
  return { level: "low", label: "後回しで良い" };
}

function analyzeTermHits(hits) {
  var recentHits = [];
  var roundSet = {};
  var recentRoundSet = {};
  var subjectSet = {};
  for (var i = 0; i < hits.length; i++) {
    var q = hits[i];
    var round = Number(q.round);
    var subject = String(q.subject || "").trim();
    if (subject) {
      subjectSet[subject] = true;
    }
    if (!isNaN(round)) {
      roundSet[round] = true;
      if (round >= TERM_RECENT_MIN && round <= TERM_RECENT_MAX) {
        recentHits.push(q);
        recentRoundSet[round] = true;
      }
    }
  }
  var rounds = Object.keys(roundSet)
    .map(Number)
    .filter(function (n) {
      return !isNaN(n);
    })
    .sort(function (a, b) {
      return b - a;
    });
  var recentRounds = Object.keys(recentRoundSet)
    .map(Number)
    .filter(function (n) {
      return !isNaN(n);
    })
    .sort(function (a, b) {
      return b - a;
    });
  var subjects = [];
  for (var o = 0; o < SUBJECT_ORDER.length; o++) {
    var name = SUBJECT_ORDER[o];
    if (subjectSet[name]) {
      subjects.push(name);
      delete subjectSet[name];
    }
  }
  var rest = Object.keys(subjectSet).sort(function (a, b) {
    return a.localeCompare(b, "ja");
  });
  subjects = subjects.concat(rest);
  var guide = termGuidance(recentHits.length);
  return {
    total: hits.length,
    recentCount: recentHits.length,
    olderCount: hits.length - recentHits.length,
    rounds: rounds,
    recentRounds: recentRounds,
    subjects: subjects,
    guide: guide
  };
}

function renderTermSummary(terms, analysis) {
  var el = document.getElementById("termSummary");
  if (!el) {
    return;
  }
  el.hidden = false;
  el.className = "term-summary term-summary-" + analysis.guide.level;
  el.textContent = "";

  /* 用語は小さく、判定（覚える優先度）を主役にする */
  var eyebrow = document.createElement("p");
  eyebrow.className = "term-summary-eyebrow";
  fillWithRuby(eyebrow, "調べた用語");
  el.appendChild(eyebrow);

  var termEl = document.createElement("p");
  termEl.className = "term-summary-term";
  fillWithRuby(termEl, terms.join(" "));
  el.appendChild(termEl);

  var level = document.createElement("p");
  level.className = "term-summary-level";
  fillWithRuby(level, analysis.guide.label);
  el.appendChild(level);

  var noteWrap = document.createElement("details");
  noteWrap.className = "term-summary-note-wrap";
  var noteSummary = document.createElement("summary");
  noteSummary.className = "term-summary-note-toggle";
  fillWithRuby(noteSummary, "判定の目安");
  noteWrap.appendChild(noteSummary);
  var note = document.createElement("p");
  note.className = "term-summary-note";
  fillWithRuby(
    note,
    "直近5年（第" +
      TERM_RECENT_MIN +
      "〜" +
      TERM_RECENT_MAX +
      "回）で3問以上出た語は「優先して押さえる」、それ以外は「後回しで良い」です。"
  );
  noteWrap.appendChild(note);
  el.appendChild(noteWrap);

  var stats = document.createElement("ul");
  stats.className = "term-summary-stats";

  function appendRoundCount(li, n) {
    var strong = document.createElement("strong");
    strong.className = "term-summary-count";
    strong.textContent = String(n);
    li.appendChild(strong);
    var unit = document.createElement("span");
    unit.className = "term-summary-unit";
    unit.textContent = "回";
    li.appendChild(unit);
  }

  function appendLabeledCount(labelText, n) {
    var li = document.createElement("li");
    var label = document.createElement("span");
    fillWithRuby(label, labelText);
    li.appendChild(label);
    appendRoundCount(li, n);
    stats.appendChild(li);
  }

  /* 上から直近10年 → 直近5年。「回」はヒットした問題数 */
  appendLabeledCount("直近10年: ", analysis.total);
  appendLabeledCount("直近5年: ", analysis.recentCount);

  var liSubjects = document.createElement("li");
  if (analysis.subjects && analysis.subjects.length) {
    fillWithRuby(liSubjects, "出た科目: " + analysis.subjects.join("・"));
  } else {
    fillWithRuby(liSubjects, "出た科目: なし");
  }
  stats.appendChild(liSubjects);
  el.appendChild(stats);
}

var TERM_LIST_BATCH = 10;
var termListHits = [];
var termListOlder = [];
var termListShown = 0;
var termListPhase = "recent"; /* recent | older */

function sortTermHitsNewestFirst(hits) {
  hits.sort(function (a, b) {
    var rd = Number(b.round) - Number(a.round);
    if (rd !== 0) {
      return rd;
    }
    return Number(a.number) - Number(b.number);
  });
  return hits;
}

function partitionTermHitsByRecent(hits) {
  var recent = [];
  var older = [];
  for (var i = 0; i < hits.length; i++) {
    var q = hits[i];
    var round = Number(q && q.round);
    if (!isNaN(round) && round >= TERM_RECENT_MIN && round <= TERM_RECENT_MAX) {
      recent.push(q);
    } else {
      older.push(q);
    }
  }
  return {
    recent: sortTermHitsNewestFirst(recent),
    older: sortTermHitsNewestFirst(older)
  };
}

function clearTermMoreControl() {
  var old = document.getElementById("termMoreWrap");
  if (old && old.parentNode) {
    old.parentNode.removeChild(old);
  }
}

function appendTermMoreControl() {
  clearTermMoreControl();
  var root = document.getElementById("questionList");
  if (!root) {
    return;
  }
  var remain = termListHits.length - termListShown;
  var wrap = document.createElement("div");
  wrap.id = "termMoreWrap";
  wrap.className = "term-more-wrap";
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "term-more-button";

  if (remain > 0) {
    btn.textContent = "さらに表示（残り" + remain + "問）";
    btn.addEventListener("click", function () {
      renderTermQuestionBatch();
    });
    wrap.appendChild(btn);
    root.appendChild(wrap);
    return;
  }

  if (termListPhase === "recent" && termListOlder.length) {
    btn.textContent = "あと5年分見る（" + termListOlder.length + "問）";
    btn.addEventListener("click", function () {
      termListPhase = "older";
      termListHits = termListOlder;
      termListShown = 0;
      renderTermQuestionBatch();
    });
    wrap.appendChild(btn);
    root.appendChild(wrap);
  }
}

function renderTermQuestionBatch() {
  clearTermMoreControl();
  var next = termListHits.slice(termListShown, termListShown + TERM_LIST_BATCH);
  if (!next.length) {
    appendTermMoreControl();
    return;
  }
  renderQuestions(next, { append: true });
  termListShown += next.length;
  appendTermMoreControl();
}

function runTermSearch(rawQuery) {
  if (!isTermCheckPage()) {
    return;
  }
  var q = sanitizeKeywordQuery(rawQuery);
  var terms = parseTerms(q);
  lastView = { mode: "term", query: q };
  termListHits = [];
  termListOlder = [];
  termListShown = 0;
  termListPhase = "recent";
  clearTermMoreControl();

  if (!terms.length) {
    clearTermSummary();
    setStatus("", "term");
    showHint("用語を入れて「調べる」を押してください。例: ノーマライゼーション");
    return;
  }

  if (!questionsReady) {
    setStatus("問題データを読み込み中…", "term");
    showHint("少々お待ちください。");
    return;
  }

  setActiveHighlightTerms(terms);
  var from = meta.sessionMin != null ? meta.sessionMin : 29;
  var to = meta.sessionMax != null ? meta.sessionMax : 38;
  var hits = searchQuestions(allQuestions, terms, from, to, "", "", "term");
  hits = sortTermHitsNewestFirst(hits);

  var analysis = analyzeTermHits(hits);
  renderTermSummary(terms, analysis);
  setStatus("", "term");

  if (!hits.length) {
    showHint(
      "「" +
        terms.join(" ") +
        "」に一致する問題は見つかりませんでした。表記を変えて試してください。"
    );
    return;
  }

  var parts = partitionTermHitsByRecent(hits);
  /* 直近5年だけ先に出す。古い5年はボタンで開く */
  termListHits = parts.recent.length ? parts.recent : parts.older;
  termListOlder = parts.recent.length ? parts.older : [];
  termListPhase = parts.recent.length ? "recent" : "older";
  /* 要約を先に見せ、問題カードは次フレームで少量ずつ */
  var list = document.getElementById("questionList");
  if (list) {
    list.textContent = "";
  }
  window.requestAnimationFrame(function () {
    if (lastView.mode !== "term" || lastView.query !== q) {
      return;
    }
    termListShown = 0;
    var first = termListHits.slice(0, TERM_LIST_BATCH);
    renderQuestions(first);
    termListShown = first.length;
    appendTermMoreControl();
  });
}

function kakomonDataBase() {
  var base =
    (document.body && document.body.getAttribute("data-kakomon-base")) || "";
  return base;
}

/** figures/ 相対パスを番号サーチ・これ出た？等のサブディレクトリからも正しく解決する */
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
  var base = kakomonDataBase();
  return base ? base + s : s;
}

function getChallengeRound() {
  var el = document.getElementById("challengeRound");
  var n = el ? Number(el.value) : NaN;
  if (isNaN(n) || n < 1) {
    return meta.defaultTo != null ? meta.defaultTo : 38;
  }
  return n;
}

function writeChallengeStateToUrl(round, subject) {
  try {
    var url = new URL(window.location.href);
    var defaultRound = meta.defaultTo != null ? meta.defaultTo : 38;
    if (Number(round) === Number(defaultRound)) {
      url.searchParams.delete("round");
    } else {
      url.searchParams.set("round", String(round));
    }
    if (subject) {
      url.searchParams.set("subject", subject);
    } else {
      url.searchParams.delete("subject");
    }
    url.searchParams.delete("q");
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    url.searchParams.delete("type");
    url.searchParams.delete("num");
    url.searchParams.delete("fig");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch (err) {
    /* ignore */
  }
}

function runChallengeSearch() {
  if (!isChallengePage()) {
    return;
  }
  if (!questionsReady) {
    lastView = { mode: "challenge", query: "" };
    setStatus("問題データを読み込み中…", "challenge");
    showHint("少々お待ちください。");
    return;
  }
  var round = getChallengeRound();
  var subject = getSelectedSubject();
  lastView = { mode: "challenge", query: "" };
  setActiveHighlightTerms([]);
  var hits = searchQuestions(allQuestions, [], round, round, subject, "");
  hits.sort(function (a, b) {
    return Number(a.number) - Number(b.number);
  });
  if (!hits.length) {
    setStatus("", "challenge");
    showHint("指定した回・科目の問題が見つかりませんでした。");
    return;
  }
  setStatus("", "challenge");
  renderQuestions(hits);
}

function getTypeBrowseRound() {
  var el = document.getElementById("typeRound");
  var n = el ? Number(el.value) : NaN;
  if (isNaN(n) || n < 1) {
    return meta.defaultTo != null ? meta.defaultTo : 38;
  }
  return n;
}

function writeTypeBrowseStateToUrl(round, type) {
  try {
    var url = new URL(window.location.href);
    var defaultRound = meta.defaultTo != null ? meta.defaultTo : 38;
    if (Number(round) === Number(defaultRound)) {
      url.searchParams.delete("round");
    } else {
      url.searchParams.set("round", String(round));
    }
    if (type) {
      url.searchParams.set("type", type);
    } else {
      url.searchParams.delete("type");
    }
    url.searchParams.delete("q");
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    url.searchParams.delete("subject");
    url.searchParams.delete("num");
    url.searchParams.delete("fig");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch (err) {
    /* ignore */
  }
}

function runTypeBrowseSearch() {
  if (!isTypeBrowsePage()) {
    return;
  }
  if (!questionsReady) {
    lastView = { mode: "type", query: "" };
    setStatus("問題データを読み込み中…", "type");
    showHint("少々お待ちください。");
    return;
  }
  var round = getTypeBrowseRound();
  var type = getSelectedType();
  lastView = { mode: "type", query: "" };
  setActiveHighlightTerms([]);
  var hits = searchQuestions(allQuestions, [], round, round, "", type);
  hits.sort(function (a, b) {
    return Number(a.number) - Number(b.number);
  });
  if (!hits.length) {
    setStatus("", "type");
    showHint("指定した回・タイプの問題が見つかりませんでした。");
    return;
  }
  setStatus("", "type");
  renderQuestions(hits);
}

function showIdleState() {
  if (isNumberSearchPage()) {
    setStatus("回と問題番号を選んで表示してください。");
    showHint(
      "例: 第38回の問1 → 回と問題を選んで「この問題を表示」。"
    );
    return;
  }
  if (isChallengePage()) {
    setStatus("回を選ぶと問題が表示されます。");
    showHint("科目を選ぶと、その科目だけに絞り込めます。");
    return;
  }
  if (isTypeBrowsePage()) {
    setStatus("回を選ぶと問題が表示されます。");
    showHint("タイプを選ぶと、正しいもの・適切なもの等に絞り込めます。");
    return;
  }
  if (isTermCheckPage()) {
    clearTermSummary();
    setStatus("", "term");
    showHint("用語を入れて「調べる」を押してください。例: ノーマライゼーション");
    return;
  }
  var from = meta.defaultFrom != null ? meta.defaultFrom : 38;
  setStatus("条件を選んで「検索」を押してください。");
  showHint(
    "初期表示は" + roundLabelWithYear(from) + "です。「検索」で問題を表示します。"
  );
}

function applyTitleRuby() {
  var brand = document.querySelector(".site-brand");
  if (brand) {
    var label = "介護福祉士国家試験対策";
    var href = "/kaigo/kakomon/themes/view.html?t=b146eeffd742";
    if (brand.tagName !== "A") {
      var link = document.createElement("a");
      link.className = brand.className;
      brand.parentNode.replaceChild(link, brand);
      brand = link;
    }
    brand.href = href;
    /* 1行目はルビなし。狭い画面でも省略せず全文を出す */
    brand.setAttribute("aria-label", label);
    brand.textContent = label;
  }
  var h1 = document.querySelector(".page-header h1");
  if (!h1) {
    return;
  }
  /* 2回目以降に textContent を読むとルビ読みが本文に混ざるため、初回だけ確定する */
  if (!h1.dataset.pageTitle) {
    var raw = (
      h1.getAttribute("data-page-title") ||
      document.title ||
      ""
    ).trim();
    if (!raw) {
      raw = "過去問検索";
    }
    h1.dataset.pageTitle = raw;
  }
  fillWithRuby(h1, h1.dataset.pageTitle);
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
  var afterId = document.getElementById("numberNavLink")
    ? "numberNavLink"
    : document.getElementById("termNavLink")
      ? "termNavLink"
      : "rubyToggle";
  insertHeaderToolAfter(row, link, afterId);
}

/* 適切（◯）／不適切（✕）マップ切替は出さない */
function wireJiritsuMapLinks() {
  return;
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
    body.classList.contains("kakomon-type") ||
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
      var pop = document.getElementById("termLookupPop");
      if (pop && !pop.hidden) {
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
  var filterForm = document.getElementById("filterForm");
  var jumpForm = document.getElementById("jumpForm");
  var input = document.getElementById("searchInput");
  var clearBtn = document.getElementById("searchClear");
  var fromEl = document.getElementById("sessionFrom");
  var toEl = document.getElementById("sessionTo");
  var subjectEl = document.getElementById("subjectSelect");
  var typeEl = document.getElementById("typeSelect");
  var jumpRoundEl = document.getElementById("jumpRound");
  var jumpNumberEl = document.getElementById("jumpNumber");
  var challengeRoundEl = document.getElementById("challengeRound");
  var challengeForm = document.getElementById("challengeForm");
  var typeRoundEl = document.getElementById("typeRound");
  var typeForm = document.getElementById("typeForm");
  var termForm = document.getElementById("termForm");

  // 問番号は HTML に 1〜125 を埋め済み。不足時のみ補完
  fillJumpNumberSelect();
  wireAllSessionYearSelects();
  applyTitleRuby();
  wireSiteNav();
  wireHeaderChrome();
  wireRubyFitRefresh();
  wireTermLookupFromSelection();
  wireBackToTop();
  setStatus("問題データを読み込み中…");
  showHint("少々お待ちください。");

  function syncSearchClearButton() {
    if (!clearBtn || !input) {
      return;
    }
    clearBtn.hidden = !String(input.value || "").length;
  }

  function refreshFilterCounts() {
    updateFilterOptionCounts();
    syncSearchClearButton();
  }
  if (fromEl) {
    fromEl.addEventListener("change", refreshFilterCounts);
  }
  if (toEl) {
    toEl.addEventListener("change", refreshFilterCounts);
  }
  if (subjectEl && !isChallengePage()) {
    subjectEl.addEventListener("change", refreshFilterCounts);
  }
  if (typeEl && !isTypeBrowsePage()) {
    typeEl.addEventListener("change", refreshFilterCounts);
  }
  if (input) {
    input.setAttribute("maxlength", String(MAX_KEYWORD_QUERY_LENGTH));
    input.addEventListener("input", function () {
      clampSearchInputValue(input);
      if (isTermCheckPage()) {
        syncSearchClearButton();
      } else {
        refreshFilterCounts();
      }
    });
  }
  if (clearBtn && input) {
    clearBtn.addEventListener("click", function () {
      if (!input.value) {
        syncSearchClearButton();
        return;
      }
      input.value = "";
      syncSearchClearButton();
      input.focus();
      if (isTermCheckPage()) {
        writeTermStateToUrl("");
        runTermSearch("");
        return;
      }
      // キーワードだけ消す。回・科目・タイプはそのまま。検索結果表示中なら再検索
      if (lastView && lastView.mode === "filter") {
        submitFilter();
      } else {
        updateFilterOptionCounts();
      }
    });
  }

  function submitFilter() {
    if (!filterForm) {
      return;
    }
    var range = getSelectedRange();
    var q = clampSearchInputValue(input);
    var subject = getSelectedSubject();
    var type = getSelectedType();
    if (jumpRoundEl) {
      jumpRoundEl.value = "";
    }
    if (jumpNumberEl) {
      jumpNumberEl.value = "";
    }
    writeFilterStateToUrl(q, range.from, range.to, subject, type);
    updateFilterOptionCounts();
    runFilterSearch(q);
  }

  function submitJump() {
    var jump = getJumpInputs();
    writeJumpStateToUrl(jump);
    runJumpSearch();
  }

  if (filterForm) {
    filterForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      submitFilter();
    });
  }
  if (jumpForm) {
    jumpForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      submitJump();
    });
  }
  if (isNumberSearchPage()) {
    function onNumberSelectChange() {
      if (!questionsReady) {
        return;
      }
      submitJump();
    }
    if (jumpRoundEl) {
      jumpRoundEl.addEventListener("change", onNumberSelectChange);
    }
    if (jumpNumberEl) {
      jumpNumberEl.addEventListener("change", onNumberSelectChange);
    }
  }

  function submitChallenge() {
    var round = getChallengeRound();
    var subject = getSelectedSubject();
    writeChallengeStateToUrl(round, subject);
    updateSubjectOptionCounts();
    runChallengeSearch();
  }

  if (isChallengePage()) {
    if (challengeForm) {
      challengeForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        submitChallenge();
      });
    }
    function onChallengeSelectChange() {
      if (!questionsReady) {
        return;
      }
      submitChallenge();
    }
    if (challengeRoundEl) {
      challengeRoundEl.addEventListener("change", onChallengeSelectChange);
    }
    if (subjectEl) {
      subjectEl.addEventListener("change", onChallengeSelectChange);
    }
  }

  function submitTypeBrowse() {
    var round = getTypeBrowseRound();
    var type = getSelectedType();
    writeTypeBrowseStateToUrl(round, type);
    updateTypeOptionCounts();
    runTypeBrowseSearch();
  }

  if (isTypeBrowsePage()) {
    if (typeForm) {
      typeForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        submitTypeBrowse();
      });
    }
    function onTypeBrowseSelectChange() {
      if (!questionsReady) {
        return;
      }
      submitTypeBrowse();
    }
    if (typeRoundEl) {
      typeRoundEl.addEventListener("change", onTypeBrowseSelectChange);
    }
    if (typeEl) {
      typeEl.addEventListener("change", onTypeBrowseSelectChange);
    }
  }

  function submitTerm() {
    var q = clampSearchInputValue(input);
    writeTermStateToUrl(q);
    runTermSearch(q);
  }

  if (isTermCheckPage() && termForm) {
    termForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      submitTerm();
    });
  }

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

    /* 検索用テキストをアイドル時に先作り、初回検索を軽くする */
    window.setTimeout(function () {
      for (var wi = 0; wi < allQuestions.length; wi++) {
        questionSearchText(allQuestions[wi]);
      }
    }, 0);

    fillSessionSelects();
    var state = readStateFromUrl();
    if (fromEl) {
      fromEl.value = String(state.from);
    }
    if (toEl) {
      toEl.value = String(state.to);
    }
    if (input) {
      input.value = state.q;
    }
    syncSearchClearButton();
    if (typeEl) {
      if (isTypeBrowsePage()) {
        var wantType = state.type || "最も適切なもの";
        typeEl.value = wantType;
        if (typeEl.value !== wantType) {
          for (var ti = 0; ti < typeEl.options.length; ti++) {
            if (typeEl.options[ti].value) {
              typeEl.value = typeEl.options[ti].value;
              break;
            }
          }
        }
      } else {
        typeEl.value = state.type || "";
      }
    }
    if (document.getElementById("subjectSelect")) {
      fillSubjectSelect(collectSubjects(allQuestions), state.subject);
    }
    // 試作中は暫定で第38回・問題1を初期選択
    if (jumpRoundEl) {
      jumpRoundEl.value = state.round || "38";
    }
    if (jumpNumberEl) {
      jumpNumberEl.value = state.num || "1";
    }
    if (challengeRoundEl) {
      challengeRoundEl.value =
        state.round || String(meta.defaultTo != null ? meta.defaultTo : 38);
      expandSessionYearOptions(challengeRoundEl);
    }
    if (typeRoundEl) {
      typeRoundEl.value =
        state.round || String(meta.defaultTo != null ? meta.defaultTo : 38);
      expandSessionYearOptions(typeRoundEl);
    }
    if (isTypeBrowsePage()) {
      updateTypeOptionCounts();
    }

    if (isTermCheckPage()) {
      if (state.q) {
        runTermSearch(state.q);
      } else {
        showIdleState();
      }
    } else if (isChallengePage()) {
      runChallengeSearch();
    } else if (isTypeBrowsePage()) {
      runTypeBrowseSearch();
    } else if (pendingJump || (state.round && state.num)) {
      runJumpSearch();
    } else if (isNumberSearchPage()) {
      /* 番号検索ページは初期選択のまま1問表示 */
      runJumpSearch();
    } else {
      showIdleState();
    }
  }

  // 問題JSONとルビ辞書を同時に読む（同一サーバ・即時表示）
  var bust = "_t=" + Date.now();
  var dataBase = kakomonDataBase();
  Promise.all([
    fetch(dataBase + "questions.json?" + bust).then(function (res) {
      if (!res.ok) {
        throw new Error("questions.json の読み込みに失敗しました");
      }
      return res.json();
    }),
    fetch(dataBase + "ruby.json?" + bust)
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
