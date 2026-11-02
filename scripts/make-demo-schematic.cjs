/**
 * Generates public/demo/KK67-DEMO-schematic.pdf — an original, searchable
 * schematic for the procedural demo board. Run: node scripts/make-demo-schematic.cjs
 * (uses the Playwright Chromium available in the dev environment).
 */
const { chromium } = require('playwright');
const path = require('path');

const ic = (x, y, name, value, left, right, w = 260) => {
  const rows = Math.max(left.length, right.length);
  const h = rows * 26 + 30;
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="body"/>`;
  s += `<text x="${x + w / 2}" y="${y - 22}" class="ref">${name}</text><text x="${x + w / 2}" y="${y - 6}" class="val">${value}</text>`;
  left.forEach(([pin, net, fn], i) => {
    const py = y + 28 + i * 26;
    s += `<line x1="${x - 70}" y1="${py}" x2="${x}" y2="${py}" class="wire"/><text x="${x - 6}" y="${py - 4}" class="pin" text-anchor="end">${pin}</text>`;
    s += `<text x="${x + 8}" y="${py + 4}" class="fn">${fn || ''}</text><text x="${x - 76}" y="${py + 4}" class="net" text-anchor="end">${net}</text>`;
  });
  right.forEach(([pin, net, fn], i) => {
    const py = y + 28 + i * 26;
    s += `<line x1="${x + w}" y1="${py}" x2="${x + w + 70}" y2="${py}" class="wire"/><text x="${x + w + 6}" y="${py - 4}" class="pin">${pin}</text>`;
    s += `<text x="${x + w - 8}" y="${py + 4}" class="fn" text-anchor="end">${fn || ''}</text><text x="${x + w + 76}" y="${py + 4}" class="net">${net}</text>`;
  });
  return s;
};
const passive = (x, y, ref, val, a, b, cap) => {
  let s = `<line x1="${x}" y1="${y - 50}" x2="${x}" y2="${y - 18}" class="wire"/><line x1="${x}" y1="${y + 18}" x2="${x}" y2="${y + 50}" class="wire"/>`;
  s += cap
    ? `<line x1="${x - 14}" y1="${y - 4}" x2="${x + 14}" y2="${y - 4}" class="sym"/><line x1="${x - 14}" y1="${y + 4}" x2="${x + 14}" y2="${y + 4}" class="sym"/><line x1="${x}" y1="${y - 18}" x2="${x}" y2="${y - 4}" class="wire"/><line x1="${x}" y1="${y + 4}" x2="${x}" y2="${y + 18}" class="wire"/>`
    : `<rect x="${x - 7}" y="${y - 18}" width="14" height="36" class="sym" fill="none"/>`;
  s += `<text x="${x + 18}" y="${y - 2}" class="ref2">${ref}</text><text x="${x + 18}" y="${y + 13}" class="val">${val}</text>`;
  s += `<text x="${x}" y="${y - 56}" class="net" text-anchor="middle">${a}</text><text x="${x}" y="${y + 64}" class="net" text-anchor="middle">${b}</text>`;
  return s;
};

const sheet = (n, title, body) => `
<section class="sheet"><svg viewBox="0 0 1600 1100" xmlns="http://www.w3.org/2000/svg">
<rect x="20" y="20" width="1560" height="1060" class="frame"/>
${body}
<g class="tb"><rect x="1180" y="960" width="400" height="120"/><line x1="1180" y1="1000" x2="1580" y2="1000"/>
<text x="1196" y="988" class="tbt">KK67 DEMO MLB — ${title}</text>
<text x="1196" y="1026" class="tbs">Sheet ${n} / 3 · Rev 1.0 · Original demo for Boardview KK67</text>
<text x="1196" y="1050" class="tbs">Not a real product schematic</text></g>
</svg></section>`;

const html = `<!doctype html><html><head><style>
@page { size: 420mm 297mm; margin: 0; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
.sheet { width: 420mm; height: 297mm; page-break-after: always; overflow: hidden; }
.sheet:last-child { page-break-after: auto; }
svg { width: 100%; height: 100%; }
.frame { fill: none; stroke: #444; stroke-width: 2; }
.body { fill: #fffbe6; stroke: #7a1f1f; stroke-width: 2.4; }
.wire { stroke: #0b5d1e; stroke-width: 1.8; }
.sym { stroke: #7a1f1f; stroke-width: 2.4; }
.ref { font: bold 17px Arial; fill: #7a1f1f; text-anchor: middle; }
.ref2 { font: bold 14px Arial; fill: #7a1f1f; }
.val { font: 12px Arial; fill: #555; text-anchor: start; }
.ic .val { text-anchor: middle; }
.pin { font: 11px Arial; fill: #7a1f1f; }
.fn { font: 11px Arial; fill: #333; }
.net { font: bold 12px Arial; fill: #0b3d91; }
.h { font: bold 24px Arial; fill: #222; }
.note { font: 13px Arial; fill: #555; }
.tb rect, .tb line { fill: none; stroke: #444; stroke-width: 2; }
.tbt { font: bold 15px Arial; } .tbs { font: 11px Arial; fill: #555; }
</style></head><body>
${sheet(1, 'CHARGER / DC-IN', `
<text x="60" y="80" class="h">CHARGER &amp; DC-IN</text>
<text x="60" y="104" class="note">Adapter detection, input FETs and battery charger. PPBUS_G3H is the main always-on rail.</text>
<g class="ic">${ic(640, 260, 'U7000', 'BQ-CHG 28-QFN', [
  ['1', 'DCIN', 'VIN'], ['2', 'ACIN', 'ACDET'], ['3', 'PPBUS_G3H', 'SYS'], ['4', 'CHG_BST', 'BTST'], ['5', 'CHG_LX', 'PHASE'],
  ['6', 'CHG_DH', 'HIDRV'], ['7', 'CHG_DL', 'LODRV'], ['8', 'GND', 'PGND'], ['9', 'PPVBAT', 'BAT'], ['10', 'CHG_CSP', 'SRP'],
  ['11', 'CHG_CSN', 'SRN'], ['12', 'EC_SMB_CK1', 'SCL'], ['13', 'EC_SMB_DA1', 'SDA'], ['14', 'CHG_ACOK', 'ACOK'],
], [
  ['15', 'PP3V3_S5', 'VDDP'], ['16', 'GND', 'AGND'], ['17', 'DCIN', 'VIN'], ['18', 'ACIN', 'ACDET'], ['19', 'PPBUS_G3H', 'SYS'],
  ['20', 'CHG_BST', 'BTST'], ['21', 'CHG_LX', 'PHASE'], ['22', 'CHG_DH', 'HIDRV'], ['23', 'CHG_DL', 'LODRV'], ['24', 'GND', 'PGND'],
  ['25', 'PPVBAT', 'BAT'], ['26', 'CHG_CSP', 'SRP'], ['27', 'CHG_CSN', 'SRN'], ['28', 'EC_SMB_CK1', 'SCL'],
])}</g>
${ic(110, 300, 'J6900', 'DC JACK 4P', [], [['1', 'DCIN', ''], ['2', 'GND', ''], ['3', 'ADAPTER_ID', ''], ['4', 'GND', '']], 120)}
${ic(110, 640, 'Q7000', 'N-MOSFET', [], [['1', 'DCIN', 'D'], ['2', 'DCIN', 'D'], ['3', 'CHG_LX', 'S'], ['4', 'CHG_DH', 'G']], 120)}
${ic(1330, 640, 'Q7010', 'N-MOSFET', [['1', 'DCIN', 'D'], ['2', 'DCIN', 'D'], ['3', 'PPBUS_G3H', 'S'], ['4', 'CHG_DH', 'G']], [], 120)}
${ic(1330, 260, 'J8000', 'BATTERY 10P', [['1', 'PPVBAT', ''], ['2', 'PPVBAT', ''], ['3', 'PPVBAT', ''], ['4', 'BATT_PRES_L', ''], ['5', 'EC_SMB_CK1', ''], ['6', 'EC_SMB_DA1', ''], ['7', 'BATT_TEMP', ''], ['8', 'GND', '']], [], 140)}
`)}
${sheet(2, 'CPU VCORE', `
<text x="60" y="80" class="h">CPU VCORE — 2 PHASE</text>
<text x="60" y="104" class="note">Controller U7400 drives Q7400-Q7430 into L7400-L7430. Output rail: PPVCC_CORE (U1000).</text>
<g class="ic">${ic(640, 240, 'U7400', 'VR-CTRL 32-QFN', [
  ['1', 'PPBUS_G3H', 'VIN'], ['2', 'VR_BOOT1', 'BOOT1'], ['3', 'VR_PHASE1', 'PH1'], ['4', 'VR_UGATE1', 'UG1'], ['5', 'VR_LGATE1', 'LG1'],
  ['6', 'VR_BOOT2', 'BOOT2'], ['7', 'VR_PHASE2', 'PH2'], ['8', 'VR_UGATE2', 'UG2'],
], [
  ['9', 'VR_LGATE2', 'LG2'], ['10', 'GND', 'GND'], ['11', 'PP5V_S0', 'VCC'], ['12', 'VR_EN', 'EN'], ['13', 'VR_PGOOD', 'PGOOD'],
  ['14', 'SVID_CLK', 'SCLK'], ['15', 'SVID_DATA', 'SDIO'], ['16', 'SVID_ALERT_L', 'ALERT#'],
])}</g>
${[0, 1, 2, 3].map((i) => ic(140 + i * 340, 620, `Q74${i}0`, 'POWER STAGE', [], [['1', 'PPBUS_G3H', 'VIN'], ['4', `VR_UGATE${(i % 2) + 1}`, 'G'], ['5', `VR_PHASE${(i % 2) + 1}`, 'SW']], 110)).join('')}
${[0, 1, 2, 3].map((i) => passive(200 + i * 340, 900, `L74${i}0`, '0.22uH', `VR_PHASE${(i % 2) + 1}`, 'PPVCC_CORE', false)).join('')}
<text x="60" y="1040" class="note">Bulk caps C1001-C1196 on bottom side under U1000: PPVCC_CORE to GND, 22uF 0402.</text>
`)}
${sheet(3, 'EC / BIOS', `
<text x="60" y="80" class="h">EMBEDDED CONTROLLER &amp; SPI ROM</text>
<g class="ic">${ic(560, 200, 'U4100', 'KBC-EC 128-LQFP', [
  ['1', 'EC_SMB_CK1', 'SMB0_CLK'], ['2', 'EC_SMB_DA1', 'SMB0_DAT'], ['3', 'KBC_ROW0', 'KSI0'], ['4', 'KBC_ROW1', 'KSI1'], ['7', 'KBC_COL0', 'KSO0'],
  ['9', 'GND', 'VSS'], ['10', 'PP3V3_S5', 'VCC'], ['11', 'LPC_AD0', 'LAD0'], ['12', 'LPC_AD1', 'LAD1'], ['13', 'LPC_AD2', 'LAD2'], ['14', 'LPC_AD3', 'LAD3'],
], [
  ['15', 'LPC_FRAME_L', 'LFRAME#'], ['16', 'PLT_RST_L', 'LRESET#'], ['17', 'EC_PWRBTN_L', 'PWRBTN#'], ['18', 'PM_SLP_S3_L', 'SLP_S3#'],
  ['19', 'PM_SLP_S4_L', 'SLP_S4#'], ['20', 'ACIN', 'ACIN'], ['21', 'BATT_PRES_L', 'BATT#'], ['22', 'FAN_PWM', 'PWM0'], ['23', 'FAN_TACH', 'TACH0'],
  ['24', 'LID_SW_L', 'LID#'], ['25', 'EC_RST_L', 'ECRST#'],
], 300)}</g>
${ic(160, 660, 'U6100', 'SPI FLASH 128Mb', [], [['1', 'SPI_CS0_L', 'CS#'], ['2', 'SPI_MISO', 'DO'], ['3', 'SPI_WP_L', 'WP#'], ['4', 'GND', 'GND'], ['5', 'SPI_MOSI', 'DI'], ['6', 'SPI_CLK', 'CLK'], ['7', 'SPI_HOLD_L', 'HOLD#'], ['8', 'PP3V3_S5', 'VCC']], 150)}
${ic(1180, 660, 'U6150', 'TEMP SENSOR', [['1', 'EC_SMB_CK1', 'SCL'], ['2', 'EC_SMB_DA1', 'SDA'], ['3', 'TEMP_ALERT_L', 'ALERT#'], ['4', 'GND', 'GND'], ['5', 'THRM_DP', 'D+'], ['6', 'THRM_DN', 'D-'], ['7', 'PP3V3_S5', 'VDD']], [], 150)}
`)}
</body></html>`;

(async () => {
  const out = path.join(__dirname, '..', 'public', 'demo', 'KK67-DEMO-schematic.pdf');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  await page.pdf({ path: out, width: '420mm', height: '297mm', printBackground: true });
  await browser.close();
  console.log('written', out);
})();
