/**
 * Procedural demo motherboard, emitted as a genuine BRD text file so the
 * sample travels through the exact same parser pipeline as real boards.
 * Deterministic (seeded) so screenshots and tests are reproducible.
 */

interface DPin { x: number; y: number; net: string }
interface DPart { name: string; type: number; pins: DPin[] }

const TOP = 5;
const BOTTOM = 10;
const THROUGH = 3;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

export function generateDemoBRD(): string {
  const rand = rng(0x6b6b67);
  const parts: DPart[] = [];
  const nails: { x: number; y: number; side: number; net: string }[] = [];
  // Occupied areas per side (top=5 / bottom=10, through-hole blocks both) for overlap-free placement.
  const occupied: { x0: number; y0: number; x1: number; y1: number; type: number }[] = [];
  const add = (name: string, type: number, pins: DPin[]) => {
    parts.push({ name, type, pins });
    const xs = pins.map((p) => p.x), ys = pins.map((p) => p.y);
    occupied.push({ x0: Math.min(...xs) - 40, y0: Math.min(...ys) - 40, x1: Math.max(...xs) + 40, y1: Math.max(...ys) + 40, type });
  };
  const free = (x: number, y: number, r: number, type: number) =>
    occupied.every((o) => (o.type !== type && o.type !== THROUGH && type !== THROUGH) || x + r < o.x0 || x - r > o.x1 || y + r < o.y0 || y - r > o.y1);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

  // ---- Outline: 12000 x 7600 mil board with notches and a fan cut-out
  const W = 12000, H = 7600;
  const outline = [
    [0, 0], [W, 0], [W, 2600], [W - 500, 2600], [W - 500, 3400], [W, 3400], [W, H],
    [6200, H], [6200, H - 700], [4400, H - 700], [4400, H], [0, H], [0, 0],
  ];

  // ---- BGA helper
  const bga = (name: string, cx: number, cy: number, n: number, pitch: number, netFor: (r: number, c: number) => string | null, type = TOP) => {
    const pins: DPin[] = [];
    const off = ((n - 1) * pitch) / 2;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const net = netFor(r, c);
        if (net) pins.push({ x: Math.round(cx - off + c * pitch), y: Math.round(cy + off - r * pitch), net });
      }
    add(name, type, pins);
  };

  const ring = (r: number, c: number, n: number) => Math.min(r, c, n - 1 - r, n - 1 - c);

  // CPU
  let dq = 0, pcie = 0;
  bga('U1000', 3900, 4300, 34, 40, (r, c) => {
    const k = ring(r, c, 34);
    if (k >= 12 && k <= 14 && (r + c) % 7 === 0) return null; // depopulated ring
    if (k < 3) return (r + c) % 3 === 0 ? 'GND' : r < 17 ? `MEM_A_DQ${dq++ % 64}` : `MEM_B_DQ${dq++ % 64}`;
    if (k < 6) return (r + c) % 4 === 0 ? 'GND' : c < 17 ? `PCIE_TX${pcie++ % 16}_P` : `PCIE_RX${pcie++ % 16}_N`;
    if (k < 12) return (r + c) % 2 === 0 ? 'GND' : (r * c) % 5 === 0 ? 'PP1V05_S0' : 'PP1V2_VDDQ';
    return (r + c) % 2 === 0 ? 'GND' : 'PPVCC_CORE';
  });

  // PCH
  let usb = 0, sata = 0;
  bga('U1800', 7700, 4300, 22, 32, (r, c) => {
    const k = ring(r, c, 22);
    if (k < 2) return (r * 3 + c) % 4 === 0 ? 'GND' : c > 11 ? `USB2_D${usb++ % 10}_${usb % 2 ? 'P' : 'N'}` : `SATA_TX${sata++ % 4}`;
    if (k < 5) return (r + c) % 3 === 0 ? 'GND' : pick(['LPC_AD0', 'LPC_AD1', 'LPC_AD2', 'LPC_AD3', 'LPC_FRAME_L', 'PLT_RST_L', 'PM_SLP_S3_L', 'PM_SLP_S4_L', 'PM_PWRBTN_L', 'SPI_CLK', 'SPI_MOSI', 'SPI_MISO', 'SPI_CS0_L']);
    return (r + c) % 2 === 0 ? 'GND' : pick(['PP1V05_S0', 'PP3V3_S5', 'PP1V8_S5']);
  });

  // QFP helper (pins around 4 sides)
  const qfp = (name: string, cx: number, cy: number, perSide: number, pitch: number, span: number, nets: string[], type = TOP) => {
    const pins: DPin[] = [];
    const off = ((perSide - 1) * pitch) / 2;
    for (let s = 0; s < 4; s++)
      for (let i = 0; i < perSide; i++) {
        const t = -off + i * pitch;
        const [x, y] = s === 0 ? [-span, off - (i * pitch)] : s === 1 ? [t, -span] : s === 2 ? [span, -off + i * pitch] : [-t, span];
        pins.push({ x: Math.round(cx + x), y: Math.round(cy + y), net: nets[(s * perSide + i) % nets.length] });
      }
    add(name, type, pins);
  };

  qfp('U4100', 9700, 1800, 32, 20, 420, [
    'EC_SMB_CK1', 'EC_SMB_DA1', 'KBC_ROW0', 'KBC_ROW1', 'KBC_ROW2', 'KBC_ROW3', 'KBC_COL0', 'KBC_COL1', 'GND', 'PP3V3_S5',
    'LPC_AD0', 'LPC_AD1', 'LPC_AD2', 'LPC_AD3', 'LPC_FRAME_L', 'PLT_RST_L', 'EC_PWRBTN_L', 'PM_SLP_S3_L', 'PM_SLP_S4_L',
    'ACIN', 'BATT_PRES_L', 'FAN_PWM', 'FAN_TACH', 'LID_SW_L', 'EC_RST_L', 'GND', 'PP3V3_S5', 'SPI_CS0_L',
  ]);
  qfp('U7000', 1900, 1500, 7, 26, 120, ['DCIN', 'ACIN', 'PPBUS_G3H', 'CHG_BST', 'CHG_LX', 'CHG_DH', 'CHG_DL', 'GND', 'PPVBAT', 'CHG_CSP', 'CHG_CSN', 'EC_SMB_CK1', 'EC_SMB_DA1', 'CHG_ACOK', 'PP3V3_S5', 'GND']);
  qfp('U7400', 2500, 2550, 8, 26, 130, ['PPBUS_G3H', 'VR_BOOT1', 'VR_PHASE1', 'VR_UGATE1', 'VR_LGATE1', 'VR_BOOT2', 'VR_PHASE2', 'VR_UGATE2', 'VR_LGATE2', 'GND', 'PP5V_S0', 'VR_EN', 'VR_PGOOD', 'SVID_CLK', 'SVID_DATA', 'SVID_ALERT_L']);

  // SOIC-8 BIOS on bottom
  const soic = (name: string, cx: number, cy: number, nets: string[], type: number) => {
    const pins: DPin[] = [];
    for (let i = 0; i < 4; i++) pins.push({ x: cx - 120, y: cy + 75 - i * 50, net: nets[i] });
    for (let i = 0; i < 4; i++) pins.push({ x: cx + 120, y: cy - 75 + i * 50, net: nets[4 + i] });
    add(name, type, pins);
  };
  soic('U6100', 8900, 6300, ['SPI_CS0_L', 'SPI_MISO', 'SPI_WP_L', 'GND', 'SPI_MOSI', 'SPI_CLK', 'SPI_HOLD_L', 'PP3V3_S5'], BOTTOM);
  soic('U6150', 10600, 5600, ['EC_SMB_CK1', 'EC_SMB_DA1', 'TEMP_ALERT_L', 'GND', 'THRM_DP', 'THRM_DN', 'PP3V3_S5', 'PP3V3_S5'], TOP);

  // VRM power stage: MOSFET pairs + inductors around the CPU
  for (let i = 0; i < 4; i++) {
    const x = 1500 + i * 520, y = 6500;
    const ph = `VR_PHASE${(i % 2) + 1}`;
    add(`Q74${i}0`, TOP, [
      { x: x - 60, y: y + 90, net: 'PPBUS_G3H' }, { x: x - 20, y: y + 90, net: 'PPBUS_G3H' }, { x: x + 20, y: y + 90, net: 'PPBUS_G3H' },
      { x: x + 60, y: y + 90, net: `VR_UGATE${(i % 2) + 1}` }, { x: x, y: y - 40, net: ph },
    ]);
    add(`L74${i}0`, TOP, [{ x: x - 130, y: y - 380, net: ph }, { x: x + 130, y: y - 380, net: 'PPVCC_CORE' }]);
  }
  for (let i = 0; i < 2; i++) {
    add(`Q70${i}0`, TOP, [
      { x: 900 + i * 380, y: 600, net: 'DCIN' }, { x: 960 + i * 380, y: 600, net: 'DCIN' },
      { x: 930 + i * 380, y: 760, net: i ? 'PPBUS_G3H' : 'CHG_LX' }, { x: 1010 + i * 380, y: 600, net: 'CHG_DH' },
    ]);
  }

  // Connectors
  const row = (name: string, x0: number, y0: number, n: number, dx: number, dy: number, nets: (i: number) => string, type = TOP) =>
    add(name, type, Array.from({ length: n }, (_, i) => ({ x: x0 + i * dx, y: y0 + i * dy, net: nets(i) })));
  const dimm = (i: number) => (i % 6 === 0 ? 'GND' : i % 11 === 0 ? 'PP1V2_VDDQ' : `MEM_B_${i % 2 ? 'DQ' : 'A'}${i % 64}`);
  row('J2600', 6500, 7200, 100, 24, 0, dimm);
  row('J2601', 6500, 7120, 100, 24, 0, (i) => dimm(i + 100));
  add('J6900', THROUGH, [{ x: 300, y: 400, net: 'DCIN' }, { x: 300, y: 700, net: 'GND' }, { x: 560, y: 550, net: 'ADAPTER_ID' }, { x: 120, y: 550, net: 'GND' }]);
  row('J4500', 11500, 900, 9, 0, 80, (i) => ['PP5V_USB', 'USB2_D0_N', 'USB2_D0_P', 'GND', 'USB3_RX_N', 'USB3_RX_P', 'GND', 'USB3_TX_N', 'USB3_TX_P'][i]);
  row('J8000', 600, 3600, 10, 0, 90, (i) => ['PPVBAT', 'PPVBAT', 'PPVBAT', 'BATT_PRES_L', 'EC_SMB_CK1', 'EC_SMB_DA1', 'BATT_TEMP', 'GND', 'GND', 'GND'][i]);
  row('J9000', 10200, 7100, 40, 32, 0, (i) => (i % 5 === 0 ? 'GND' : i < 8 ? 'PP3V3_LCD' : i < 30 ? `EDP_TX${i % 4}_${i % 2 ? 'P' : 'N'}` : pick(['EDP_HPD', 'BKLT_EN', 'BKLT_PWM', 'PPVOUT_BL'])));

  // Passives: decoupling under CPU (bottom), plus scattered signal passives
  let cn = 1, rn = 1;
  const twoPin = (prefix: string, x: number, y: number, a: string, b: string, type: number, horiz = rand() > 0.5, len = 40) => {
    const name = `${prefix}${prefix === 'C' ? 1000 + cn++ : 2000 + rn++}`;
    add(name, type, horiz
      ? [{ x: x - len / 2, y, net: a }, { x: x + len / 2, y, net: b }]
      : [{ x, y: y - len / 2, net: a }, { x, y: y + len / 2, net: b }]);
  };
  for (let gx = 0; gx < 14; gx++) for (let gy = 0; gy < 14; gy++) {
    twoPin('C', 3900 - 600 + gx * 92, 4300 - 600 + gy * 92, 'PPVCC_CORE', 'GND', BOTTOM, gy % 2 === 0, 36);
  }
  for (let gx = 0; gx < 10; gx++) for (let gy = 0; gy < 10; gy++) {
    if ((gx + gy) % 3) twoPin('C', 7700 - 300 + gx * 66, 4300 - 300 + gy * 66, pick(['PP1V05_S0', 'PP3V3_S5', 'PP1V8_S5']), 'GND', BOTTOM, gx % 2 === 0, 30);
  }
  const rails = ['PP3V3_S5', 'PP1V8_S5', 'PP5V_S0', 'PP1V05_S0', 'PPBUS_G3H', 'PP3V3_S0'];
  const sigs = ['PM_SLP_S3_L', 'PM_SLP_S4_L', 'PLT_RST_L', 'EC_RST_L', 'VR_EN', 'VR_PGOOD', 'CHG_ACOK', 'LID_SW_L', 'FAN_PWM', 'BKLT_EN', 'SPI_WP_L', 'SPI_HOLD_L', 'EDP_HPD', 'TEMP_ALERT_L', 'SVID_ALERT_L', 'BATT_PRES_L', 'ADAPTER_ID'];
  let placed = 0;
  while (placed < 520) {
    const x = 400 + rand() * (W - 800);
    const y = 400 + rand() * (H - 1300);
    const isCap = rand() > 0.45;
    const side = rand() > 0.35 ? TOP : BOTTOM;
    if (!free(x, y, 70, side)) continue;
    if (isCap) twoPin('C', Math.round(x), Math.round(y), pick(rails), 'GND', side);
    else twoPin('R', Math.round(x), Math.round(y), pick(sigs), pick(rails.concat(['GND'])), side);
    placed++;
  }

  // Test points (nails) on the main rails, bottom side
  ['PPBUS_G3H', 'PP3V3_S5', 'PP5V_S0', 'PP1V05_S0', 'PPVCC_CORE', 'PP1V2_VDDQ', 'DCIN', 'PPVBAT', 'PP1V8_S5', 'GND'].forEach((net, i) => {
    nails.push({ x: 1200 + i * 950, y: 300 + (i % 3) * 140, side: 2, net });
  });

  // ---- Serialise as BRD
  const lines: string[] = ['str_length: 0 0 0 0', 'var_data:'];
  const pinCount = parts.reduce((n, p) => n + p.pins.length, 0);
  lines.push(`${outline.length} ${parts.length} ${pinCount} ${nails.length}`, 'Format:');
  for (const [x, y] of outline) lines.push(`${x} ${y}`);
  lines.push('Parts:');
  let end = 0;
  for (const p of parts) {
    end += p.pins.length;
    lines.push(`${p.name} ${p.type} ${end}`);
  }
  lines.push('Pins:');
  parts.forEach((p, i) => {
    for (const pin of p.pins) lines.push(`${pin.x} ${pin.y} -99 ${i + 1} ${pin.net}`);
  });
  lines.push('Nails:');
  nails.forEach((n, i) => lines.push(`${i + 1} ${n.x} ${n.y} ${n.side} ${n.net}`));
  return lines.join('\n') + '\n';
}
