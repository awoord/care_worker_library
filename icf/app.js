var GAS_BASE_URL =
  "https://script.google.com/macros/s/AKfycby1hG96pflujpC2yLpK-RhslOoZXgkr_LGBj-IdEG6hnIrcZjp3HUjN4LIp53WJ0S5ceA/exec";
var MIN_VOCAB_RUBY_LENGTH = 2;
var vocabularyRubyEntries = null;

function getApiUrl() {
  return GAS_BASE_URL + "?_t=" + Date.now();
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
  return (item && (item.word || item.w) || "").trim();
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
    return b.end - b.start - (a.end - a.start);
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

  var entries = vocabularyRubyEntries || [];
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
    rubyEl.appendChild(document.createTextNode(m.word));
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

function fillWithRuby(el, text) {
  appendTextWithVocabularyRuby(el, text);
}

function renderQuestions(data) {
  var root = document.getElementById("questionList");
  root.textContent = "";

  var questions = (data && data.questions) || [];
  if (!questions.length) {
    var empty = document.createElement("p");
    empty.className = "error";
    empty.textContent = "問題がありません。";
    root.appendChild(empty);
    return;
  }

  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var card = document.createElement("article");
    card.className = "question-card";
    card.id = "q-" + q.id;

    var meta = document.createElement("div");
    meta.className = "meta-row";

    var idBadge = document.createElement("span");
    idBadge.className = "badge";
    idBadge.textContent = "第" + q.round + "回・問" + q.number;
    meta.appendChild(idBadge);

    if (q.subject) {
      var subBadge = document.createElement("span");
      subBadge.className = "badge badge-subject";
      subBadge.textContent = q.subject;
      meta.appendChild(subBadge);
    }
    card.appendChild(meta);

    var stem = document.createElement("div");
    stem.className = "stem";
    var bodyLines = q.body || [];
    for (var b = 0; b < bodyLines.length; b++) {
      var line = bodyLines[b];
      if (!line || !String(line).trim()) {
        continue;
      }
      var p = document.createElement("p");
      fillWithRuby(p, line);
      stem.appendChild(p);
    }
    card.appendChild(stem);

    var ul = document.createElement("ol");
    ul.className = "choices";
    ul.start = 1;
    var choices = q.choices || [];
    for (var c = 0; c < choices.length; c++) {
      var choice = choices[c];
      var li = document.createElement("li");
      li.className = "choice";

      var n = document.createElement("span");
      n.className = "choice-n";
      n.textContent = String(choice.n);
      li.appendChild(n);

      var text = document.createElement("span");
      text.className = "choice-text";
      fillWithRuby(text, choice.text || "");
      li.appendChild(text);

      ul.appendChild(li);
    }
    card.appendChild(ul);

    var expl = document.createElement("div");
    expl.className = "explanation";
    var explLabel = document.createElement("p");
    explLabel.className = "explanation-label";
    explLabel.textContent = "解説";
    expl.appendChild(explLabel);
    var explBody = document.createElement("p");
    explBody.className = "explanation-body";
    if (q.explanation && String(q.explanation).trim()) {
      fillWithRuby(explBody, String(q.explanation).trim());
    } else {
      explBody.classList.add("is-empty");
      explBody.textContent = "（準備中）";
    }
    expl.appendChild(explBody);
    card.appendChild(expl);

    root.appendChild(card);
  }
}

function showError(message) {
  var root = document.getElementById("questionList");
  root.textContent = "";
  var p = document.createElement("p");
  p.className = "error";
  p.textContent = message;
  root.appendChild(p);
}

function boot() {
  Promise.all([
    fetch("questions.json?_t=" + Date.now()).then(function (res) {
      if (!res.ok) {
        throw new Error("questions.json の読み込みに失敗しました");
      }
      return res.json();
    }),
    fetch(getApiUrl())
      .then(function (res) {
        return res.json();
      })
      .then(function (payload) {
        var words = (payload && payload.allWords) || [];
        return words.map(normalizeWordItem);
      })
      .catch(function () {
        return [];
      })
  ])
    .then(function (results) {
      var data = results[0];
      var words = results[1];
      vocabularyRubyEntries = null;
      getVocabularyRubyEntries(words);
      renderQuestions(data);
    })
    .catch(function (err) {
      showError(err && err.message ? err.message : "読み込みに失敗しました");
    });
}

boot();
