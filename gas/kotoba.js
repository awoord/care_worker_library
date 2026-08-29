// @ts-nocheck
// ==========================================================
// 「ことば」シート（通信遅延吸収・重複防止版）
// ==========================================================

var GOAL_MAP = {
    "基本": [200, 250, 300, 400, 500, 600, 700, 750, 800],
    "介護": [70, 100, 150, 200, 250, 300],
    "医療": [80, 100, 130, 170, 210, 250],
    "社会": [50, 75, 100, 125, 150]
  };
  
  var RETURN_INTERVAL = 20;
  
  function createSingleWordSheet() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dbSheet = ss.getSheetByName("db");
  
    if (!dbSheet) return;
  
    if (dbSheet.getRange("J1").getValue() !== "学習日") {
      dbSheet.getRange("J1").setValue("学習日");
    }
  
    var sheetName = "ことば";
    var catNames = ["基本", "介護", "医療", "社会"];
  
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
  
    // 既存のシート保護をすべて解除
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var p = 0; p < protections.length; p++) {
      protections[p].remove();
    }
    var rangeProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    for (var rp = 0; rp < rangeProtections.length; rp++) {
      rangeProtections[rp].remove();
    }
  
    var curMaxR = sheet.getMaxRows();
    var curMaxC = sheet.getMaxColumns();
    if (curMaxR > 0) sheet.showRows(1, curMaxR);
    if (curMaxC > 0) sheet.showColumns(1, curMaxC);
  
    if (curMaxR > 0 && curMaxC > 0) {
      sheet.getRange(1, 1, curMaxR, curMaxC).clearDataValidations();
    }
    sheet.clear();
    sheet.clearFormats();
    sheet.setConditionalFormatRules([]);
    sheet.setHiddenGridlines(true);
  
    var dbLastRow = dbSheet.getLastRow();
    if (dbLastRow < 2) return;
  
    var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, 10).getValues();
  
    var totalRequiredRows = 93;
    var targetCols = 5;
  
    if (sheet.getMaxColumns() > targetCols) {
      sheet.deleteColumns(targetCols + 1, sheet.getMaxColumns() - targetCols);
    } else if (sheet.getMaxColumns() < targetCols) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), targetCols - sheet.getMaxColumns());
    }
  
    if (sheet.getMaxRows() > totalRequiredRows) {
      sheet.deleteRows(totalRequiredRows + 1, sheet.getMaxRows() - totalRequiredRows);
    } else if (sheet.getMaxRows() < totalRequiredRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), totalRequiredRows - sheet.getMaxRows());
    }
  
    // 列幅の設定
    sheet.setColumnWidth(1, 30);   // A列（左余白）
    sheet.setColumnWidth(2, 130);  // B列（更新ボタン / チェックボックス）
    sheet.setColumnWidth(3, 620);  // C列（見出し・単語）
    sheet.setColumnWidth(4, 440);  // D列（英語）
    sheet.setColumnWidth(5, 40);   // E列（右余白）
  
    sheet.getRange(1, 1, totalRequiredRows, 5).setBackground("#FFFFFF");
    sheet.setRowHeight(1, 30);     // 1行目：上余白
  
    var checkA1List = [];
  
    for (var k = 0; k < catNames.length; k++) {
      var cat = catNames[k];
      var currentClearCount = 0;
      var totalCatWordsInDb = 0;
      for (var d = 0; d < dbData.length; d++) {
        if (getCategory(dbData[d][3]) === cat && dbData[d][1]) {
          totalCatWordsInDb++;
          if (dbData[d][8] === true) {
            currentClearCount++;
          }
        }
      }
  
      var chunkData = getCategoryChunk(dbData, cat, currentClearCount, []);
  
      var headerRow = 2 + (k * 23);
      var cardStartRow = headerRow + 2;
  
      var themeColor = "#1976D2";
      var themeBg = "#E3F2FD";
      if (cat === "介護") { themeColor = "#00893E"; themeBg = "#E8F5E9"; }
      else if (cat === "医療") { themeColor = "#C62828"; themeBg = "#FFEBEE"; }
      else if (cat === "社会") { themeColor = "#8E24AA"; themeBg = "#F3E5F5"; }
  
      sheet.setRowHeight(headerRow, 140);
      
      var updateBtn = sheet.getRange("B" + headerRow);
      updateBtn.insertCheckboxes().setValue(false)
               .setBackground(themeBg)
               .setFontColor(themeColor)
               .setFontSize(38)
               .setHorizontalAlignment("center")
               .setVerticalAlignment("middle");
  
      sheet.getRange("E" + headerRow).clearDataValidations().setValue("").setBackground("#FFFFFF");
  
      var titleRange = sheet.getRange("C" + headerRow + ":D" + headerRow);
      titleRange.merge().setBackground(themeBg).setBorder(false, false, false, false, false, false);
  
      if (totalCatWordsInDb === 0) {
        titleRange.setValue(cat + "： 単語データを準備中");
      } else {
        var headerFormula = generateHeaderFormula(cat, k, chunkData);
        titleRange.setFormula(headerFormula);
      }
      titleRange.setHorizontalAlignment("left").setVerticalAlignment("middle")
                .setFontColor(themeColor).setFontSize(40).setFontWeight("bold").setFontFamily("M PLUS 1p");
  
      sheet.setRowHeight(headerRow + 1, 65);
  
      for (var w = 0; w < 5; w++) {
        var wordRow = cardStartRow + (w * 4);
        var gapRow = wordRow + 1;
        var detailRow = wordRow + 2;
        var dividerRow = wordRow + 3;
  
        sheet.setRowHeight(wordRow, 120);
        sheet.setRowHeight(gapRow, 30);
        sheet.setRowHeight(dividerRow, 50);
  
        var bCell = sheet.getRange(wordRow, 2);
        var cCell = sheet.getRange(wordRow, 3);
        var dCell = sheet.getRange(wordRow, 4);
        var detailRange = sheet.getRange(detailRow, 3, 1, 2);
        var detailCell = sheet.getRange(detailRow, 3);
        var eCell = sheet.getRange(wordRow, 5);
  
        cCell.clearDataValidations();
        dCell.clearDataValidations();
        detailCell.clearDataValidations();
        eCell.clearDataValidations().setValue("");
  
        detailRange.mergeAcross();
  
        cCell.setFontSize(40).setFontColor("#333333").setFontWeight("bold")
             .setHorizontalAlignment("left").setVerticalAlignment("middle").setWrap(true).setFontFamily("M PLUS 1p");
  
        dCell.setFontSize(36).setFontColor("#555555").setFontWeight("normal")
             .setHorizontalAlignment("right").setVerticalAlignment("middle").setWrap(true).setFontFamily("M PLUS 1p");
  
        detailCell.setFontSize(36).setFontColor("#333333").setFontWeight("normal")
                  .setVerticalAlignment("middle").setHorizontalAlignment("left").setWrap(true).setFontFamily("M PLUS 1p");
  
        if (w < chunkData.length) {
          var item = chunkData[w];
          var word = cleanText(item[1]);
          var ruby = cleanText(item[4]);
          var english = cleanText(item[5]);
          var meaning = formatMeaning(item[6]);
          var example = formatExample(item[7]);
  
          checkA1List.push("B" + wordRow);
  
          bCell.setBackground("#FFFFFF").setFontColor(themeColor)
               .setFontSize(38).setHorizontalAlignment("center").setVerticalAlignment("middle");
  
          cCell.setValue(word + "(" + ruby + ")");
          dCell.setValue(english);
          detailCell.setValue(meaning + "\n" + example);
  
        } else {
          bCell.setValue("");
          cCell.setValue("");
          dCell.setValue("");
          detailCell.setValue("");
        }
      }
  
      sheet.setRowHeight(headerRow + 22, 60);
    }
  
    if (checkA1List.length > 0) {
      var checkRangeList = sheet.getRangeList(checkA1List);
      checkRangeList.insertCheckboxes();
      checkRangeList.setValue(false);
    }
  
    SpreadsheetApp.flush();
  }
  
  function advanceToNextStage(categoryName, triggerCell) {
    var lock = LockService.getScriptLock();
    var hasLock = false;
  
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("ことば");
    var catNames = ["基本", "介護", "医療", "社会"];
    var catIndex = catNames.indexOf(categoryName);
    var headerRow = 2 + (catIndex * 23);
  
    try {
      hasLock = lock.tryLock(15000);
      if (!hasLock) {
        restoreButtonState(sheet, headerRow, categoryName);
        return;
      }
  
      // 通信遅延対策：端末側の直前のチェックデータがサーバーに反映されるのを待機
      Utilities.sleep(700);
  
      var dbSheet = ss.getSheetByName("db");
      if (!sheet || !dbSheet || catIndex === -1) return;
  
      var dbLastRow = dbSheet.getLastRow();
      if (dbLastRow < 2) {
        restoreButtonState(sheet, headerRow, categoryName);
        return;
      }
  
      var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, 10).getValues();
  
      // 該当カテゴリーの単語一覧を抽出
      var dbCategoryWords = [];
      for (var d = 0; d < dbData.length; d++) {
        if (getCategory(cleanText(dbData[d][3])) === categoryName) {
          dbCategoryWords.push(cleanText(dbData[d][1]));
        }
      }
  
      var cardStartRow = headerRow + 2;
      var checkValues = sheet.getRange(cardStartRow, 2, 19, 1).getValues();
      var cardData = sheet.getRange(cardStartRow, 3, 19, 1).getValues();
  
      var currentScreenWords = [];
      var checkedWords = [];
      var uncheckedWords = [];
  
      // 画面に現在表示されている単語とチェック状態を正確に取得
      for (var i = 0; i < 5; i++) {
        var cellTitle = cardData[i * 4][0];
        var matchedWord = findExactDbWord(cellTitle, dbCategoryWords);
        if (matchedWord) {
          currentScreenWords.push(matchedWord);
          if (checkValues[i * 4][0] === true) {
            checkedWords.push(matchedWord);
          } else {
            uncheckedWords.push(matchedWord);
          }
        }
      }
  
      var updatedStatusAndDates = [];
      var now = new Date();
      var todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
      var currentClearCount = 0;
      for (var c = 0; c < dbData.length; c++) {
        if (getCategory(dbData[c][3]) === categoryName && dbData[c][8] === true) {
          currentClearCount++;
        }
      }
  
      var newClearCount = currentClearCount;
  
      // データベースの学習フラグ（I列）と学習日（J列）を更新
      for (var j = 0; j < dbData.length; j++) {
        var dbWord = cleanText(dbData[j][1]);
        var dbCategory = getCategory(cleanText(dbData[j][3]));
        var isLearned = (dbData[j][8] === true);
        var learnedDate = dbData[j][9];
  
        if (dbCategory === categoryName && checkedWords.indexOf(dbWord) !== -1) {
          if (!isLearned) {
            isLearned = true;
            newClearCount++;
          }
          learnedDate = todayDate;
          dbData[j][8] = true;
          dbData[j][9] = todayDate;
        }
        updatedStatusAndDates.push([isLearned, learnedDate || ""]);
      }
  
      // スキップキューの更新
      var skipQueue = getSkipQueue(categoryName);
  
      for (var cw = 0; cw < checkedWords.length; cw++) {
        skipQueue = skipQueue.filter(function(item) { return item.word !== checkedWords[cw]; });
      }
  
      for (var uw = 0; uw < uncheckedWords.length; uw++) {
        var unWord = uncheckedWords[uw];
        skipQueue = skipQueue.filter(function(item) { return item.word !== unWord; });
        skipQueue.push({
          word: unWord,
          targetCount: newClearCount + RETURN_INTERVAL
        });
      }
  
      saveSkipQueue(categoryName, skipQueue);
  
      if (checkedWords.length > 0) {
        dbSheet.getRange(2, 9, updatedStatusAndDates.length, 2).setValues(updatedStatusAndDates);
      }
  
      // 次の単語データを取得（直前単語 currentScreenWords を確実に除外）
      var nextChunk = getCategoryChunk(dbData, categoryName, newClearCount, currentScreenWords);
  
      // 画面に砂時計を表示
      showLoadingState(sheet, headerRow, cardStartRow);
      Utilities.sleep(150);
  
      // 画面を次の単語に更新
      updateSingleCategoryArea(sheet, catIndex, nextChunk, categoryName);
      SpreadsheetApp.flush();
  
    } catch (err) {
      // エラー時も安全に画面を復元
      try {
        var fallbackDb = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("db");
        if (fallbackDb) {
          var fbData = fallbackDb.getRange(2, 1, fallbackDb.getLastRow() - 1, 10).getValues();
          var fbChunk = getCategoryChunk(fbData, categoryName, 0, []);
          updateSingleCategoryArea(SpreadsheetApp.getActiveSpreadsheet().getSheetByName("ことば"), catIndex, fbChunk, categoryName);
        }
      } catch (e2) {
        restoreButtonState(sheet, headerRow, categoryName);
      }
    } finally {
      if (hasLock) {
        lock.releaseLock();
      }
    }
  }
  
  function findExactDbWord(cellValue, dbWords) {
    if (!cellValue) return "";
    var text = cellValue.toString().trim();
    for (var i = 0; i < dbWords.length; i++) {
      var w = dbWords[i];
      if (text.indexOf(w) === 0) {
        return w;
      }
    }
    var match = text.match(/^([^\(（\s]+)/);
    if (match) return match[1].trim();
    return text;
  }
  
  function restoreButtonState(sheet, headerRow, categoryName) {
    if (!sheet) return;
    var themeColor = "#1976D2";
    var themeBg = "#E3F2FD";
    if (categoryName === "介護") { themeColor = "#00893E"; themeBg = "#E8F5E9"; }
    else if (categoryName === "医療") { themeColor = "#C62828"; themeBg = "#FFEBEE"; }
    else if (categoryName === "社会") { themeColor = "#8E24AA"; themeBg = "#F3E5F5"; }
  
    var btnCell = sheet.getRange("B" + headerRow);
    btnCell.insertCheckboxes().setValue(false)
           .setBackground(themeBg)
           .setFontColor(themeColor)
           .setFontSize(38)
           .setHorizontalAlignment("center")
           .setVerticalAlignment("middle");
    SpreadsheetApp.flush();
  }
  
  function showLoadingState(sheet, headerRow, cardStartRow) {
    var btnCell = sheet.getRange("B" + headerRow);
    btnCell.clearDataValidations().setValue("⏳");
  
    var titleRange = sheet.getRange("C" + headerRow + ":D" + headerRow);
    var currentTitleText = titleRange.getValue();
    titleRange.setValue(currentTitleText);
  
    for (var i = 0; i < 5; i++) {
      var wordRow = cardStartRow + (i * 4);
      var detailRow = wordRow + 2;
  
      sheet.getRange(wordRow, 2).clearDataValidations().setValue("");
      sheet.getRange(wordRow, 3).setValue("");
      sheet.getRange(wordRow, 4).setValue("");
      sheet.getRange(detailRow, 3).setValue("");
    }
    SpreadsheetApp.flush();
  }
  
  function updateSingleCategoryArea(sheet, catIndex, chunkData, category) {
    var headerRow = 2 + (catIndex * 23);
    var cardStartRow = headerRow + 2;
  
    var themeColor = "#1976D2";
    var themeBg = "#E3F2FD";
    if (category === "介護") { themeColor = "#00893E"; themeBg = "#E8F5E9"; }
    else if (category === "医療") { themeColor = "#C62828"; themeBg = "#FFEBEE"; }
    else if (category === "社会") { themeColor = "#8E24AA"; themeBg = "#F3E5F5"; }
  
    var updateBtn = sheet.getRange("B" + headerRow);
    updateBtn.insertCheckboxes().setValue(false)
             .setBackground(themeBg)
             .setFontColor(themeColor)
             .setFontSize(38)
             .setHorizontalAlignment("center")
             .setVerticalAlignment("middle");
  
    var titleRange = sheet.getRange("C" + headerRow + ":D" + headerRow);
    var headerFormula = generateHeaderFormula(category, catIndex, chunkData);
    titleRange.setFormula(headerFormula);
  
    var checkA1List = [];
  
    for (var i = 0; i < 5; i++) {
      var wordRow = cardStartRow + (i * 4);
      var detailRow = wordRow + 2;
  
      var bCell = sheet.getRange(wordRow, 2);
      var cCell = sheet.getRange(wordRow, 3);
      var dCell = sheet.getRange(wordRow, 4);
      var detailCell = sheet.getRange(detailRow, 3);
  
      if (i < chunkData.length) {
        var item = chunkData[i];
        var word = cleanText(item[1]);
        var ruby = cleanText(item[4]);
        var english = cleanText(item[5]);
        var meaning = formatMeaning(item[6]);
        var example = formatExample(item[7]);
  
        checkA1List.push("B" + wordRow);
  
        bCell.setBackground("#FFFFFF").setFontColor(themeColor)
             .setFontSize(38).setHorizontalAlignment("center").setVerticalAlignment("middle");
  
        cCell.setValue(word + "(" + ruby + ")");
        dCell.setValue(english);
        detailCell.setValue(meaning + "\n" + example);
      } else {
        bCell.clearDataValidations().setValue("");
        cCell.setValue("");
        dCell.setValue("");
        detailCell.setValue("");
      }
    }
  
    if (checkA1List.length > 0) {
      var checkRangeList = sheet.getRangeList(checkA1List);
      checkRangeList.insertCheckboxes();
      checkRangeList.setValue(false);
    }
  }
  
  function generateHeaderFormula(cat, catIndex, chunkData) {
    var goals = GOAL_MAP[cat] || [100, 200, 300, 400];
    var curTargetFormula = buildTargetFormula(goals);
    var nextTargetFormula = buildNextTargetFormula(goals);
  
    var headerRow = 2 + (catIndex * 23);
    var cardStartRow = headerRow + 2;
    
    var unlearnedWordCells = [];
    for (var w = 0; w < chunkData.length; w++) {
      var isLearned = (chunkData[w][8] === true);
      if (!isLearned) {
        unlearnedWordCells.push("B" + (cardStartRow + (w * 4)));
      }
    }
  
    var sumFormula = unlearnedWordCells.length > 0 ? "(" + unlearnedWordCells.join("+") + ")" : "0";
    var unlearnedWordCount = unlearnedWordCells.length;
  
    var reward = getRandomClearReward();
    var threeReward = getRandomThreeReward();
  
    return '=LET(' +
      '  chkCnt, ' + sumFormula + ', ' +
      '  dbCnt, COUNTIFS(db!D2:D, "*' + cat + '*", db!I2:I, TRUE), ' +
      '  unlearnedCnt, COUNTIFS(db!D2:D, "*' + cat + '*", db!I2:I, "<>TRUE", db!B2:B, "<>"), ' +
      '  totalInDb, COUNTIFS(db!D2:D, "*' + cat + '*", db!B2:B, "<>"), ' +
      '  catTotal, dbCnt + chkCnt, ' +
      '  rawCurTarget, ' + curTargetFormula + ', ' +
      '  rawNextTarget, ' + nextTargetFormula + ', ' +
      '  curTarget, MIN(rawCurTarget, totalInDb), ' +
      '  nextTarget, MIN(rawNextTarget, totalInDb), ' +
      '  rem, MAX(0, nextTarget - catTotal), ' +
      '  mainText, "' + cat + '： " & catTotal & " / " & nextTarget & " 語 （あと " & rem & " 語）", ' +
      '  IF(unlearnedCnt = 0, ' +
      '    "' + cat + '： 全 " & dbCnt & " 語 復習中 🔄", ' +
      '    IF(AND(catTotal = curTarget, curTarget > dbCnt, curTarget > 0), ' +
      '      "' + cat + '  " & curTarget & "語  Clear!!  ' + threeReward + '", ' +
      '      IF(AND(chkCnt >= ' + unlearnedWordCount + ', ' + unlearnedWordCount + ' > 0), ' +
      '        mainText & "  ' + reward + '", ' +
      '        mainText' +
      '      )' +
      '    )' +
      '  )' +
      ')';
  }
  
  function getCategoryChunk(dbData, categoryName, currentClearCount, excludeWords) {
    excludeWords = excludeWords || [];
    var skipQueue = getSkipQueue(categoryName);
    var unlearnedList = [];
    var learnedList = [];
    var unlearnedMap = {};
  
    for (var i = 0; i < dbData.length; i++) {
      var word = cleanText(dbData[i][1]);
      var cat = getCategory(cleanText(dbData[i][3]));
      var isLearned = (dbData[i][8] === true);
  
      if (cat === categoryName && word) {
        if (!isLearned) {
          unlearnedList.push(dbData[i]);
          unlearnedMap[word] = dbData[i];
        } else {
          learnedList.push(dbData[i]);
        }
      }
    }
  
    if (unlearnedList.length === 0 && learnedList.length === 0) return [];
  
    // 全単語学習済み（復習モード）
    if (unlearnedList.length === 0) {
      learnedList.sort(function(a, b) {
        var dateA = a[9] ? new Date(a[9]).getTime() : 0;
        var dateB = b[9] ? new Date(b[9]).getTime() : 0;
        return dateA - dateB;
      });
  
      if (excludeWords.length > 0 && learnedList.length > excludeWords.length) {
        var notShown = [];
        var justShown = [];
        for (var l = 0; l < learnedList.length; l++) {
          var wName = cleanText(learnedList[l][1]);
          if (excludeWords.indexOf(wName) === -1) {
            notShown.push(learnedList[l]);
          } else {
            justShown.push(learnedList[l]);
          }
        }
        learnedList = notShown.concat(justShown);
      }
      return learnedList.slice(0, 5);
    }
  
    // 1. スキップ待機解除された復習候補
    var readyReviewWords = [];
    var waitingSkipWords = [];
  
    for (var s = 0; s < skipQueue.length; s++) {
      var item = skipQueue[s];
      if (unlearnedMap[item.word]) {
        if (item.targetCount <= currentClearCount) {
          if (excludeWords.indexOf(item.word) === -1) {
            readyReviewWords.push(unlearnedMap[item.word]);
          }
        } else {
          waitingSkipWords.push(item.word);
        }
      }
    }
  
    // 2. まだ一度も出ていない新規単語（直前単語を除外）
    var freshNewWords = [];
    for (var u = 0; u < unlearnedList.length; u++) {
      var uWord = cleanText(unlearnedList[u][1]);
      if (waitingSkipWords.indexOf(uWord) === -1 && 
          readyReviewWords.indexOf(unlearnedList[u]) === -1 &&
          excludeWords.indexOf(uWord) === -1) {
        freshNewWords.push(unlearnedList[u]);
      }
    }
  
    var resultChunk = [];
  
    // 復習単語（最大2語）
    while (readyReviewWords.length > 0 && resultChunk.length < 2) {
      resultChunk.push(readyReviewWords.shift());
    }
  
    // 新規単語（最大5語まで補充）
    while (freshNewWords.length > 0 && resultChunk.length < 5) {
      resultChunk.push(freshNewWords.shift());
    }
  
    // 残りの復習単語を補充
    while (readyReviewWords.length > 0 && resultChunk.length < 5) {
      resultChunk.push(readyReviewWords.shift());
    }
  
    // 新規単語が尽きた場合：待機中のスキップ単語から直前単語以外を前倒し補充
    if (resultChunk.length < 5) {
      for (var wIdx = 0; wIdx < waitingSkipWords.length; wIdx++) {
        var waitWord = waitingSkipWords[wIdx];
        if (unlearnedMap[waitWord] && 
            resultChunk.indexOf(unlearnedMap[waitWord]) === -1 && 
            excludeWords.indexOf(waitWord) === -1) {
          resultChunk.push(unlearnedMap[waitWord]);
          if (resultChunk.length === 5) break;
        }
      }
    }
  
    // それでも足りない場合：未学習単語から直前単語以外を補充
    if (resultChunk.length < 5) {
      for (var r = 0; r < unlearnedList.length; r++) {
        var rWord = cleanText(unlearnedList[r][1]);
        if (resultChunk.indexOf(unlearnedList[r]) === -1 && excludeWords.indexOf(rWord) === -1) {
          resultChunk.push(unlearnedList[r]);
          if (resultChunk.length === 5) break;
        }
      }
    }
  
    // それでも足りない場合：学習済み単語から古い順に補充
    if (resultChunk.length < 5 && learnedList.length > 0) {
      learnedList.sort(function(a, b) {
        var dateA = a[9] ? new Date(a[9]).getTime() : 0;
        var dateB = b[9] ? new Date(b[9]).getTime() : 0;
        return dateA - dateB;
      });
      for (var l2 = 0; l2 < learnedList.length; l2++) {
        var lWord = cleanText(learnedList[l2][1]);
        if (resultChunk.indexOf(learnedList[l2]) === -1 && excludeWords.indexOf(lWord) === -1) {
          resultChunk.push(learnedList[l2]);
          if (resultChunk.length === 5) break;
        }
      }
    }
  
    // 全単語数が5語未満の場合のみ直前単語も含めて全件表示
    if (resultChunk.length < 5) {
      for (var fb = 0; fb < unlearnedList.length; fb++) {
        if (resultChunk.indexOf(unlearnedList[fb]) === -1) {
          resultChunk.push(unlearnedList[fb]);
          if (resultChunk.length === 5) break;
        }
      }
    }
  
    return resultChunk;
  }
  
  function getSkipQueue(categoryName) {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty("SKIP_QUEUE_" + categoryName);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch(e) {
      return [];
    }
  }
  
  function saveSkipQueue(categoryName, queue) {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("SKIP_QUEUE_" + categoryName, JSON.stringify(queue));
  }
  
  function buildTargetFormula(goals) {
    if (!goals || goals.length === 0) return "100";
    var formula = goals[goals.length - 1].toString();
    for (var i = goals.length - 2; i >= 0; i--) {
      formula = "IF(dbCnt < " + goals[i] + ", " + goals[i] + ", " + formula + ")";
    }
    return formula;
  }
  
  function buildNextTargetFormula(goals) {
    if (!goals || goals.length === 0) return "100";
    var formula = goals[goals.length - 1].toString();
    for (var i = goals.length - 2; i >= 0; i--) {
      formula = "IF(catTotal <= " + goals[i] + ", " + goals[i] + ", " + formula + ")";
    }
    return formula;
  }
  
  function getRandomClearReward() {
    var rand = Math.random() * 100;
    if (rand < 25) {
      var twoList = ["🔥🔥", "🎉🎉", "🎁🎁", "🎈🎈"];
      return twoList[Math.floor(Math.random() * twoList.length)];
    } else {
      var oneList = ["✌️", "👍", "👏", "😎", "🥹", "🥳"];
      return oneList[Math.floor(Math.random() * oneList.length)];
    }
  }
  
  function getRandomThreeReward() {
    var threeList = ["🥇🥇🥇", "💎💎💎", "👑👑👑"];
    return threeList[Math.floor(Math.random() * threeList.length)];
  }
  
  function extractWordFromTitle(title) {
    if (!title) return "";
    var text = title.toString().trim();
    var match = text.match(/^([^\(（\s]+)/);
    if (match) return match[1].trim();
    return text;
  }
  
  function getCategory(rawCategory) {
    var text = cleanText(rawCategory);
    if (text.indexOf("介護") !== -1) return "介護";
    if (text.indexOf("医療") !== -1) return "医療";
    if (text.indexOf("社会") !== -1) return "社会";
    return "基本";
  }
  
  function cleanText(text) {
    return text ? text.toString().trim() : "";
  }
  
  function formatMeaning(text) {
    var cleaned = cleanText(text);
    if (!cleaned) return "";
    return cleaned.replace(/。/g, ". ");
  }
  
  function formatExample(text) {
    var cleaned = cleanText(text);
    if (!cleaned) return "";
    cleaned = cleaned.replace(/。/g, "");
    if (cleaned.startsWith("「") && cleaned.endsWith("」")) return cleaned;
    return "「" + cleaned + "」";
  }
