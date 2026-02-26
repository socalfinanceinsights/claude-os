/**
 * BD TRACKER - MENU SYSTEM
 * Version: 2.0.0 (Refactored)
 *
 * CONTAINS:
 * - Custom menu creation (onOpen trigger)
 * - Menu item organization
 *
 * DEPENDENCIES: All other script files
 */

/**
 * onOpen Trigger
 * Creates custom menu when spreadsheet opens
 *
 * AUTO-EXECUTED by Google Sheets on open
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('⚡ BD Automations')
    .addSubMenu(ui.createMenu('📂 Drive Import')
      .addItem('LinkedIn (from Drive)', 'Import_LinkedIn_From_Drive')
      .addItem('Lusha Contacts (from Drive)', 'Import_Lusha_From_Drive')
      .addItem('Lusha Companies (from Drive)', 'Import_LushaCompany_From_Drive')
      .addItem('CrunchBase (from Drive)', 'Import_CrunchBase_From_Drive')
      .addItem('Bullhorn (from Drive)', 'Import_Bullhorn_From_Drive')
      .addSeparator()
      .addItem('Check Pending Files', 'Check_Drive_Import_Status')
      .addItem('Restore Drive Folder IDs', 'Restore_Drive_Folder_IDs')
    )
    .addSeparator()
    .addSubMenu(ui.createMenu('📥 Data Import (Legacy)')
      .addItem('▶ Run Lusha Import (Validate & Process)', 'Run_Lusha_ValidateAndProcess')
      .addItem('▶ Run Crunchbase Import (Validate & Process)', 'Run_Crunchbase_ValidateAndProcess')
    )
    .addSeparator()
    .addSubMenu(ui.createMenu('🔄 Sync Operations')
      .addItem('Add Selected HMs to BD Contacts', 'AddSelectedHMsToBD_Contacts')
      .addItem('Seed HM Signals from BD Contacts', 'Seed_HM_Signals_From_BD')
    )
    .addSeparator()
    .addSubMenu(ui.createMenu('📧 BD Campaigns')
      .addItem('Create MPC Campaign', 'showMPCCampaignDialog')
      .addItem('Schedule Campaign Events', 'scheduleCampaignEvents')
      .addSeparator()
      .addItem('Mark Touch Complete', 'markTouchComplete')
    )
    .addSeparator()
    .addSubMenu(ui.createMenu('📊 ICP Tools')
      .addItem('🔄 Refresh All (ICP Ranked + BD Contacts)', 'Refresh_All_ICP')
      .addSeparator()
      .addItem('🔄 Refresh ICP Ranked View Only', 'Refresh_ICP_Ranked')
      .addItem('🔄 Refresh BD Contacts Only (Full Flat)', 'refreshBDContactsFull')
      .addSeparator()
      .addItem('🔗 Enrich Placement Domains & HM Keys', 'Enrich_Placement_Domains')
      .addSeparator()
      .addItem('🔍 Run HM Dedup (NO_LI → LinkedIn)', 'runHMDedupBatch')
      .addItem('✅ Process HM Dedup Review Decisions', 'processHMDedupReviewDecisions')
    )
    .addSeparator()
    .addSubMenu(ui.createMenu('🔍 SDI Scout')
      .addItem('▶ Run SDI Scout (Sidebar)', 'openSDIScoutSidebar')
      .addSeparator()
      .addItem('🔄 Manual Behavioral Rollup', 'manualBehavioralRollup')
    )
    .addSeparator()
    .addSubMenu(ui.createMenu('🔧 Maintenance')
      .addItem('Ensure Identity Formulas (BD_Contacts)', 'Phase3_3_EnsureIdentityFormulas')
      .addSeparator()
      .addItem('⚙️ Setup BD Workflow (Data Validation + Formatting)', 'Setup_BD_Workflow_Complete')
      .addItem('🔍 Check Workflow Status', 'TEST_CheckWorkflowStatus')
      .addSeparator()
      .addItem('🔢 Get and Set Sheet GIDs (Auto-configure Admin)', 'UTIL_GetAndSetSheetGIDs')
      .addItem('🔧 Fix: Restore ARRAYFORMULA (Column M)', 'FIX_RestoreArrayFormulaColumnM')
      .addSeparator()
      .addItem('🏭 Enrich Industry with Gemini', 'Enrich_Industry_With_Gemini')
      .addItem('🏢 Enrich Ownership with Gemini', 'Enrich_Ownership_With_Gemini')
      .addItem('🤖 Enrich Size/Revenue with Gemini', 'Enrich_SizeRevenue_With_Gemini')
      .addItem('🌎 Enrich Region Tier 3 with Gemini', 'Enrich_Region_Tier3_With_Gemini')
    )
    .addSeparator()
    .addItem('📊 About BD Tracker...', 'showAbout')
    .addToUi();
}

/**
 * Show About dialog
 * Displays version and project information
 */
function showAbout() {
  const html = `
    <div style="font-family: Arial, sans-serif; padding: 10px;">
      <h2>BD Tracker v4.0.0</h2>
      <p><strong>Purpose:</strong> Automated BD workflow engine</p>
      <p><strong>Components:</strong></p>
      <ul>
        <li>Drive Import: CSV ingestion from Drive folders (LinkedIn, Lusha, Crunchbase, Bullhorn)</li>
        <li>Enrichment Chain: 4-step Gemini pipeline (Industry, Ownership, Size/Revenue, Region)</li>
        <li>ICP Scoring: Firmographics + Behavioral + HM Signals scoring</li>
        <li>Campaign Engine v2: Multi-channel 8-touch campaigns via Claude + Serper + Gemini</li>
        <li>SDI Scout: Company signal detection via Serper + Gemini</li>
        <li>HM Dedup: Gemini-powered NO_LI → LinkedIn record matching</li>
      </ul>
      <p><strong>Tech Stack:</strong> Google Apps Script, Google Sheets, Gemini Flash, Claude API, Serper API</p>
      <p><strong>Last Updated:</strong> 2026-02-15</p>
      <hr>
      <p style="font-size: 11px; color: #666;">
        Engineering Laws: Anti-getLastRow, Batch Processing, Identity Integrity, Preview-First
      </p>
    </div>
  `;

  const htmlOutput = HtmlService.createHtmlOutput(html)
    .setWidth(400)
    .setHeight(350);

  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'About BD Tracker');
}
