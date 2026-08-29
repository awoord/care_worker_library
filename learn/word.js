// ------------------------------------------
// 1. 単語シートの初期化・更新関数
// ------------------------------------------
function createFlashCardsByCategories() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var originalSheet = ss.getActiveSheet();
  var dbSheet = ss.getSheetByName("db");
  var allSheets = ss.getSheets();
  
  var searchSheetName = "調";
  var studySheetName = "覚";
  var catNames = ["基本", "介護", "医療", "社会"];
  var allowedSheets = ["db", studySheetName, "覚える", searchSheetName, "サーチ"].concat(catNames);
  
  var savedCheckStates = {};
  for (var s = 0; s < allSheets.length; s++) {
    var sheet = allSheets[s];
    var sName = sheet.getName();
    
    if (sName !== "db" && sName !== searchSheetName && sName !== "サーチ" && sName !== studySheetName && sName !== "覚える") {
      var lastRow = sheet.getLastRow();
      if (lastRow >= 3) {
        var bVals = sheet.getRange(1, 2, lastRow, 1).getValues();
        var cVals = sheet.getRange(1, 3, lastRow, 1).getValues();
        for (var r = 0; r < bVals.length; r++) {
          if (bVals[r][0] === true) {
            var text = cVals[r][0];
            if (typeof text === 'string') {
              var match = text.match(/^[0-9]+\.\s*(.+?)[（\(]/);
              if (match) savedCheckStates[match[1].trim()] = true;
            }
          }
        }
      }
    }
  }
  
  var dbLastRow = dbSheet.getLastRow();
  var dbLastCol = dbSheet.getLastColumn() < 9 ? 9 : dbSheet.getLastColumn();
  if (dbLastRow < 2) return;
  
  var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, dbLastCol).getValues();
  var categorizedData = { "基本": [], "介護": [], "医療": [], "社会": [] };
  var learnedCounts = { "基本": 0, "介護": 0, "医療": 0, "社会": 0 };
  
  for (var i = 0; i < dbData.length; i++) {
    var word = cleanText(dbData[i][1]);
    var rawCategory = cleanText(dbData[i][3]);
    var isLearned = (dbData[i][8] === true);
    
    if (!word) continue;
    
    var category = "基本";
    if (rawCategory.indexOf("介護") !== -1) category = "介護";
    else if (rawCategory.indexOf("医療") !== -1) category = "医療";
    else if (rawCategory.indexOf("社会") !== -1) category = "社会";
    
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
    
    var tabColor = "#1976D2"; var themeBg = "#E3F2FD";
    if (cat === "介護") { tabColor = "#00893E"; themeBg = "#E8F5E9"; }
    else if (cat === "医療") { tabColor = "#E53935"; themeBg = "#FFEBEE"; }
    else if (cat === "社会") { tabColor = "#8E24AA"; themeBg = "#F3E5F5"; }
    
    var targetSheet = ss.getSheetByName(cat);
    if (!targetSheet) targetSheet = ss.insertSheet(cat);
    targetSheet.showSheet();
    targetSheet.setTabColor(tabColor);
    
    applyStageDataToSheet(targetSheet, chunkData, savedCheckStates, cat, stageNum, wordCount, tabColor, themeBg);
  }
  
  for (var s2 = allSheets.length - 1; s2 >= 0; s2--) {
    var currentSheet = allSheets[s2];
    var currentSheetName = currentSheet.getName();
    if (allowedSheets.indexOf(currentSheetName) === -1 || currentSheetName === "サーチ" || currentSheetName === "覚える") {
      if (ss.getSheetByName("調") && currentSheetName === "サーチ") {
        ss.deleteSheet(currentSheet);
      } else if (ss.getSheetByName("覚") && currentSheetName === "覚える") {
        ss.deleteSheet(currentSheet);
      }
    }
  }
  
  alignAllSheetsOrder();
  
  if (originalSheet) {
    ss.setActiveSheet(originalSheet);
  }
  SpreadsheetApp.flush();
}

// ------------------------------------------
// 2. シートの並び順を固定する共通関数
// ------------------------------------------
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

// ------------------------------------------
// 3. 次のステージへ進む（直接db行番号更新版・確実に連動）
// ------------------------------------------
function advanceToNextStage(categoryName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(categoryName);
  var dbSheet = ss.getSheetByName("db");
  
  if (!sheet || !dbSheet) return;
  
  // 1. dbから現在の未学習単語一覧とその行番号を取得
  var dbLastRow = dbSheet.getLastRow();
  if (dbLastRow < 2) return;
  var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, 9).getValues();
  
  var targetCatUnlearnedRows = [];
  
  for (var i = 0; i < dbData.length; i++) {
    var word = cleanText(dbData[i][1]);
    var rawCategory = cleanText(dbData[i][3]);
    var isLearned = (dbData[i][8] === true);
    
    if (!word || isLearned) continue;
    
    var category = "基本";
    if (rawCategory.indexOf("介護") !== -1) category = "介護";
    else if (rawCategory.indexOf("医療") !== -1) category = "医療";
    else if (rawCategory.indexOf("社会") !== -1) category = "社会";
    
    if (category === categoryName) {
      targetCatUnlearnedRows.push(i + 2); // dbシート上の実際の行番号（2行目スタート）
    }
  }
  
  // 2. 単語シートでチェックがついている単語（0〜4番目）を特定してdbを直接更新
  var lastRow = sheet.getLastRow();
  var maxSearchRow = Math.min(lastRow, 17);
  if (maxSearchRow >= 3) {
    var bValues = sheet.getRange(3, 2, maxSearchRow - 2, 1).getValues();
    var currentChunkRows = targetCatUnlearnedRows.slice(0, 5);
    
    for (var k = 0; k < currentChunkRows.length; k++) {
      var rowIndexInB = k * 3; // 0, 3, 6, 9, 12 -> 3行目, 6行目, 9行目, 12行目, 15行目
      if (rowIndexInB < bValues.length && bValues[rowIndexInB][0] === true) {
        var dbRowToUpdate = currentChunkRows[k];
        dbSheet.getRange(dbRowToUpdate, 9).setValue(true); // dbのI列を確実にTrueにする
      }
    }
    SpreadsheetApp.flush(); // dbの更新を確定
  }
  
  // 3. 単語シートと覚シートを再生成して連動
  createFlashCardsByCategories();
  createStudySheet();
}

// ------------------------------------------
// 4. ステージ用単語シート描画・保護関数
// ------------------------------------------
function applyStageDataToSheet(sheet, data, savedCheckStates, category, stageNum, wordCount, themeColor, themeBg) {
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for (var p = 0; p < protections.length; p++) {
    protections[p].remove();
  }

  var curMaxR = sheet.getMaxRows();
  var curMaxC = sheet.getMaxColumns();
  if (curMaxR > 0 && curMaxC > 0) sheet.getRange(1, 1, curMaxR, curMaxC).clearDataValidations();
  sheet.clear();
  sheet.clearFormats();
  sheet.setConditionalFormatRules([]);
  sheet.setHiddenGridlines(true);

  var actualRows = data.length * 3;
  var requiredRows = 2 + actualRows; 
  
  if (sheet.getMaxRows() < requiredRows) sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < 5) sheet.insertColumnsAfter(sheet.getMaxColumns(), 5 - sheet.getMaxColumns());
  if (sheet.getMaxRows() > requiredRows) sheet.deleteRows(requiredRows + 1, sheet.getMaxRows() - requiredRows);
  if (sheet.getMaxColumns() > 5) sheet.deleteColumns(6, sheet.getMaxColumns() - 5);
  
  sheet.setColumnWidth(1, 10);  // A列
  sheet.setColumnWidth(3, 190); // C列
  sheet.setColumnWidth(4, 40);  // D列
  sheet.setColumnWidth(5, 10);  // E列
  
  sheet.setRowHeight(1, 12);
  sheet.setRowHeight(2, 32);
  
  var checkA1List = [];
  var cardA1List = [];
  var checkedCount = 0;
  
  for (var i = 0; i < data.length; i++) {
    var word = cleanText(data[i][1]);
    if (savedCheckStates[word] === true) checkedCount++;
  }
  
  sheet.getRange("B2:D2").setBorder(false, false, true, false, false, false, "#D1D1D1", SpreadsheetApp.BorderStyle.SOLID);

  var c2Cell = sheet.getRange("C2");
  if (wordCount === 0) {
    c2Cell.setValue("All Clear 🎉🎉");
  } else {
    var c2Formula = '=IF(COUNTIF(B3:B, TRUE) >= ' + wordCount + ', "Clear 🎉     次へ進む   →   →  ", "' + category + ' #' + stageNum + ' （ " & COUNTIF(B3:B, TRUE) & " / ' + wordCount + ' ）")';
    c2Cell.setFormula(c2Formula);
  }
  c2Cell.setHorizontalAlignment("left").setVerticalAlignment("middle")
        .setFontColor(themeColor).setFontSize(10).setFontWeight("bold").setFontFamily("M PLUS 1p");
        
  var d2Cell = sheet.getRange("D2");
  var totalLearnedCalc = '(COUNTIF(db!I2:I, TRUE) + COUNTIF(\'基本\'!B3:B, TRUE) + COUNTIF(\'介護\'!B3:B, TRUE) + COUNTIF(\'医療\'!B3:B, TRUE) + COUNTIF(\'社会\'!B3:B, TRUE))';
  
  if (wordCount > 0 && checkedCount >= wordCount) {
    d2Cell.clearDataValidations()
          .clearContent()
          .insertCheckboxes()
          .setHorizontalAlignment("center")
          .setVerticalAlignment("middle")
          .setFontSize(10)
          .setFontColor(themeColor)
          .setBackground("#FFFFFF");
  } else {
    d2Cell.clearDataValidations()
          .clearContent()
          .setBackground("#FFFFFF");
    if (wordCount === 0) {
      d2Cell.setValue("");
    } else {
      d2Cell.setFormula('="⭐️" & ' + totalLearnedCalc)
            .setHorizontalAlignment("center")
            .setVerticalAlignment("middle")
            .setFontColor("#E65100")
            .setFontSize(10)
            .setFontWeight("bold")
            .setFontFamily("M PLUS 1p");
    }
  }
  
  var editableRanges = [sheet.getRange("D2")];
  
  for (var i = 0; i < data.length; i++) {
    var currentRow = (i * 3) + 3;
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
    bCell.setValue(isChecked)
         .setBackground("#FFFFFF")
         .setFontColor(themeColor)
         .setFontSize(10)
         .setHorizontalAlignment("center")
         .setVerticalAlignment("middle");
         
    var titleWithEn = number + ". " + word + "（" + ruby + "）  " + english;
    
    var cCell = sheet.getRange("C" + currentRow);
    cCell.setValue(titleWithEn)
         .setBackground("#FFFFFF")
         .setFontSize(10)
         .setFontColor("#333333")
         .setFontWeight("normal")
         .setVerticalAlignment("middle")
         .setWrap(true)
         .setFontFamily("M PLUS 1p");
         
    var detailCell = sheet.getRange("C" + (currentRow + 1));
    detailCell.setValue(meaning + "\n" + example)
              .setBackground("#FFFFFF")
              .setFontSize(9)
              .setFontColor("#333333")
              .setFontWeight("normal")
              .setVerticalAlignment("middle")
              .setHorizontalAlignment("left")
              .setWrap(true)
              .setFontFamily("M PLUS 1p");
              
    sheet.getRange("B" + (currentRow + 2) + ":D" + (currentRow + 2)).setBackground("#FFFFFF");
  }
  
  if (actualRows > 0) {
    for (var i = 0; i < data.length; i++) {
      var currentRow = (i * 3) + 3;
      sheet.getRange(currentRow, 3, 1, 2).mergeAcross();
      sheet.getRange(currentRow + 1, 3, 1, 2).mergeAcross();
      sheet.getRange(currentRow + 2, 3, 1, 2).mergeAcross();
    }
    
    if (checkA1List.length > 0) sheet.getRangeList(checkA1List).insertCheckboxes();
    
    SpreadsheetApp.flush();
    sheet.autoResizeColumn(2);
    
    for (var i = 0; i < data.length; i++) {
      var currentRow = (i * 3) + 3;
      var word = cleanText(data[i][1]);
      var ruby = cleanText(data[i][4]);
      var english = cleanText(data[i][5]);
      var number = i + 1;
      
      sheet.autoResizeRows(currentRow, 1);
      var headerH = sheet.getRowHeight(currentRow);
      sheet.setRowHeight(currentRow, Math.max(28, headerH));
      
      var titleBase = number + ". " + word + "（" + ruby + "）";
      var titleWithEn = number + ". " + word + "（" + ruby + "）  " + english;
      var titleFormula = '=IF(B' + currentRow + '=TRUE, "' + titleWithEn + '", "' + titleBase + '")';
      sheet.getRange("C" + currentRow).setFormula(titleFormula);
      
      sheet.autoResizeRows(currentRow + 1, 1);
      var autoH = sheet.getRowHeight(currentRow + 1);
      sheet.setRowHeight(currentRow + 1, autoH + 5);
      
      var meaning = formatMeaning(data[i][6]);
      var example = formatExample(data[i][7]);
      var detailText = meaning + '" & CHAR(10) & "' + example;
      var detailFormula = '=IF(B' + currentRow + '=TRUE, "' + detailText + '", "")';
      sheet.getRange("C" + (currentRow + 1)).setFormula(detailFormula);
    }
    
    if (cardA1List.length > 0) sheet.getRangeList(cardA1List).setBorder(true, true, true, true, false, false, "#D1D1D1", SpreadsheetApp.BorderStyle.SOLID);
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
