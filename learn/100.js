// ==========================================================
// 単語シート生成・ステージ進行（1問ずつ生成演出版）
// ==========================================================

// ------------------------------------------
// 1. 初回起動時や全体リセット時に全シートを構築する関数
// ------------------------------------------
function createFlashCardsByCategories() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var originalSheet = ss.getActiveSheet();
    var dbSheet = ss.getSheetByName("db");
  
    if (!dbSheet) return;
  
    var searchSheetName = "調";
    var studySheetName = "覚";
    var catNames = ["基本", "介護", "医療", "社会"];
    var allowedSheets = ["db", studySheetName, searchSheetName].concat(catNames);
  
    var savedCheckStates = {};
    var allSheets = ss.getSheets();
  
    for (var s = 0; s < allSheets.length; s++) {
      var currentSheet = allSheets[s];
      var currentName = currentSheet.getName();
  
      if (catNames.indexOf(currentName) === -1) continue;
  
      var lastRow = currentSheet.getLastRow();
      if (lastRow < 4) continue;
  
      var bValues = currentSheet.getRange(4, 2, lastRow - 3, 1).getValues();
      var cValues = currentSheet.getRange(4, 3, lastRow - 3, 1).getDisplayValues();
  
      for (var r = 0; r < bValues.length; r++) {
        if (bValues[r][0] !== true) continue;
        var title = cValues[r][0];
        var word = extractWordFromTitle(title);
        if (word) savedCheckStates[word] = true;
      }
    }
  
    var dbLastRow = dbSheet.getLastRow();
    if (dbLastRow < 2) return;
  
    var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, 9).getValues();
    var categorizedData = { "基本": [], "介護": [], "医療": [], "社会": [] };
    var learnedCounts = { "基本": 0, "介護": 0, "医療": 0, "社会": 0 };
  
    for (var i = 0; i < dbData.length; i++) {
      var word = cleanText(dbData[i][1]);
      var rawCategory = cleanText(dbData[i][3]);
      var isLearned = dbData[i][8] === true;
  
      if (!word) continue;
  
      var category = getCategory(rawCategory);
  
      if (isLearned) {
        learnedCounts[category]++;
      } else {
        categorizedData[category].push(dbData[i]);
      }
    }
  
    for (var k = 0; k < catNames.length; k++) {
      var cat = catNames[k];
      var unlearnedData = categorizedData[cat];
      var chunkData = unlearnedData.slice(0, 5);
      var wordCount = chunkData.length;
      var stageNum = Math.floor(learnedCounts[cat] / 5) + 1;
  
      var tabColor = "#1976D2";
      var themeBg = "#E3F2FD";
      if (cat === "介護") { tabColor = "#00893E"; themeBg = "#E8F5E9"; }
      else if (cat === "医療") { tabColor = "#E53935"; themeBg = "#FFEBEE"; }
      else if (cat === "社会") { tabColor = "#8E24AA"; themeBg = "#F3E5F5"; }
  
      var targetSheet = ss.getSheetByName(cat);
      if (!targetSheet) targetSheet = ss.insertSheet(cat);
  
      targetSheet.showSheet();
      targetSheet.setTabColor(tabColor);
  
      applyStageDataToSheet(targetSheet, chunkData, savedCheckStates, cat, stageNum, wordCount, tabColor, themeBg);
    }
  
    alignAllSheetsOrder();
  
    if (originalSheet) {
      var restored = ss.getSheetByName(originalSheet.getName());
      if (restored) ss.setActiveSheet(restored);
    }
  
    SpreadsheetApp.flush();
  }
  
  // ------------------------------------------
  // 2. ステージ進行処理（該当カテゴリーのみピンポイント更新）
  // ------------------------------------------
  function advanceToNextStage(categoryName) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(categoryName);
    var dbSheet = ss.getSheetByName("db");
  
    if (!sheet || !dbSheet) return;
  
    var targetRows = [4, 7, 10, 13, 16];
    var words = [];
  
    for (var i = 0; i < targetRows.length; i++) {
      var row = targetRows[i];
      var checked = sheet.getRange(row, 2).getValue();
      var title = sheet.getRange(row, 3).getDisplayValue();
  
      if (checked !== true) continue;
  
      var word = extractWordFromTitle(title);
      if (word) words.push(word);
    }
  
    if (words.length === 0) return;
  
    var dbLastRow = dbSheet.getLastRow();
    if (dbLastRow < 2) return;
  
    var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, 9).getValues();
    var categorizedUnlearned = { "基本": [], "介護": [], "医療": [], "社会": [] };
    var learnedCounts = { "基本": 0, "介護": 0, "医療": 0, "社会": 0 };
  
    for (var j = 0; j < dbData.length; j++) {
      var dbWord = cleanText(dbData[j][1]);
      if (!dbWord) continue;
  
      var dbCategory = getCategory(cleanText(dbData[j][3]));
      var isLearned = (dbData[j][8] === true);
  
      if (words.indexOf(dbWord) !== -1 && dbCategory === categoryName) {
        isLearned = true;
        dbData[j][8] = true;
        dbSheet.getRange(j + 2, 9).setValue(true);
      }
  
      if (isLearned) {
        learnedCounts[dbCategory]++;
      } else {
        categorizedUnlearned[dbCategory].push(dbData[j]);
      }
    }
  
    var nextChunk = categorizedUnlearned[categoryName].slice(0, 5);
    var nextStageNum = Math.floor(learnedCounts[categoryName] / 5) + 1;
    
    // 単語シートを1問ずつ生成演出付きで更新
    updateSingleCategoryContent(sheet, nextChunk, categoryName, nextStageNum);
  
    // 「覚」シートの更新
    updateStudySheetCategory(categoryName, nextChunk);
  
    SpreadsheetApp.flush();
  }
  
  // ------------------------------------------
  // 3. 単一単語シートの文字・数式上書き関数（1問ずつ生成演出）
  // ------------------------------------------
  function updateSingleCategoryContent(sheet, chunkData, category, stageNum) {
    var wordCount = chunkData.length;
    var themeColor = "#1976D2";
    var themeBg = "#E3F2FD";
    if (category === "介護") { themeColor = "#00893E"; themeBg = "#E8F5E9"; }
    else if (category === "医療") { themeColor = "#E53935"; themeBg = "#FFEBEE"; }
    else if (category === "社会") { themeColor = "#8E24AA"; themeBg = "#F3E5F5"; }
  
    // 2行目の背景色とD2・C2の更新
    sheet.getRange("B2:D2").setBackground(themeBg)
         .setBorder(false, false, false, false, false, false);
  
    var c2Cell = sheet.getRange("C2");
    if (wordCount === 0) {
      c2Cell.setValue("All Clear 🎉🎉");
    } else {
      c2Cell.setFormula(
        '=IF(COUNTIF(B4:B18, TRUE) >= ' + wordCount +
        ', "Clear 🎉     次へ進む  → →  ", "' +
        category + ' #' + stageNum + ' （ " & COUNTIF(B4:B18, TRUE) & " / ' + wordCount + ' ）")'
      );
    }
    c2Cell.setFontColor(themeColor).setBackground(themeBg);
  
    var d2Cell = sheet.getRange("D2");
    d2Cell.clearDataValidations().clearContent().setFontSize(9).setFontColor("#E65100").setBackground(themeBg);
    var dbLast = sheet.getParent().getSheetByName("db").getLastRow();
    var totalCalc = '(COUNTIF(db!I2:I' + dbLast + ', TRUE) + COUNTIF(\'基本\'!B4:B18, TRUE) + COUNTIF(\'介護\'!B4:B18, TRUE) + COUNTIF(\'医療\'!B4:B18, TRUE) + COUNTIF(\'社会\'!B4:B18, TRUE))';
    d2Cell.setFormula('="⭐️" & ' + totalCalc);
  
    // 【演出ステップ1】一旦すべての単語セルを消去して画面を白紙に戻す
    for (var clearIdx = 0; clearIdx < 5; clearIdx++) {
      var clearRow = (clearIdx * 3) + 4;
      sheet.getRange(clearRow, 2).setValue(false);
      sheet.getRange(clearRow, 3).setValue("");
      sheet.getRange(clearRow + 1, 3).setValue("");
    }
    SpreadsheetApp.flush();
    Utilities.sleep(150); // 消去後の間（0.15秒）
  
    // 【演出ステップ2】上から1問ずつ順番に書き込んで画面に表示する
    for (var i = 0; i < 5; i++) {
      var row = (i * 3) + 4;
      var bCell = sheet.getRange(row, 2);
      var cCell = sheet.getRange(row, 3);
      var detailCell = sheet.getRange(row + 1, 3);
  
      if (i < chunkData.length) {
        var item = chunkData[i];
        var word = cleanText(item[1]);
        var ruby = cleanText(item[4]);
        var english = cleanText(item[5]);
        var meaning = formatMeaning(item[6]);
        var example = formatExample(item[7]);
        var number = i + 1;
  
        bCell.setValue(false).setFontColor("#1A73E8");
  
        var titleBase = number + ". " + word + "（" + ruby + "）";
        var titleWithEn = titleBase + "  " + english;
        var titleFormula = '=IF(B' + row + '=TRUE, "' + escapeFormulaText(titleWithEn) + '", "' + escapeFormulaText(titleBase) + '")';
        cCell.setFormula(titleFormula);
  
        var detailFormula = '=IF(B' + row + '=TRUE, "' + escapeFormulaText(meaning) + '" & CHAR(10) & "' + escapeFormulaText(example) + '", "")';
        detailCell.setFormula(detailFormula);
  
        // 1問書くごとに画面を更新して0.2秒待機
        SpreadsheetApp.flush();
        Utilities.sleep(200);
      } else {
        bCell.setValue("").clearDataValidations();
        cCell.setValue("");
        detailCell.setValue("");
      }
    }
  }
  
  // ------------------------------------------
  // 4. 「覚」シートの特定カテゴリーのみ高速上書き関数
  // ------------------------------------------
  function updateStudySheetCategory(categoryName, chunkData) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("覚");
    if (!sheet) return;
  
    var catNames = ["基本", "介護", "医療", "社会"];
    var catIndex = catNames.indexOf(categoryName);
    if (catIndex === -1) return;
  
    var cardStartRow = 3 + (catIndex * 7);
    var chunk = chunkData.slice();
    shuffleArray(chunk);
  
    for (var w = 0; w < 5; w++) {
      var currentRow = cardStartRow + w;
      var bCell = sheet.getRange(currentRow, 2);
      var cCell = sheet.getRange(currentRow, 3);
  
      if (w < chunk.length) {
        var item = chunk[w];
        var wordText = cleanText(item[1]);
        var rubyText = cleanText(item[4]);
        var enText = cleanText(item[5]);
        var meaningText = formatMeaning(item[6]);
        var exampleText = formatExample(item[7]);
  
        var cardText = "\n" +
                       wordText + "（" + rubyText + "）  " + enText + "\n" +
                       meaningText + "\n" +
                       exampleText + "\n ";
  
        bCell.setValue("\n▪");
        cCell.setValue(cardText);
      } else {
        bCell.setValue("");
        cCell.setValue("");
      }
    }
  
    SpreadsheetApp.flush();
    sheet.autoResizeRows(cardStartRow, 5);
    for (var h = 0; h < 5; h++) {
      var targetRow = cardStartRow + h;
      var autoHeight = sheet.getRowHeight(targetRow);
      sheet.setRowHeight(targetRow, Math.max(78, autoHeight - 20));
    }
  }
  
  // ------------------------------------------
  // 5. 初回描画用の完全設定関数
  // ------------------------------------------
  function applyStageDataToSheet(sheet, data, savedCheckStates, category, stageNum, wordCount, themeColor, themeBg) {
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var p = 0; p < protections.length; p++) {
      protections[p].remove();
    }
  
    var curMaxR = sheet.getMaxRows();
    var curMaxC = sheet.getMaxColumns();
    if (curMaxR > 0 && curMaxC > 0) {
      sheet.getRange(1, 1, curMaxR, curMaxC).clearDataValidations();
    }
  
    sheet.clear();
    sheet.clearFormats();
    sheet.setConditionalFormatRules([]);
    sheet.setHiddenGridlines(true);
  
    var actualRows = data.length * 3;
    var requiredRows = 3 + actualRows;
  
    if (sheet.getMaxRows() < requiredRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
    }
    if (sheet.getMaxColumns() < 5) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), 5 - sheet.getMaxColumns());
    }
    if (sheet.getMaxRows() > requiredRows) {
      sheet.deleteRows(requiredRows + 1, sheet.getMaxRows() - requiredRows);
    }
    if (sheet.getMaxColumns() > 5) {
      sheet.deleteColumns(6, sheet.getMaxColumns() - 5);
    }
  
    sheet.setColumnWidth(1, 10);
    sheet.setColumnWidth(3, 187);
    sheet.setColumnWidth(4, 45);
    sheet.setColumnWidth(5, 10);
  
    sheet.setRowHeight(1, 12);
    sheet.setRowHeight(2, 28);
    sheet.setRowHeight(3, 12);
    sheet.getRange(3, 1, 1, 5).setBackground("#FFFFFF");
  
    var checkA1List = [];
    var cardA1List = [];
    var editableRanges = [sheet.getRange("D2")];
    var checkedCount = 0;
  
    for (var i = 0; i < data.length; i++) {
      var word = cleanText(data[i][1]);
      if (savedCheckStates[word] === true) checkedCount++;
    }
  
    sheet.getRange("B2:D2").setBackground(themeBg)
         .setBorder(false, false, false, false, false, false);
  
    var c2Cell = sheet.getRange("C2");
    if (wordCount === 0) {
      c2Cell.setValue("All Clear 🎉🎉");
    } else {
      c2Cell.setFormula(
        '=IF(COUNTIF(B4:B18, TRUE) >= ' + wordCount +
        ', "Clear 🎉     次へ進む  → →  ", "' +
        category + ' #' + stageNum + ' （ " & COUNTIF(B4:B18, TRUE) & " / ' + wordCount + ' ）")'
      );
    }
    c2Cell.setHorizontalAlignment("left").setVerticalAlignment("middle")
          .setFontColor(themeColor).setBackground(themeBg)
          .setFontSize(10).setFontWeight("bold").setFontFamily("M PLUS 1p");
  
    var d2Cell = sheet.getRange("D2");
    var dbLast = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("db").getLastRow();
    var totalLearnedCalc = '(COUNTIF(db!I2:I' + dbLast + ', TRUE) + COUNTIF(\'基本\'!B4:B18, TRUE) + COUNTIF(\'介護\'!B4:B18, TRUE) + COUNTIF(\'医療\'!B4:B18, TRUE) + COUNTIF(\'社会\'!B4:B18, TRUE))';
  
    if (wordCount > 0 && checkedCount >= wordCount) {
      d2Cell.clearDataValidations().clearContent().insertCheckboxes()
            .setHorizontalAlignment("center").setVerticalAlignment("middle")
            .setFontSize(12).setFontColor("#D97706").setBackground(themeBg);
    } else {
      d2Cell.clearDataValidations().clearContent().setBackground(themeBg);
      if (wordCount === 0) {
        d2Cell.setValue("");
      } else {
        d2Cell.setFormula('="⭐️" & ' + totalLearnedCalc)
              .setHorizontalAlignment("center").setVerticalAlignment("middle")
              .setFontColor("#E65100").setFontSize(9).setFontWeight("bold").setFontFamily("M PLUS 1p");
      }
    }
  
    for (var i = 0; i < data.length; i++) {
      var currentRow = (i * 3) + 4;
      var word = cleanText(data[i][1]);
      var ruby = cleanText(data[i][4]);
      var english = cleanText(data[i][5]);
      var meaning = formatMeaning(data[i][6]);
      var example = formatExample(data[i][7]);
      var number = i + 1;
      var isChecked = (savedCheckStates[word] === true);
  
      sheet.setRowHeight(currentRow + 2, 10);
      checkA1List.push("B" + currentRow);
      cardA1List.push("B" + currentRow + ":D" + (currentRow + 1));
      editableRanges.push(sheet.getRange("B" + currentRow));
  
      var bCell = sheet.getRange("B" + currentRow);
      bCell.setValue(isChecked).setBackground("#FFFFFF").setFontColor("#1A73E8")
           .setFontSize(10).setHorizontalAlignment("center").setVerticalAlignment("middle");
  
      var titleBase = number + ". " + word + "（" + ruby + "）";
      var titleWithEn = titleBase + "  " + english;
  
      var cCell = sheet.getRange("C" + currentRow);
      cCell.setValue(titleWithEn).setBackground("#FFFFFF").setFontSize(10)
           .setFontColor("#333333").setFontWeight("normal").setVerticalAlignment("middle")
           .setWrap(true).setFontFamily("M PLUS 1p");
  
      var detailCell = sheet.getRange("C" + (currentRow + 1));
      detailCell.setValue(meaning + "\n" + example).setBackground("#FFFFFF").setFontSize(9)
                .setFontColor("#333333").setFontWeight("normal").setVerticalAlignment("middle")
                .setHorizontalAlignment("left").setWrap(true).setFontFamily("M PLUS 1p");
  
      sheet.getRange("B" + (currentRow + 2) + ":D" + (currentRow + 2)).setBackground("#FFFFFF");
    }
  
    if (actualRows > 0) {
      for (var i = 0; i < data.length; i++) {
        var currentRow = (i * 3) + 4;
        sheet.getRange(currentRow, 3, 1, 2).mergeAcross();
        sheet.getRange(currentRow + 1, 3, 1, 2).mergeAcross();
        sheet.getRange(currentRow + 2, 3, 1, 2).mergeAcross();
      }
  
      if (checkA1List.length > 0) sheet.getRangeList(checkA1List).insertCheckboxes();
  
      SpreadsheetApp.flush();
  
      for (var i = 0; i < data.length; i++) {
        var currentRow = (i * 3) + 4;
        var word = cleanText(data[i][1]);
        var ruby = cleanText(data[i][4]);
        var english = cleanText(data[i][5]);
        var number = i + 1;
  
        sheet.autoResizeRows(currentRow, 1);
        var headerH = sheet.getRowHeight(currentRow);
        sheet.setRowHeight(currentRow, Math.max(28, headerH));
  
        sheet.autoResizeRows(currentRow + 1, 1);
        var autoH = sheet.getRowHeight(currentRow + 1);
        sheet.setRowHeight(currentRow + 1, autoH + 5);
  
        var titleBase = number + ". " + word + "（" + ruby + "）";
        var titleWithEn = titleBase + "  " + english;
        var titleFormula = '=IF(B' + currentRow + '=TRUE, "' + escapeFormulaText(titleWithEn) + '", "' + escapeFormulaText(titleBase) + '")';
        sheet.getRange("C" + currentRow).setFormula(titleFormula);
  
        var meaning = formatMeaning(data[i][6]);
        var example = formatExample(data[i][7]);
        var detailFormula = '=IF(B' + currentRow + '=TRUE, "' + escapeFormulaText(meaning) + '" & CHAR(10) & "' + escapeFormulaText(example) + '", "")';
        sheet.getRange("C" + (currentRow + 1)).setFormula(detailFormula);
      }
  
      if (cardA1List.length > 0) {
        sheet.getRangeList(cardA1List).setBorder(true, true, true, true, false, false, "#D1D1D1", SpreadsheetApp.BorderStyle.SOLID);
      }
    }
  
    var protection = sheet.protect().setDescription(category + " シートの保護");
    protection.setUnprotectedRanges(editableRanges);
    var me = Session.getEffectiveUser();
    protection.addEditor(me);
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
  }
  
  // ------------------------------------------
  // 補助関数
  // ------------------------------------------
  function extractWordFromTitle(title) {
    if (!title) return "";
    title = title.toString().trim();
    var match = title.match(/^\d+\.\s*(.+?)(?:（|\()/);
    if (match) return cleanText(match[1]);
    match = title.match(/^(.+?)(?:（|\()/);
    if (match) return cleanText(match[1]);
    return "";
  }
  
  function getCategory(rawCategory) {
    rawCategory = cleanText(rawCategory);
    if (rawCategory.indexOf("介護") !== -1) return "介護";
    if (rawCategory.indexOf("医療") !== -1) return "医療";
    if (rawCategory.indexOf("社会") !== -1) return "社会";
    return "基本";
  }
  
  function alignAllSheetsOrder() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var orderedNames = ["覚", "基本", "介護", "医療", "社会", "調"];
    for (var i = 0; i < orderedNames.length; i++) {
      var target = ss.getSheetByName(orderedNames[i]);
      if (target) {
        ss.setActiveSheet(target);
        ss.moveActiveSheet(i + 1);
      }
    }
  }
  
  function escapeFormulaText(text) {
    if (text === null || text === undefined) return "";
    return text.toString().replace(/"/g, '""');
  }
  
  function cleanText(text) {
    if (!text) return "";
    return text.toString().replace(/^[\s\-\–\—\・\ー\−\－]+/g, "").trim();
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
  
  function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
  }
