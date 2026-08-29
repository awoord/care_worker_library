// ------------------------------------------
// 「覚」シートの生成・更新関数（末尾全角スペース空行・高さ補正版）
// ------------------------------------------
function createStudySheet() {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var originalSheet = ss.getActiveSheet();
        var dbSheet = ss.getSheetByName("db");
        var sheetName = "覚";
        
        // 旧「覚える」シートがある場合は「覚」に名前変更
        var oldSheet = ss.getSheetByName("覚える");
        if (oldSheet && !ss.getSheetByName(sheetName)) {
          oldSheet.setName(sheetName);
        }
        
        var sheet = ss.getSheetByName(sheetName);
        if (!sheet) {
          sheet = ss.insertSheet(sheetName);
        }
        
        // 1. 既存の保護設定を一旦解除
        var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
        for (var p = 0; p < protections.length; p++) {
          protections[p].remove();
        }
        
        // 2. シートの完全初期化（古い文字・書式・入力規則をすべて消去）
        var curMaxR = sheet.getMaxRows();
        var curMaxC = sheet.getMaxColumns();
        if (curMaxR > 0 && curMaxC > 0) sheet.getRange(1, 1, curMaxR, curMaxC).clearDataValidations();
        sheet.clear();
        sheet.clearFormats();
        sheet.setConditionalFormatRules([]);
        sheet.setHiddenGridlines(true);
        
        // 3. dbデータの読み込み
        var dbLastRow = dbSheet.getLastRow();
        if (dbLastRow < 2) return;
        var dbData = dbSheet.getRange(2, 1, dbLastRow - 1, 9).getValues();
        
        var catNames = ["基本", "介護", "医療", "社会"];
        var categorizedData = { "基本": [], "介護": [], "医療": [], "社会": [] };
        
        for (var i = 0; i < dbData.length; i++) {
          var word = cleanText(dbData[i][1]);
          var rawCategory = cleanText(dbData[i][3]);
          var isLearned = (dbData[i][8] === true);
          
          if (!word || isLearned) continue;
          
          var category = "基本";
          if (rawCategory.indexOf("介護") !== -1) category = "介護";
          else if (rawCategory.indexOf("医療") !== -1) category = "医療";
          else if (rawCategory.indexOf("社会") !== -1) category = "社会";
          
          categorizedData[category].push(dbData[i]);
        }
        
        // 4. 枠組み設定（4列構成：A余白, B記号, Cテキスト, D余白 / 合計274px）
        var fixedTotalRows = 29;
        
        if (sheet.getMaxColumns() < 4) sheet.insertColumnsAfter(sheet.getMaxColumns(), 4 - sheet.getMaxColumns());
        else if (sheet.getMaxColumns() > 4) sheet.deleteColumns(5, sheet.getMaxColumns() - 4);
        
        if (sheet.getMaxRows() < fixedTotalRows) {
          sheet.insertRowsAfter(sheet.getMaxRows(), fixedTotalRows - sheet.getMaxRows());
        } else if (sheet.getMaxRows() > fixedTotalRows) {
          sheet.deleteRows(fixedTotalRows + 1, sheet.getMaxRows() - fixedTotalRows);
        }
        
        sheet.setColumnWidth(1, 10);  // A列: 左余白
        sheet.setColumnWidth(2, 12);  // B列: ▪記号
        sheet.setColumnWidth(3, 247); // C列: 単語・意味・例文
        sheet.setColumnWidth(4, 10);  // D列: 右余白
        
        // 全体の背景色を白で初期化
        sheet.getRange(1, 1, fixedTotalRows, 4).setBackground("#FFFFFF");
        sheet.setRowHeight(1, 15);
        
        var currentRow = 2;
        
        for (var k = 0; k < catNames.length; k++) {
          var cat = catNames[k];
          var unlearned = categorizedData[cat];
          var chunk = unlearned.slice(0, 5);
          
          shuffleArray(chunk);
          
          var themeColor = "#1976D2"; var themeBg = "#E3F2FD";
          if (cat === "介護") { themeBg = "#E8F5E9"; themeColor = "#00893E"; }
          else if (cat === "医療") { themeBg = "#FFEBEE"; themeColor = "#E53935"; }
          else if (cat === "社会") { themeBg = "#F3E5F5"; themeColor = "#8E24AA"; }
          
          // カテゴリー見出し行（高さ35px・フォント11pt）
          sheet.setRowHeight(currentRow, 35);
          sheet.getRange(currentRow, 1).setValue("").setBackground("#FFFFFF");
          sheet.getRange(currentRow, 2).setValue("").setBackground(themeBg);
          sheet.getRange(currentRow, 3)
               .setValue(cat)
               .setBackground(themeBg)
               .setFontColor(themeColor)
               .setFontSize(11)
               .setFontWeight("bold")
               .setHorizontalAlignment("left")
               .setVerticalAlignment("middle")
               .setFontFamily("M PLUS 1p");
          sheet.getRange(currentRow, 4).setValue("").setBackground("#FFFFFF");
          currentRow++;
          
          var cardStartRow = currentRow; // 5語マスの開始行
          
          // 単語カード行（B列に▪、C列にテキスト / 上揃え＋上下空行）
          for (var w = 0; w < 5; w++) {
            var bCell = sheet.getRange(currentRow, 2);
            var cCell = sheet.getRange(currentRow, 3);
            
            if (w < chunk.length) {
              var item = chunk[w];
              var wordText = cleanText(item[1]);
              var rubyText = cleanText(item[4]);
              var enText = cleanText(item[5]);
              var meaningText = formatMeaning(item[6]);
              var exampleText = formatExample(item[7]);
              
              // 先頭に改行、末尾に「改行 ＋ 全角スペース」を追加
              var cardText = "\n" +
                             wordText + "（" + rubyText + "）  " + enText + "\n" +
                             meaningText + "\n" +
                             exampleText + "\n ";
              
              // B列: 先頭改行＋▪（上揃え）
              bCell.setValue("\n▪")
                   .setFontSize(10)
                   .setFontColor("#333333")
                   .setBackground("#FFFFFF")
                   .setHorizontalAlignment("center")
                   .setVerticalAlignment("top")
                   .setFontFamily("M PLUS 1p");
                   
              // C列: テキスト（上揃え・フォント10pt・折り返し・左端揃え）
              cCell.setValue(cardText)
                   .setFontSize(10)
                   .setFontColor("#333333")
                   .setBackground("#FFFFFF")
                   .setWrap(true)
                   .setHorizontalAlignment("left")
                   .setVerticalAlignment("top")
                   .setFontFamily("M PLUS 1p");
            } else {
              bCell.setValue("").setBackground("#FFFFFF");
              cCell.setValue("").setBackground("#FFFFFF");
            }
            currentRow++;
          }
          
          // 5つの単語マスすべてに下線（B列〜C列）を一括適用
          sheet.getRange(cardStartRow, 2, 5, 2)
               .setBorder(null, null, true, null, null, true, "#999999", SpreadsheetApp.BorderStyle.DOTTED);
          
          // 1. 文字の高さに合わせて行を自動調整
          sheet.autoResizeRows(cardStartRow, 5);
          
          // 2. 自動調整後に高さを補正（最低78pxを維持しつつ20pxカット）
          for (var w = 0; w < 5; w++) {
            var targetRow = cardStartRow + w;
            var autoHeight = sheet.getRowHeight(targetRow);
            sheet.setRowHeight(targetRow, Math.max(78, autoHeight - 20));
          }
          
          // 余白行
          sheet.setRowHeight(currentRow, 15);
          sheet.getRange(currentRow, 1, 1, 4).setValue("").setBackground("#FFFFFF");
          currentRow++;
        }
        
        // 5. シート全体の保護設定（完全ロック・編集不可）
        var protection = sheet.protect().setDescription("「覚」シートの保護");
        var me = Session.getEffectiveUser();
        protection.addEditor(me);
        protection.removeEditors(protection.getEditors());
        if (protection.canDomainEdit()) {
          protection.setDomainEdit(false);
        }
        
        // 6. シート順序を整列
        alignAllSheetsOrder();
        
        if (originalSheet && originalSheet.getName() !== sheetName) {
          ss.setActiveSheet(originalSheet);
        }
        
        SpreadsheetApp.flush();
      }
      
      // 配列シャッフル関数
      function shuffleArray(array) {
        for (var i = array.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var temp = array[i];
          array[i] = array[j];
          array[j] = temp;
        }
      }
