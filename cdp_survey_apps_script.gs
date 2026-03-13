// ═══════════════════════════════════════════════════════════════
//  CDP WORKSHOP SURVEY — Google Apps Script Backend
//  Deploy as a Web App (Execute as: Me, Access: Anyone)
// ═══════════════════════════════════════════════════════════════

const SHEET_NAME_RESPONSES  = 'Responses';
const SHEET_NAME_OPEN       = 'Open Questions';
const SHEET_NAME_SUMMARY    = 'Summary';

// ── Entry point: POST (survey submission) ──────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Write individual responses (one row per requirement)
    const respSheet = getOrCreateSheet(ss, SHEET_NAME_RESPONSES, [
      'Timestamp', 'Respondent', 'Role', 'Req ID', 'Requirement', 'Theme',
      'Importance', 'Importance Score', 'Complexity'
    ]);

    const IMPORTANCE_SCORE = { 'Must Have': 3, 'Should Have': 2, 'Nice to Have': 1, 'Not Needed': 0 };
    const now = new Date().toISOString();

    payload.responses.forEach(row => {
      respSheet.appendRow([
        now,
        payload.respondent,
        payload.role,
        row.req_id,
        row.req_title,
        row.theme,
        row.importance,
        IMPORTANCE_SCORE[row.importance] || 0,
        row.complexity
      ]);
    });

    // 2. Write open-ended answers
    const openSheet = getOrCreateSheet(ss, SHEET_NAME_OPEN, [
      'Timestamp', 'Respondent', 'Role',
      'Q1: Biggest difference', 'Q2: Missing capabilities', 'Q3: 12-month outcome'
    ]);
    openSheet.appendRow([
      now,
      payload.respondent,
      payload.role,
      payload.open_q1 || '',
      payload.open_q2 || '',
      payload.open_q3 || ''
    ]);

    // 3. Rebuild summary sheet
    rebuildSummary(ss);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Entry point: GET (admin dashboard data fetch) ──────────────
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'get';

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const respSheet = ss.getSheetByName(SHEET_NAME_RESPONSES);

    if (!respSheet) {
      return jsonResponse({ rows: [] });
    }

    const data = respSheet.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ rows: [] });

    const headers = data[0];
    const rows = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h.toLowerCase().replace(/ /g, '_')] = row[i]; });
      return obj;
    });

    return jsonResponse({ rows });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── Rebuild Summary sheet ──────────────────────────────────────
function rebuildSummary(ss) {
  let sumSheet = ss.getSheetByName(SHEET_NAME_SUMMARY);
  if (!sumSheet) {
    sumSheet = ss.insertSheet(SHEET_NAME_SUMMARY);
  } else {
    sumSheet.clearContents();
  }

  const respSheet = ss.getSheetByName(SHEET_NAME_RESPONSES);
  if (!respSheet) return;

  const data = respSheet.getDataRange().getValues();
  if (data.length < 2) return;

  // Aggregate by req_id
  const agg = {};
  const IMPORTANCE_SCORE = { 'Must Have': 3, 'Should Have': 2, 'Nice to Have': 1, 'Not Needed': 0 };

  data.slice(1).forEach(row => {
    const reqId    = row[3];
    const reqTitle = row[4];
    const theme    = row[5];
    const imp      = row[6];
    const impScore = Number(row[7]) || 0;
    const cx       = row[8];

    if (!agg[reqId]) {
      agg[reqId] = {
        reqId, reqTitle, theme,
        must: 0, should: 0, nice: 0, not: 0,
        scoreSum: 0, count: 0,
        cxLow: 0, cxMed: 0, cxHigh: 0
      };
    }

    agg[reqId].count++;
    agg[reqId].scoreSum += impScore;

    if (imp === 'Must Have')    agg[reqId].must++;
    if (imp === 'Should Have')  agg[reqId].should++;
    if (imp === 'Nice to Have') agg[reqId].nice++;
    if (imp === 'Not Needed')   agg[reqId].not++;

    if (cx === 'Low')    agg[reqId].cxLow++;
    if (cx === 'Medium') agg[reqId].cxMed++;
    if (cx === 'High')   agg[reqId].cxHigh++;
  });

  // Count respondents
  const respondents = new Set(data.slice(1).map(r => r[1]));
  const numRespondents = respondents.size;
  const maxScore = numRespondents * 3;

  // Write summary
  const summaryHeaders = [
    'Req ID', 'Requirement', 'Theme', 'Respondents',
    'Must Have', 'Should Have', 'Nice to Have', 'Not Needed',
    'Score Sum', 'Priority % (of max)',
    'Complexity: Low', 'Complexity: Medium', 'Complexity: High', 'Top Complexity'
  ];
  const summaryRows = Object.values(agg)
    .sort((a, b) => b.scoreSum - a.scoreSum || b.must - a.must)
    .map((r, i) => {
      const pct = maxScore > 0 ? Math.round((r.scoreSum / maxScore) * 100) : 0;
      const topCx = r.cxHigh >= r.cxMed && r.cxHigh >= r.cxLow ? 'High'
        : r.cxMed >= r.cxLow ? 'Medium' : 'Low';
      return [
        r.reqId, r.reqTitle, r.theme, numRespondents,
        r.must, r.should, r.nice, r.not,
        r.scoreSum, pct,
        r.cxLow, r.cxMed, r.cxHigh, topCx
      ];
    });

  sumSheet.appendRow(summaryHeaders);
  summaryRows.forEach(row => sumSheet.appendRow(row));

  // Basic formatting
  sumSheet.getRange(1, 1, 1, summaryHeaders.length)
    .setFontWeight('bold')
    .setBackground('#0f2340')
    .setFontColor('#ffffff');
}

// ── Helpers ────────────────────────────────────────────────────
function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#0f2340')
      .setFontColor('#ffffff');
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
