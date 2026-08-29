// @ts-nocheck
// ==========================================================
// 全シート一括セットアップ
// ==========================================================

function updateAllSheets() {
    // 1. 「ことば」シートの作成・更新
    if (typeof createSingleWordSheet === "function") {
      createSingleWordSheet();
    }
  
    // 2. 「さがす」シートの作成・更新
    if (typeof setupSearchSheet === "function") {
      setupSearchSheet();
    }
  
    // 3. 「まいにち」シートの作成・更新
    if (typeof setupMainichiSheet === "function") {
      setupMainichiSheet();
    } else if (typeof setupDailySheet === "function") {
      setupDailySheet();
    }
  
    // 4. シートの並び順を整える
    if (typeof alignAllSheetsOrder === "function") {
      alignAllSheetsOrder();
    }
  }
