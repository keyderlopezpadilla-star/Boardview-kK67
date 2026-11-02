import { describe, expect, it } from 'vitest';
import { zipSync, zlibSync, strToU8 } from 'fflate';
import { buildBoard, classifyNet } from '../src/core/board';
import { decodeBDV, parseBDV } from '../src/parsers/asc';
import { decodeBRD, encodeBRD, parseBRD } from '../src/parsers/brd';
import { parseBVR3 } from '../src/parsers/bvr';
import { parseFZ } from '../src/parsers/fz';
import { parseGenCAD } from '../src/parsers/gencad';
import { desBlock, desDecryptECB, desKeySchedule, parseDesKey } from '../src/crypto/des';
import { generateDemoBRD } from '../src/demo/demoBoard';
import { loadFiles } from '../src/worker/pipeline';

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe('crypto', () => {
  it('DES matches the classic FIPS test vector', () => {
    const key = parseDesKey('133457799BBCDFF1')!;
    const ks = desKeySchedule(key);
    const pt = Uint8Array.from([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
    const ct = desBlock(pt, ks, false);
    expect(hex(ct)).toBe('85e813540f0ab405');
    expect(hex(desBlock(ct, ks, true))).toBe('0123456789abcdef');
  });

  it('table-driven DES matches the reference on random data (incl. partial block)', () => {
    const ks = desKeySchedule(parseDesKey('0E329232EA6D0D73')!);
    let seed = 7;
    const data = Uint8Array.from({ length: 8 * 64 + 5 }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);
    const fast = desDecryptECB(data, ks);
    for (let o = 0; o < data.length; o += 8) {
      const blk = new Uint8Array(8);
      blk.set(data.subarray(o, o + 8));
      const ref = desBlock(blk, ks, true).subarray(0, Math.min(8, data.length - o));
      expect(hex(fast.subarray(o, o + ref.length))).toBe(hex(ref));
    }
  });
});

describe('BRD', () => {
  const sample = `str_length:\nvar_data:\n5 2 4 1\nFormat:\n0 0\n1000 0\n1000 500\n0 500\n0 0\nParts:\nR1 5 2\nC1 10 4\nPins:\n100 100 -99 1 PP3V3_S5\n140 100 -99 1 GND\n300 300 -99 2 GND\n340 300 -99 2 SIG_A\nNails:\n1 500 250 2 SIG_A\n`;

  it('parses plain text', () => {
    const raw = parseBRD(enc(sample));
    expect(raw.parts).toHaveLength(2);
    expect(raw.parts[0].side).toBe('top');
    expect(raw.parts[1].side).toBe('bottom');
    expect(raw.pins[3].net).toBe('SIG_A');
    expect(raw.nails[0].side).toBe('bottom');
  });

  it('round-trips the encoded variant', () => {
    const plain = enc(sample);
    const encoded = encodeBRD(plain);
    // encoded files start with the 0x23 0xe2 0x63 0x28 signature ("str_" encoded)
    expect(Array.from(encoded.subarray(0, 4))).toEqual([0x23, 0xe2, 0x63, 0x28]);
    expect(decodeBRD(encoded)).toEqual(plain);
    expect(parseBRD(encoded).pins).toHaveLength(4);
  });

  it('builds a normalised board', () => {
    const b = buildBoard(parseBRD(enc(sample)), 'x.brd');
    expect(b.nets.find((n) => n.name === 'GND')!.pins).toHaveLength(2);
    expect(b.nets.find((n) => n.name === 'SIG_A')!.nails).toHaveLength(1);
    expect(b.parts[0].rect.w).toBeGreaterThan(40);
  });
});

describe('BDV', () => {
  it('decodes the HONHAN obfuscation (involution) and parses sections', () => {
    const text = [
      '<<format.asc>>', '0 0', '10 0', '10 5', '0 5',
      '<<pins.asc>>', 'Part U1 (T)', '1 A1 1.0 1.0 1 NET1 5', '2 A2 1.1 1.0 1 GND 6',
      '<<nails.asc>>', '$7 2.0 2.0 1 A1 (B) 1 NET1',
    ].join('\r\n') + '\r\n';
    const encoded = decodeBDV(enc(text)); // same transform encodes
    const raw = parseBDV(encoded);
    expect(raw.parts[0].name).toBe('U1');
    expect(raw.pins).toHaveLength(2);
    expect(raw.pins[0].x).toBe(1000);
    expect(raw.nails[0]).toMatchObject({ probe: 7, side: 'bottom', net: 'NET1' });
    expect(raw.outline[0]).toHaveLength(4);
  });
});

describe('BVR3', () => {
  it('parses parts, pins and segmented outline', () => {
    const t = `BVRAW_FORMAT_3
OUTLINE_SEGMENTED 0 0 100 0 100 0 100 50 0 50 100 50 0 50 0 0
PART_NAME U1
PART_SIDE B
PART_ORIGIN 10 10
PART_MOUNT SMD
PIN_NUMBER 1
PIN_ORIGIN 5 5
PIN_NET GND
PIN_END
PART_END
`;
    const raw = parseBVR3(enc(t));
    expect(raw.parts[0]).toMatchObject({ name: 'U1', side: 'bottom' });
    expect(raw.pins[0]).toMatchObject({ x: 15, y: 15, net: 'GND', part: 1 });
    expect(raw.outline[0].length).toBeGreaterThanOrEqual(5);
  });
});

describe('GenCAD', () => {
  it('places shape pins with rotation and resolves signals', () => {
    const t = `$HEADER
GENCAD 1.4
UNITS THOU
$ENDHEADER
$BOARD
RECTANGLE 0 0 1000 500
$ENDBOARD
$PADS
PAD P1 ROUND -1
CIRCLE 0 0 10
$ENDPADS
$PADSTACKS
PADSTACK PS1 0
PAD P1 TOP 0 0
$ENDPADSTACKS
$SHAPES
SHAPE R0402
PIN 1 PS1 -20 0 TOP 0 0
PIN 2 PS1 20 0 TOP 0 0
$ENDSHAPES
$COMPONENTS
COMPONENT R1
PLACE 500 250
LAYER TOP
ROTATION 90
SHAPE R0402 0 0
DEVICE RES_10K
$ENDCOMPONENTS
$SIGNALS
SIGNAL VCC
NODE R1 1
SIGNAL GND
NODE R1 2
$ENDSIGNALS
`;
    const raw = parseGenCAD(enc(t));
    expect(raw.pins).toHaveLength(2);
    expect(raw.pins[0].x).toBeCloseTo(500);
    expect(raw.pins[0].y).toBeCloseTo(230);
    expect(raw.pins[0].net).toBe('VCC');
    expect(raw.pins[0].radius).toBe(10);
    expect(raw.parts[0].mfg).toContain('RES_10K');
    expect(buildBoard(raw, 'r.cad').parts[0].dnp).toBe(false);
    const dnp = parseGenCAD(enc(t.replace('$ENDCOMPONENTS', '$ENDCOMPONENTS\n$DEVICES\nDEVICE RES_10K\nDESC NOASSEMBLED\n$ENDDEVICES')));
    expect(buildBoard(dnp, 'r.cad').parts[0].dnp).toBe(true);
    expect(raw.outline.length).toBeGreaterThan(0);
  });
});

describe('FZ', () => {
  it('reads the unencrypted zlib variant', () => {
    const content = 'A!REFDES!COMP_INSERTION_CODE!SYM_NAME!SYM_MIRROR!SYM_ROTATE!\nS!U1!X!BGA!NO!0!\nA!NET_NAME!REFDES!PIN_NUMBER!PIN_NAME!PIN_X!PIN_Y!TEST_POINT!RADIUS!\nS!GND!U1!1!A1!100,5!200!0!600!\nS!VCC!U1!2!A2!140!200!0!600!\n';
    const descr = 'board\nPARTNUMBER\tDESC\tQTY\tLOC\tPN2\n123-ABC\tPCH CONTROLLER\t1\tU1\tX\n';
    const c = zlibSync(strToU8(content));
    const d = zlibSync(strToU8(descr));
    const len = d.length + 8; // reference reader: descr starts at size - len + 4
    const buf = new Uint8Array(4 + c.length + d.length + 4);
    buf.set(c, 4);
    buf.set(d, 4 + c.length);
    new DataView(buf.buffer).setUint32(buf.length - 4, len, true);
    const raw = parseFZ(buf);
    expect(raw.pins[0]).toMatchObject({ net: 'GND', x: 100.5, num: '1' });
    expect(raw.parts[0].mfg).toContain('PCH CONTROLLER');
  });
});

describe('pipeline', () => {
  it('opens a zip with a board and a schematic PDF', () => {
    const zip = zipSync({
      'MB/board.brd': encodeBRD(enc(generateDemoBRD())),
      'MB/schematic.pdf': enc('%PDF-1.4\n%%EOF'),
      'readme.txt': enc('hi'),
    });
    const res = loadFiles([{ name: 'pack.zip', data: zip }], {});
    expect(res.type).toBe('board');
    if (res.type !== 'board' || !res.board) throw new Error('no board');
    expect(res.board.parts.length).toBeGreaterThan(700);
    expect(res.board.pins.length).toBeGreaterThan(3000);
    expect(res.attachments.map((a) => a.name)).toEqual(['MB/schematic.pdf']);
  });

  it('asks the user to choose when several boards are present', () => {
    const demo = enc(generateDemoBRD());
    const res = loadFiles([{ name: 'a.brd', data: demo }, { name: 'b.brd', data: demo }], {});
    expect(res.type).toBe('choose');
  });
});

describe('net classification', () => {
  it.each([
    ['GND', 'ground'], ['PGND', 'ground'], ['VSS', 'ground'],
    ['PP3V3_S5', 'power'], ['+3VALW', 'power'], ['VCC_CORE', 'power'], ['P1V05_S0', 'power'], ['1V8_AON', 'power'],
    ['P1V2', 'power'], ['PVCORE', 'power'], ['PVBAT', 'power'], ['P3V3A', 'power'], ['PW_USB_TYPE_C_A', 'power'],
    ['DGND_NFC', 'ground'], ['AGND_AUDIO', 'ground'],
    ['1V8_MAIN_EN_PWR', 'signal'], ['VCORE_PROCHOT#', 'signal'], ['P3V3_PG', 'signal'], ['VRPGPU_SW1', 'signal'], ['PP5V_EN', 'signal'],
    ['NC', 'nc'], ['UNCONNECTED', 'nc'],
    ['USB2_D0_P', 'signal'], ['PLT_RST_L', 'signal'], ['SPI_CLK', 'signal'],
  ])('%s → %s', (n, k) => expect(classifyNet(n)).toBe(k));
});
