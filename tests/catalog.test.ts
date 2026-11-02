import { describe, expect, it } from 'vitest';
import { describePart, replacements } from '../src/core/catalog';
import { smdCode } from '../src/ui/partArt';

/** Descriptors copied verbatim from a real ASUS GenCAD export. */
describe('describePart', () => {
  it('MLCC', () => {
    const i = describePart('C251', 'XY_C251 · MLCC 0.1UF/16V(0402)X7R W05//YAGEO/CC0402KRX7R7BB104 10%', 2);
    expect(i).toMatchObject({ kind: 'mlcc', body: 'chip-cap', mpn: 'CC0402KRX7R7BB104', manufacturer: 'YAGEO', pkg: '0402', value: '0.1µF' });
    expect(i.specs).toEqual(expect.arrayContaining([{ label: 'Tensión', value: '16V' }, { label: 'Dieléctrico', value: 'X7R' }]));
    expect(replacements(i).rule).toContain('0402');
  });

  it('power inductor with vendor part number', () => {
    const i = describePart('L60300', 'POWER INDUCTOR 1.0UH/15A 20%//CYNTEC/PEUE063T-1R0MS', 2);
    expect(i).toMatchObject({ kind: 'inductor', mpn: 'PEUE063T-1R0MS', manufacturer: 'CYNTEC', value: '1.0µH' });
    expect(i.specs.find((s) => s.label.startsWith('Corriente'))?.value).toBe('15A');
  });

  it('ODM part numbers are kept apart from the MPN', () => {
    const i = describePart('L66010', 'POWER INDUCTOR 0.15UH/45A 20%//INVENTEC/6014B0519001', 4);
    expect(i.mpn).toBeUndefined();
    expect(i.odmPn).toBe('6014B0519001');
    expect(i.manufacturer).toBeUndefined();
  });

  it('MPN embedded in the description (MOSFET, logic, prefixed tokens)', () => {
    expect(describePart('Q1', 'N-MOSFET EM6K1GT2R EMT6//ROHM', 6)).toMatchObject({ kind: 'mosfet-n', mpn: 'EM6K1GT2R', manufacturer: 'ROHM' });
    expect(describePart('U1', 'LOGIC 74LVC1G08GW SOT353//PHILIPS', 5)).toMatchObject({ kind: 'logic', mpn: '74LVC1G08GW' });
    expect(describePart('U2', 'POWER MOSFET SW.NCP302045MNTWG//ONSEMI PQFN31(5*5)', 31)).toMatchObject({ kind: 'power-stage', mpn: 'NCP302045MNTWG', manufacturer: 'ONSEMI' });
    expect(describePart('Q2', 'TRASIS.LMBT3904LT1G-HS SOT-23//LRC', 3).mpn).toBe('LMBT3904LT1G-HS');
  });

  it('GPU is identified by its die code', () => {
    const i = describePart('U5000', 'XY_U5000 · C.S GN20-P0-A1 FCBGA1358//NVIDIA GB5B-128 GA107-725-A1', 1358);
    expect(i).toMatchObject({ kind: 'gpu', body: 'bga', mpn: 'GA107-725-A1', manufacturer: 'NVIDIA', pkg: 'FCBGA1358' });
  });

  it('capacity tokens are not part numbers', () => {
    expect(describePart('U300', 'SPI FLASH 128MBIT W74M12JWZPIQ WSON-8//128MBIT/INVENTEC/6019B2084801', 8).mpn).toBe('W74M12JWZPIQ');
  });

  it('assembly-variant markers', () => {
    expect(describePart('C1', 'XY_C1 · NOASSEMBLED', 2).dnp).toBe(true);
  });

  it('reference-designator fallback when there is no descriptor', () => {
    expect(describePart('R12', undefined, 2)).toMatchObject({ kind: 'resistor', body: 'chip-res' });
    expect(describePart('U7000', undefined, 28).kind).toBe('ic');
  });

  it('well-known second sources', () => {
    expect(replacements(describePart('D1', 'DIODE BAV99 SOT-23//PHILIPS', 3)).known.join()).toContain('BAV99');
  });
});

describe('smdCode', () => {
  it.each([['4.7k Ω', '472'], ['10 Ω', '100'], ['100 Ω', '101'], ['0 Ω', '000'], ['0.01 Ω', '0R01'], ['1M Ω', '105']])('%s → %s', (v, c) => expect(smdCode(v)).toBe(c));
});
