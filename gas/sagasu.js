// @ts-nocheck
// ==========================================================
// 「さがす」シート（排他制御・安定動作版）
// ==========================================================

function setupSearchSheet() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var dbSheet = ss.getSheetByName("db");
  
    if (!dbSheet) return;
  
    var sheetName = "さがす";
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
  
    // 既存の保護を解除
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
  
    var dbLastRow = dbSheet.getLastRow();
    if (dbLastRow < 2) return;
  
    var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, 10).getValues();
    var wordCount = dbData.length;
  
    var startCardRow = 10;
    var totalRequiredRows = 9 + (wordCount * 4);
    var targetCols = 7;
  
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
    sheet.setColumnWidth(2, 220);  // B列（基本 / 🔍 / カードカテゴリ）
    sheet.setColumnWidth(3, 220);  // C列（介護 / 単語名）
    sheet.setColumnWidth(4, 220);  // D列（医療 / 単語名）
    sheet.setColumnWidth(5, 220);  // E列（社会 / 単語名）
    sheet.setColumnWidth(6, 310);  // F列（おぼえたチェック / 英語）
    sheet.setColumnWidth(7, 40);   // G列（右余白）
  
    sheet.getRange(1, 1, totalRequiredRows, targetCols).setBackground("#FFFFFF");
  
    // 行の高さ設定
    sheet.setRowHeight(1, 70);  // 1行目：上余白
    sheet.setRowHeight(2, 45);  // 2行目：おぼえたラベル
    sheet.setRowHeight(3, 75);  // 3行目：検索窓・おぼえたチェック
    sheet.setRowHeight(4, 20);  // 4行目：余白
    sheet.setRowHeight(5, 45);  // 5行目：カテゴリー名（ラベル）
    sheet.setRowHeight(6, 75);  // 6行目：カテゴリーチェックボックス
    sheet.setRowHeight(7, 30);  // 7行目：余白
    sheet.setRowHeight(8, 70);  // 8行目：件数表示エリア
    sheet.setRowHeight(9, 25);  // 9行目：余白
  
    var editableRanges = [];
  
    // 1. 検索バー（B2:E3）
    sheet.getRange("B2:B3").merge()
         .setValue("🔍")
         .setFontSize(40)
         .setFontWeight("normal")
         .setHorizontalAlignment("center")
         .setVerticalAlignment("middle")
         .setBackground("#FFFFFF");
  
    var searchInput = sheet.getRange("C2:E3");
    searchInput.merge()
               .setValue("")
               .setFontSize(34)
               .setFontWeight("normal")
               .setFontFamily("M PLUS 1p")
               .setHorizontalAlignment("left")
               .setVerticalAlignment("middle")
               .setBackground("#E8F0FE");
    editableRanges.push(sheet.getRange("C2"));
  
    sheet.getRange("B2:E3").setBorder(true, true, true, true, true, true, "#B0BEC5", SpreadsheetApp.BorderStyle.SOLID);
  
    // F2: おぼえた単語ラベル
    var f2Cell = sheet.getRange("F2");
    f2Cell.setValue("おぼえた単語のみ")
          .setFontSize(26)
          .setFontWeight("normal")
          .setFontFamily("M PLUS 1p")
          .setHorizontalAlignment("center")
          .setVerticalAlignment("middle")
          .setFontColor("#E65100")
          .setBackground("#FFFFFF")
          .setBorder(false, false, false, false, false, false);
  
    // F3: おぼえた単語チェックボックス
    var filterCheck = sheet.getRange("F3");
    filterCheck.insertCheckboxes()
               .setValue(false)
               .setFontSize(46)
               .setFontWeight("normal")
               .setFontColor("#E65100")
               .setHorizontalAlignment("center")
               .setVerticalAlignment("middle")
               .setBackground("#FFFFFF")
               .setBorder(false, false, false, false, false, false);
    editableRanges.push(filterCheck);
  
    // 2. カテゴリー選択エリア（5〜6行目）
    var cats = [
      { col: "B", name: "基本", color: "#1976D2" },
      { col: "C", name: "介護", color: "#00893E" },
      { col: "D", name: "医療", color: "#C62828" },
      { col: "E", name: "社会", color: "#8E24AA" }
    ];
  
    for (var c = 0; c < cats.length; c++) {
      // 5行目：ラベル
      var labelCell = sheet.getRange(cats[c].col + "5");
      labelCell.setValue(cats[c].name)
               .setFontSize(26)
               .setFontWeight("normal")
               .setFontFamily("M PLUS 1p")
               .setHorizontalAlignment("center")
               .setVerticalAlignment("middle")
               .setFontColor(cats[c].color)
               .setBackground("#FFFFFF")
               .setBorder(false, false, false, false, false, false);
  
      // 6行目：チェックボックス
      var catCheck = sheet.getRange(cats[c].col + "6");
      catCheck.insertCheckboxes()
              .setValue(false)
              .setBackground("#FFFFFF")
              .setFontColor(cats[c].color)
              .setFontSize(46)
              .setFontWeight("normal")
              .setHorizontalAlignment("center")
              .setVerticalAlignment("middle")
              .setBorder(false, false, false, false, false, false);
      editableRanges.push(catCheck);
    }
  
    // F5セル（空欄）
    sheet.getRange("F5")
         .setValue("")
         .setBackground("#FFFFFF")
         .setBorder(false, false, false, false, false, false);
  
    // F6セル（案内文字）
    sheet.getRange("F6")
         .setValue("👈 カテゴリーを選択")
         .setFontSize(26)
         .setFontWeight("normal")
         .setFontColor("#757575")
         .setFontFamily("M PLUS 1p")
         .setHorizontalAlignment("center")
         .setVerticalAlignment("middle")
         .setBackground("#FFFFFF")
         .setBorder(false, false, false, false, false, false);
  
    // 3. 件数表示ヘッダー（8行目）
    sheet.getRange("B8:F8").merge()
         .setValue("全 " + wordCount + " 語 を表示中")
         .setFontSize(28)
         .setFontColor("#757575")
         .setFontWeight("normal")
         .setFontFamily("M PLUS 1p")
         .setVerticalAlignment("middle")
         .setBackground("#FFFFFF");
  
    // 4. 単語カードの生成（10行目開始）
    for (var i = 0; i < wordCount; i++) {
      var item = dbData[i];
      var word = cleanSearchText(item[1]);
      var cat = getSearchCategory(cleanSearchText(item[3]));
      var ruby = cleanSearchText(item[4]);
      var english = cleanSearchText(item[5]);
      var meaning = formatSearchMeaning(item[6]);
      var example = formatSearchExample(item[7]);
  
      var wordRow = startCardRow + (i * 4);
      var gapRow = wordRow + 1;
      var detailRow = wordRow + 2;
      var dividerRow = wordRow + 3;
  
      sheet.setRowHeight(wordRow, 110);
      sheet.setRowHeight(gapRow, 25);
      sheet.setRowHeight(dividerRow, 45);
  
      var bCell = sheet.getRange(wordRow, 2);
      var cRange = sheet.getRange(wordRow, 3, 1, 3);
      var cCell = sheet.getRange(wordRow, 3);
      var fCell = sheet.getRange(wordRow, 6);
      var detailRange = sheet.getRange(detailRow, 3, 1, 4);
      var detailCell = sheet.getRange(detailRow, 3);
  
      cRange.mergeAcross();
      detailRange.mergeAcross();
  
      var catColor = "#1976D2";
      if (cat === "介護") { catColor = "#00893E"; }
      else if (cat === "医療") { catColor = "#C62828"; }
      else if (cat === "社会") { catColor = "#8E24AA"; }
  
      // B列（カテゴリー：bold）
      bCell.setValue(cat)
           .setFontSize(28)
           .setFontWeight("bold")
           .setFontFamily("M PLUS 1p")
           .setFontColor(catColor)
           .setBackground("#FFFFFF")
           .setHorizontalAlignment("center")
           .setVerticalAlignment("middle");
  
      // 見出し単語とルビ（C列：bold）
      cCell.setValue(word + " (" + ruby + ")")
           .setFontSize(38)
           .setFontWeight("bold")
           .setFontColor("#333333")
           .setFontFamily("M PLUS 1p")
           .setHorizontalAlignment("left")
           .setVerticalAlignment("middle")
           .setBackground("#FFFFFF")
           .setWrap(true);
  
      // 英語（F列：normal）
      fCell.setValue(english)
           .setFontSize(34)
           .setFontWeight("normal")
           .setFontColor("#555555")
           .setFontFamily("M PLUS 1p")
           .setHorizontalAlignment("right")
           .setVerticalAlignment("middle")
           .setBackground("#FFFFFF")
           .setWrap(true);
  
      // 意味・例文（C〜F列結合：normal）
      detailCell.setValue(meaning + "\n" + example)
                .setFontSize(34)
                .setFontWeight("normal")
                .setFontColor("#333333")
                .setFontFamily("M PLUS 1p")
                .setHorizontalAlignment("left")
                .setVerticalAlignment("middle")
                .setBackground("#FFFFFF")
                .setWrap(true);
    }
  
    // 5. シート保護
    var protection = sheet.protect().setDescription("「さがす」シートの保護");
    protection.setUnprotectedRanges(editableRanges);
    var me = Session.getEffectiveUser();
    protection.addEditor(me);
    protection.removeEditors(protection.getEditors());
    if (protection.canDomainEdit()) {
      protection.setDomainEdit(false);
    }
  
    alignAllSheetsOrder();
    SpreadsheetApp.flush();
  }
  
  // ----------------------------------------------------------
  // 検索・絞り込み実行ロジック（排他制御・高安定版）
  // ----------------------------------------------------------
  function filterSearchCards(sheet) {
    var lock = LockService.getScriptLock();
    var hasLock = false;
  
    try {
      // 5秒間ロック取得を試みる（多重実行の防止）
      hasLock = lock.tryLock(5000);
      if (!hasLock) return;
  
      var statusCell = sheet.getRange("B8:F8");
      statusCell.setValue("⏳ さがしています...");
      SpreadsheetApp.flush();
  
      var dbSheet = sheet.getParent().getSheetByName("db");
      if (!dbSheet) return;
  
      var dbLastRow = dbSheet.getLastRow();
      if (dbLastRow < 2) return;
  
      var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, 10).getValues();
      var wordCount = dbData.length;
  
      var keyword = cleanSearchText(sheet.getRange("C2").getValue()).toLowerCase();
      var onlyLearned = (sheet.getRange("F3").getValue() === true);
  
      var checkKihon = (sheet.getRange("B6").getValue() === true);
      var checkKaigo = (sheet.getRange("C6").getValue() === true);
      var checkIryo  = (sheet.getRange("D6").getValue() === true);
      var checkShakai = (sheet.getRange("E6").getValue() === true);
  
      var hasCatFilter = (checkKihon || checkKaigo || checkIryo || checkShakai);
  
      var selectedCats = [];
      if (checkKihon) selectedCats.push("基本");
      if (checkKaigo) selectedCats.push("介護");
      if (checkIryo)  selectedCats.push("医療");
      if (checkShakai) selectedCats.push("社会");
  
      var startCardRow = 10;
      var totalCardRows = wordCount * 4;
  
      // 全行を表示状態にする
      sheet.showRows(startCardRow, totalCardRows);
  
      // 条件なし（全件表示）の場合はそのまま完了
      if (keyword === "" && !onlyLearned && !hasCatFilter) {
        statusCell.setValue("全 " + wordCount + " 語 を表示中");
        SpreadsheetApp.flush();
        return;
      }
  
      var hideRanges = [];
      var currentHideStart = -1;
      var currentHideLength = 0;
      var matchedCount = 0;
  
      for (var i = 0; i < wordCount; i++) {
        var item = dbData[i];
        var word = cleanSearchText(item[1]).toLowerCase();
        var cat = getSearchCategory(cleanSearchText(item[3]));
        var ruby = cleanSearchText(item[4]).toLowerCase();
        var english = cleanSearchText(item[5]).toLowerCase();
        var isLearned = (item[8] === true);
  
        var cardRow = startCardRow + (i * 4);
  
        var passLearned = onlyLearned ? isLearned : true;
        var passCat = hasCatFilter ? (selectedCats.indexOf(cat) !== -1) : true;
  
        var passKeyword = true;
        if (keyword !== "") {
          passKeyword = (word.indexOf(keyword) === 0 || ruby.indexOf(keyword) === 0 || english.indexOf(keyword) === 0);
        }
  
        var isVisible = passLearned && passCat && passKeyword;
  
        if (isVisible) {
          matchedCount++;
          if (currentHideStart !== -1) {
            hideRanges.push({ start: currentHideStart, length: currentHideLength });
            currentHideStart = -1;
            currentHideLength = 0;
          }
        } else {
          if (currentHideStart === -1) {
            currentHideStart = cardRow;
            currentHideLength = 4;
          } else {
            currentHideLength += 4;
          }
        }
      }
  
      if (currentHideStart !== -1) {
        hideRanges.push({ start: currentHideStart, length: currentHideLength });
      }
  
      // 非表示行をまとめて隠す
      for (var h = 0; h < hideRanges.length; h++) {
        sheet.hideRows(hideRanges[h].start, hideRanges[h].length);
      }
  
      // 件数テキストの更新
      var filterLabels = [];
      if (onlyLearned) filterLabels.push("おぼえた単語");
      if (hasCatFilter) filterLabels.push(selectedCats.join("・"));
  
      var labelHeader = filterLabels.length > 0 ? "【" + filterLabels.join(" の中の ") + "】 " : "";
      var queryHeader = keyword !== "" ? "「" + keyword + "」: " : "";
      var countText = labelHeader + queryHeader + matchedCount + " 語";
  
      statusCell.setValue(countText);
      SpreadsheetApp.flush();
  
    } catch (err) {
      // 処理中のエラー発生時も安全にロックを解除して終了
    } finally {
      if (hasLock) {
        lock.releaseLock();
      }
    }
  }
  
  function cleanSearchText(text) {
    return text ? text.toString().trim() : "";
  }
  
  function getSearchCategory(rawCategory) {
    var text = cleanSearchText(rawCategory);
    if (text.indexOf("介護") !== -1) return "介護";
    if (text.indexOf("医療") !== -1) return "医療";
    if (text.indexOf("社会") !== -1) return "社会";
    return "基本";
  }
  
  function formatSearchMeaning(text) {
    var cleaned = cleanSearchText(text);
    if (!cleaned) return "";
    return cleaned.replace(/。/g, ". ");
  }
  
  function formatSearchExample(text) {
    var cleaned = cleanSearchText(text);
    if (!cleaned) return "";
    cleaned = cleaned.replace(/。/g, "");
    if (cleaned.startsWith("「") && cleaned.endsWith("」")) return cleaned;
    return "「" + cleaned + "」";
  }
