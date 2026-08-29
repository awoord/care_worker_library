// ==========================================================
// 「まいにち」シート（8/27木曜日以前・空白化対応版）
// ==========================================================

function setupFootprintSheet() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.setSpreadsheetTimeZone("Asia/Tokyo");
  
    var sheetName = "まいにち";
    var deleteTargets = ["足あと", "きろく", "進捗"];
    for (var d = 0; d < deleteTargets.length; d++) {
      var oldSheet = ss.getSheetByName(deleteTargets[d]);
      if (oldSheet) {
        ss.deleteSheet(oldSheet);
      }
    }
  
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
  
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var p = 0; p < protections.length; p++) {
      protections[p].remove();
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
  
    var targetCols = 10;
    if (sheet.getMaxColumns() > targetCols) {
      sheet.deleteColumns(targetCols + 1, sheet.getMaxColumns() - targetCols);
    } else if (sheet.getMaxColumns() < targetCols) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), targetCols - sheet.getMaxColumns());
    }
  
    var totalWeeks = 23;
    var targetRows = 30;
    if (sheet.getMaxRows() > targetRows) {
      sheet.deleteRows(targetRows + 1, sheet.getMaxRows() - targetRows);
    } else if (sheet.getMaxRows() < targetRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), targetRows - sheet.getMaxRows());
    }
  
    sheet.setColumnWidth(1, 60);   // A列（左余白）
    sheet.setColumnWidth(2, 180);  // B列（週表示）
    for (var c = 3; c <= 9; c++) {
      sheet.setColumnWidth(c, 136); // C〜I列（月〜日）
    }
    sheet.setColumnWidth(10, 60);  // J列（右余白）
  
    sheet.getRange(1, 1, targetRows, targetCols).setBackground("#FFFFFF");
  
    sheet.setRowHeight(1, 23);   // 上余白
    sheet.setRowHeight(2, 120);  // 最上部ステータス
    sheet.setRowHeight(3, 100);  // 覚えた単語数
    sheet.setRowHeight(4, 20);   // 余白
    sheet.setRowHeight(5, 50);   // 見出し
    sheet.setRowHeight(6, 54);   // 曜日ヘッダー
  
    for (var r = 7; r <= 6 + totalWeeks; r++) {
      sheet.setRowHeight(r, 65);
    }
    sheet.setRowHeight(30, 28);  // 下余白
  
    // 1. 最上部ステータス（⭐️ 連続達成中！）
    var streakFormula = 
      '=LET(' +
      '  todayWorked, IF(COUNTIFS(db!J:J, ">=" & TODAY(), db!J:J, "<" & (TODAY() + 1)) > 0, 1, 0), ' +
      '  daysToCheck, MAP(SEQUENCE(365, 1, 1, 1), LAMBDA(n, TODAY() - n)), ' +
      '  pastDoneFlags, MAP(daysToCheck, LAMBDA(d, IF(COUNTIFS(db!J:J, ">=" & d, db!J:J, "<" & (d + 1)) > 0, 1, 0))), ' +
      '  yesterdayDone, INDEX(pastDoneFlags, 1), ' +
      '  firstZeroIdx, IFERROR(MATCH(0, pastDoneFlags, 0), 365), ' +
      '  pastStreak, firstZeroIdx - 1, ' +
      '  currentStreak, IF(todayWorked = 1, pastStreak + 1, pastStreak), ' +
      '  IF(todayWorked = 1, ' +
      '    "⭐️ " & currentStreak & "日 連続達成中！", ' +
      '    IF(yesterdayDone = 1, ' +
      '      "😎 " & pastStreak & "日 継続中！（今日やって" & (pastStreak + 1) & "日目へ！）", ' +
      '      "😎 今日から また始めよう！"' +
      '    )' +
      '  )' +
      ')';
  
    sheet.getRange("B2:I2").merge()
         .setFormula(streakFormula)
         .setBackground("#FFF3E0")
         .setFontColor("#E65100")
         .setFontSize(46)
         .setFontWeight("bold")
         .setFontFamily("M PLUS 1p")
         .setHorizontalAlignment("center")
         .setVerticalAlignment("middle");
  
    // 2. 覚えた単語数
    var totalFormula = 
      '="覚えた単語： " & COUNTIF(db!I2:I, TRUE) & " 語"';
  
    sheet.getRange("B3:I3").merge()
         .setFormula(totalFormula)
         .setBackground("#FFF8E1")
         .setFontColor("#E65100")
         .setFontSize(38)
         .setFontWeight("bold")
         .setFontFamily("M PLUS 1p")
         .setHorizontalAlignment("center")
         .setVerticalAlignment("middle");
  
    // 3. ロードマップ見出し
    sheet.getRange("B5:I5").merge()
         .setValue("▼ 合格ロードマップ（2026/8/27 〜 2027/1/31）")
         .setFontSize(28)
         .setFontColor("#616161")
         .setFontWeight("bold")
         .setFontFamily("M PLUS 1p")
         .setVerticalAlignment("middle");
  
    sheet.getRange("B6").setValue("週").setFontSize(26).setFontWeight("bold").setFontColor("#9E9E9E")
         .setHorizontalAlignment("center").setVerticalAlignment("middle").setBackground("#F5F5F5");
  
    var dayLabels = ["月", "火", "水", "木", "金", "土", "日"];
    for (var dl = 0; dl < 7; dl++) {
      sheet.getRange(6, 3 + dl)
           .setValue(dayLabels[dl])
           .setFontSize(28)
           .setFontWeight("bold")
           .setFontFamily("M PLUS 1p")
           .setFontColor(dl === 5 ? "#1976D2" : (dl === 6 ? "#D32F2F" : "#616161"))
           .setHorizontalAlignment("center")
           .setVerticalAlignment("middle")
           .setBackground("#F5F5F5");
    }
  
    // 4. カレンダーマス（8/27木曜日以前は空白に設定）
    for (var w = 0; w < totalWeeks; w++) {
      var rowNum = 7 + w;
      
      var weekLabelFormula = 
        '=LET(' +
        '  thisMon, DATE(2026, 8, 24) + (' + w + ' * 7), ' +
        '  nowMon, TODAY() - WEEKDAY(TODAY(), 3), ' +
        '  startStr, TEXT(thisMon, "m/d") & "〜", ' +
        '  IF(thisMon = nowMon, "👉 " & startStr, ' +
        '    IF(' + w + ' = ' + (totalWeeks - 1) + ', "📘 " & startStr, startStr)' +
        '  )' +
        ')';
  
      sheet.getRange(rowNum, 2)
           .setFormula(weekLabelFormula)
           .setFontSize(26)
           .setFontWeight("bold")
           .setFontFamily("M PLUS 1p")
           .setFontColor("#424242")
           .setHorizontalAlignment("center")
           .setVerticalAlignment("middle")
           .setBackground("#FAFAFA");
  
      for (var d = 0; d < 7; d++) {
        var colNum = 3 + d;
        
        // targetDate < DATE(2026, 8, 28) で8月27日木曜日までを空白に指定
        var cellFormula = 
          '=LET(' +
          '  targetDate, DATE(2026, 8, 24) + ' + d + ' + (' + w + ' * 7), ' +
          '  isDone, COUNTIFS(db!J:J, ">=" & targetDate, db!J:J, "<" & (targetDate + 1)) > 0, ' +
          '  IF(targetDate < DATE(2026, 8, 28), "", ' +
          '    IF(targetDate > DATE(2027, 1, 31), "", ' +
          '      IF(isDone, "⭐️", ' +
          '        IF(targetDate = DATE(2027, 1, 31), "📘", ' +
          '          IF(targetDate > TODAY(), "⚪️", "⬜️")' +
          '        )' +
          '      )' +
          '    )' +
          '  )' +
          ')';
  
        sheet.getRange(rowNum, colNum)
             .setFormula(cellFormula)
             .setFontSize(40)
             .setHorizontalAlignment("center")
             .setVerticalAlignment("middle")
             .setBackground("#FAFAFA");
      }
    }
  
    var rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=ISNUMBER(SEARCH("👉", $B7))')
      .setBackground("#FFF3E0")
      .setRanges([sheet.getRange(7, 2, totalWeeks, 8)])
      .build();
    sheet.setConditionalFormatRules([rule]);
  
    var protection = sheet.protect().setDescription("「まいにち」シートの保護（閲覧専用）");
    var me = Session.getEffectiveUser();
    protection.addEditor(me);
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
  
    alignAllSheetsOrder();
    SpreadsheetApp.flush();
  }
  
  function alignAllSheetsOrder() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var orderedNames = ["ことば", "さがす", "まいにち"];
    for (var i = 0; i < orderedNames.length; i++) {
      var target = ss.getSheetByName(orderedNames[i]);
      if (target) {
        ss.setActiveSheet(target);
        ss.moveActiveSheet(i + 1);
      }
    }
  }
