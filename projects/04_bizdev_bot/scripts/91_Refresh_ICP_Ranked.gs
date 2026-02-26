/**
 * 91_Refresh_ICP_Ranked.gs
 *
 * Purpose: Refresh ICP_Ranked snapshot tab with current ICP_Score data (values only)
 * This creates a sortable view by copying values instead of formulas
 *
 * Usage: Menu → ICP Tools → Refresh ICP Ranked View
 *
 * Version: 1.0.0
 * Last Updated: 2026-02-08
 */

/**
 * Main function to refresh ICP_Ranked snapshot
 * Copies key columns from ICP_Score as values (not formulas)
 * Creates tab if it doesn't exist
 */
function Refresh_ICP_Ranked() {
  const ss = getSpreadsheet_();

  try {
    // Get or create ICP_Ranked tab
    let rankedSheet = ss.getSheetByName('ICP_Ranked');
    if (!rankedSheet) {
      rankedSheet = ss.insertSheet('ICP_Ranked');
      Logger.log('Created new ICP_Ranked tab');
    }

    // Get ICP_Score data
    const icpSheet = ss.getSheetByName('ICP_Score');
    if (!icpSheet) {
      throw new Error('ICP_Score tab not found');
    }

    const lastRow = icpSheet.getLastRow();
    if (lastRow < 2) {
      throw new Error('No data in ICP_Score tab');
    }

    // Define columns to copy: A, B, C, D, E, F, O, P, T, U, V
    // (Domain, Name, Industry, Region, Size, Revenue, Firmographics, Behavioral, Total, Bucket, QA)
    const columnsToCopy = [1, 2, 3, 4, 5, 6, 15, 16, 20, 21, 22]; // Column indices (1-based)
    const headers = [
      'Company_Domain',
      'Company_Name',
      'Industry',
      'Region_Bucket',
      'Company_Size',
      'Company_Revenue',
      'Total_Firmographics',
      'Company_Behavioral',
      'Company_ICP_Total',
      'ICP_Bucket',
      'QA_Flag'
    ];

    // Remove existing filter (if any) before clearing
    const existingFilter = rankedSheet.getFilter();
    if (existingFilter) {
      existingFilter.remove();
    }

    // Clear existing data
    rankedSheet.clear();

    // Write headers
    rankedSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    rankedSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285f4').setFontColor('#ffffff');
    rankedSheet.setFrozenRows(1);

    // Copy data values (not formulas) - BATCH READ for performance
    const allData = icpSheet.getRange(2, 1, lastRow - 1, icpSheet.getLastColumn()).getValues();
    const dataRows = [];

    for (let i = 0; i < allData.length; i++) {
      const rowData = [];
      for (const col of columnsToCopy) {
        rowData.push(allData[i][col - 1]); // col is 1-based, array is 0-based
      }
      dataRows.push(rowData);
    }

    // Write all data at once
    if (dataRows.length > 0) {
      rankedSheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
    }

    // Auto-sort by ICP_Bucket (A->C) then Company_ICP_Total (high->low)
    const sortRange = rankedSheet.getRange(2, 1, dataRows.length, headers.length);
    sortRange.sort([
      {column: 10, ascending: true},  // ICP_Bucket (A, B, C)
      {column: 9, ascending: false}   // Company_ICP_Total (high to low)
    ]);

    // Auto-resize columns
    for (let col = 1; col <= headers.length; col++) {
      rankedSheet.autoResizeColumn(col);
    }

    // Add filter view
    rankedSheet.getRange(1, 1, dataRows.length + 1, headers.length).createFilter();

    getSpreadsheet_().toast(
      `✅ Refreshed ${dataRows.length} companies in ICP_Ranked tab (sorted by bucket & score)`,
      'ICP Ranked View Updated',
      5
    );

    // Switch to the ranked tab
    rankedSheet.activate();

    Logger.log(`Successfully refreshed ICP_Ranked with ${dataRows.length} companies`);

  } catch (error) {
    Logger.log(`Error in Refresh_ICP_Ranked: ${error.message}`);
    SpreadsheetApp.getUi().alert(
      '❌ Error',
      `Failed to refresh ICP_Ranked:\n\n${error.message}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}
