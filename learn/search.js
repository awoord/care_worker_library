// ------------------------------------------
// 1. 「調」シートの初期設定関数（余分な空白行自動非表示版）
// ------------------------------------------
function setupSearchSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = "調";
  
  // 旧「サーチ」シートがある場合は「調」に名前変更
  var oldSheet = ss.getSheetByName("サーチ");
  if (oldSheet && !ss.getSheetByName(sheetName)) {
    oldSheet.setName(sheetName);
  }
  
  var sheet = ss.getSheetByName(sheetName);
  var dbSheet = ss.getSheetByName("db");
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  // 1. 既存の保護設定を一旦解除
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for (var p = 0; p < protections.length; p++) {
    protections[p].remove();
  }
  
  // 2. シートの完全初期化
  var curMaxR = sheet.getMaxRows();
  var curMaxC = sheet.getMaxColumns();
  if (curMaxR > 0 && curMaxC > 0) {
    sheet.showRows(1, curMaxR); // 一旦すべての行を表示
    sheet.getRange(1, 1, curMaxR, curMaxC).clearDataValidations();
  }
  sheet.clear();
  sheet.clearFormats();
  sheet.setConditionalFormatRules([]);
  sheet.setHiddenGridlines(true);
  
  // 3. 列数の調整（4列構成：A: 10px, B: 12px, C: 242px, D: 10px / 合計274px）
  if (sheet.getMaxColumns() < 4) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 4 - sheet.getMaxColumns());
  } else if (sheet.getMaxColumns() > 4) {
    sheet.deleteColumns(5, sheet.getMaxColumns() - 4);
  }
  
  sheet.setColumnWidth(1, 10);  // A列: 左余白
  sheet.setColumnWidth(2, 12);  // B列: ▪記号
  sheet.setColumnWidth(3, 242); // C列: 検索バー / 単語テキスト
  sheet.setColumnWidth(4, 10);  // D列: 右余白
  
  // 4. 行数の確保（dbの実データ行数に合わせて確保）
  var dbRows = dbSheet ? dbSheet.getLastRow() : 100;
  var requiredRows = 5 + dbRows + 10;
  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  } else if (sheet.getMaxRows() > requiredRows) {
    sheet.deleteRows(requiredRows + 1, sheet.getMaxRows() - requiredRows);
  }
  
  // 5. 行の高さ設定
  sheet.setRowHeight(1, 12); // 1行目: 上部余白
  sheet.setRowHeight(2, 24); // 2行目: 案内ラベル
  sheet.setRowHeight(3, 32); // 3行目: 検索バー（B3:C3）
  sheet.setRowHeight(4, 12); // 4行目: 余白
  
  var totalCardRows = sheet.getMaxRows() - 4;
  sheet.setRowHeights(5, totalCardRows, 110); // 5行目以降: カード行（110px）
  
  // 全体の背景色を白で初期化
  sheet.getRange(1, 1, sheet.getMaxRows(), 4).setBackground("#FFFFFF");
  
  // 6. 2行目: 案内ラベル（B2:C2結合）
  var labelRange = sheet.getRange("B2:C2");
  labelRange.merge();
  labelRange.setValue("🔎 文字を入力")
            .setFontSize(8)
            .setFontColor("#5f6368")
            .setFontWeight("bold")
            .setHorizontalAlignment("left")
            .setVerticalAlignment("middle")
            .setFontFamily("M PLUS 1p");
       
  // 7. 3行目: 検索バー（B3:C3結合・青枠）
  var searchRange = sheet.getRange("B3:C3");
  searchRange.merge();
  searchRange.clearContent()
             .setBackground("#FFFFFF")
             .setFontSize(11)
             .setFontColor("#1a73e8")
             .setFontWeight("bold")
             .setNumberFormat('@')
             .setHorizontalAlignment("left")
             .setVerticalAlignment("middle")
             .setFontFamily("M PLUS 1p")
             .setBorder(true, true, true, true, false, false, "#1a73e8", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
       
  // 8. 5行目以降のカード書式設定
  sheet.getRange(5, 2, totalCardRows, 1)
       .setFontSize(10)
       .setFontColor("#333333")
       .setBackground("#FFFFFF")
       .setHorizontalAlignment("center")
       .setVerticalAlignment("top")
       .setFontFamily("M PLUS 1p");
       
  sheet.getRange(5, 3, totalCardRows, 1)
       .setFontSize(10)
       .setFontColor("#333333")
       .setBackground("#FFFFFF")
       .setHorizontalAlignment("left")
       .setVerticalAlignment("top")
       .setWrap(true)
       .setFontFamily("M PLUS 1p");
       
  // B列〜C列の各セルの下に点線（ドット線）を設定
  sheet.getRange(5, 2, totalCardRows, 2)
       .setBorder(null, null, true, null, null, true, "#999999", SpreadsheetApp.BorderStyle.DOTTED);
              
  // 9. B5セル: 検索数式
  var symbolPart = 'IF(db!B2:B<>"","" & CHAR(10) & "▪","")';
  var textPart = 'CHAR(10) & db!B2:B & "（" & db!E2:E & "）  " & db!F2:F & CHAR(10) & ' +
                 'SUBSTITUTE(db!G2:G, "。", ". ") & CHAR(10) & ' +
                 'IF(LEFT(db!H2:H, 1)="「", SUBSTITUTE(db!H2:H, "。", ""), "「" & SUBSTITUTE(db!H2:H, "。", "") & "」")';
                 
  var cond = '((LEFT(TRIM(LOWER(db!B2:B)), LEN(TRIM(B3)))=LOWER(TRIM(B3))) + (LEFT(TRIM(LOWER(db!E2:E)), LEN(TRIM(B3)))=LOWER(TRIM(B3))) + (LEFT(TRIM(LOWER(db!F2:F)), LEN(TRIM(B3)))=LOWER(TRIM(B3))) > 0) * (db!B2:B<>"")';
  
  var formula = '=IF(TRIM(B3)="", {"", ""}, ' +
    'IFERROR(CHOOSECOLS(SORT(FILTER({' + symbolPart + ', ' + textPart + ', db!E2:E}, ' + cond + '), 3, TRUE), 1, 2), {"", "単語がありません"}))';
  
  sheet.getRange("B5").setFormula(formula);
  
  // 10. 初期状態では5行目以降を非表示にしておく
  if (totalCardRows > 0) {
    sheet.hideRows(5, totalCardRows);
  }
  
  SpreadsheetApp.flush();
  
  // 11. シートの保護設定（B3:C3の検索窓のみ編集許可）
  var protection = sheet.protect().setDescription("「調」シートの保護（検索窓のみ編集可能）");
  protection.setUnprotectedRanges([sheet.getRange("B3:C3")]);
  var me = Session.getEffectiveUser();
  protection.addEditor(me);
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) {
    protection.setDomainEdit(false);
  }
}
