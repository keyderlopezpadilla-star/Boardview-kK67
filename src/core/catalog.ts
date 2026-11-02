import type { Board } from './types';

/**
 * Component intelligence: turns raw BOM/device descriptors such as
 *   "POWER INDUCTOR 1.0UH/15A 20%//CYNTEC/PEUE063T-1R0MS"
 *   "MLCC 0.1UF/16V(0402)X7R W05//MURATA/GRM155R71C104KA88 10%"
 * into structured, repair-oriented data. Pure functions, no I/O.
 */

export type PartKind =
  | 'mlcc' | 'polymer' | 'resistor' | 'thermistor' | 'inductor' | 'ferrite'
  | 'mosfet-n' | 'mosfet-p' | 'mosfet-dual' | 'power-stage' | 'bjt'
  | 'diode' | 'schottky' | 'esd' | 'led'
  | 'crystal' | 'fuse'
  | 'pwm' | 'charger' | 'load-switch' | 'supervisor' | 'logic' | 'ec' | 'memory' | 'flash'
  | 'cpu' | 'gpu' | 'audio' | 'interface' | 'ic'
  | 'connector' | 'switch' | 'testpoint' | 'mechanical' | 'unknown';

export type BodyKind =
  | 'chip-cap' | 'chip-res' | 'chip-ind' | 'molded-ind' | 'polymer' | 'sot' | 'sod' | 'qfn' | 'qfp' | 'bga'
  | 'pdfn' | 'crystal' | 'connector' | 'generic';

export interface PartInfo {
  kind: PartKind;
  /** Spanish category label, e.g. "Condensador cerámico MLCC". */
  category: string;
  body: BodyKind;
  /** Descriptor as found in the file, minus the device-id prefix. */
  raw?: string;
  /** Human description part of the descriptor (before "//"). */
  description?: string;
  mpn?: string;
  manufacturer?: string;
  /** ODM internal part number (Inventec 6xxxBxxxxxxx, Compal SAxxxxxxxxx…). */
  odmPn?: string;
  pkg?: string;
  /** Primary value (capacitance, resistance, inductance, frequency…). */
  value?: string;
  specs: Spec[];
  dnp: boolean;
}

export interface Spec {
  label: string;
  value: string;
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

interface Rule {
  re: RegExp;
  kind: PartKind;
  category: string;
}

/** Ordered: first match wins. Matched against the upper-cased description. */
const RULES: Rule[] = [
  { re: /^MLCC|CERAMIC CAP|^CAP (CER|MLCC)/, kind: 'mlcc', category: 'Condensador cerámico MLCC' },
  { re: /POSCAP|^CAP PL|PL TAN|POLYMER|^CAP TAN|TANTAL|SP-?CAP|^E-?CAP|ELECTROLYTIC|^CAP AL/, kind: 'polymer', category: 'Condensador de polímero / tantalio' },
  { re: /THERMISTOR|\bNTC\b|\bPTC\b/, kind: 'thermistor', category: 'Termistor' },
  { re: /^RES\b|RESISTOR|SHUNT|^R-?ARRAY|RES ARRAY/, kind: 'resistor', category: 'Resistencia' },
  { re: /FERRITE|BEAD|CHOKE|COMMON MODE/, kind: 'ferrite', category: 'Ferrita / choke de filtrado' },
  { re: /INDUCTOR|^IND\b/, kind: 'inductor', category: 'Inductor de potencia' },
  { re: /OVP|OCP|PROTECTION IC|EFUSE|E-FUSE/, kind: 'load-switch', category: 'IC de protección (OVP / eFuse)' },
  { re: /TRANSFORMER|LAN MAGNETIC/, kind: 'interface', category: 'Transformador LAN (magnetics)' },
  { re: /POWER STAGE|DRMOS|MOSFET DRIVER|MOS DRIVER|POWER MOSFET SW|SMART POWER/, kind: 'power-stage', category: 'Etapa de potencia (DrMOS)' },
  { re: /DUAL N-?MOS|DUAL P-?MOS|DUAL MOS|COMPLEMENTARY MOS/, kind: 'mosfet-dual', category: 'MOSFET doble' },
  { re: /P-?MOSFET|P-?CH(ANNEL)? MOS|PMOS/, kind: 'mosfet-p', category: 'MOSFET canal P' },
  { re: /N-?MOSFET|NEMOS|N-?CH(ANNEL)? MOS|NMOS|TRANS N.?MOS|MOSFET/, kind: 'mosfet-n', category: 'MOSFET canal N' },
  { re: /TRASIS|TRANSISTOR|\bBJT\b|\bNPN\b|\bPNP\b/, kind: 'bjt', category: 'Transistor bipolar (BJT)' },
  { re: /SCHOTTKY/, kind: 'schottky', category: 'Diodo Schottky' },
  { re: /\bESD\b|\bTVS\b|PROTECT/, kind: 'esd', category: 'Protección ESD / TVS' },
  { re: /\bLED\b/, kind: 'led', category: 'LED' },
  { re: /DIODE|RECTIFIER|ZENER/, kind: 'diode', category: 'Diodo' },
  { re: /XTAL|CRYSTAL|OSCILLATOR|RESONATOR/, kind: 'crystal', category: 'Cristal / oscilador' },
  { re: /FUSE|POLYSWITCH|POLY ?FUSE/, kind: 'fuse', category: 'Fusible' },
  { re: /CHARGE|CHARGER|BATT(ERY)? (CHG|MANAGE)/, kind: 'charger', category: 'Controlador de carga de batería' },
  { re: /LIN(EAR)? REG|\bREG\.|PWM|DC\/?DC|CONVERTER|REGULATOR|\bLDO\b|BUCK|BOOST|VR CONTROLLER|PMIC|POWER MANAGEMENT/, kind: 'pwm', category: 'Controlador PWM / regulador' },
  { re: /PWR SW|POWER SW|LOAD SW|LOAD SWITCH|USB PWR|USB POWER SW/, kind: 'load-switch', category: 'Interruptor de carga (load switch)' },
  { re: /VOLT(AGE)? (MONITOR|DETEC|SUPERVISOR)|RESET IC|SUPERVISOR/, kind: 'supervisor', category: 'Supervisor de tensión' },
  { re: /^LOGIC|\bGATE\b|BUFFER|LEVEL SHIFT|TRANSLATOR|INVERTER/, kind: 'logic', category: 'Lógica / buffer' },
  { re: /EMBEDDED CONTR|\bKBC\b|\bEC\b|IT8\d{3}|KB9\d{3}|NPCE/, kind: 'ec', category: 'Embedded Controller (EC/KBC)' },
  { re: /GDDR|DDR\d?(?! DIMM)|SDRAM|LPDDR|\bDRAM\b/, kind: 'memory', category: 'Memoria DRAM' },
  { re: /SPI|FLASH|EEPROM|\bROM\b|BIOS/, kind: 'flash', category: 'Memoria flash / BIOS' },
  { re: /^CPU|\bAPU\b|PROCESSOR|\bSOC\b/, kind: 'cpu', category: 'Procesador (CPU/APU)' },
  { re: /^C\.S |\bGPU\b|NVIDIA|GRAPHIC|\bVGA\b|GA10\d|TU11\d|GN2\d/, kind: 'gpu', category: 'Procesador gráfico (GPU)' },
  { re: /AUDIO CODEC|CODEC|AMPLIFIER|AUDIO AMP/, kind: 'audio', category: 'Audio' },
  { re: /JACK|CON\b|CONN|CONNECTOR|NGFF|M\.2|DIMM|SOCKET|USB|HDMI|FPC|WTOB|BTOB|HEADER|SATA|RJ-?45/, kind: 'connector', category: 'Conector' },
  { re: /SWITCH|\bSW\b|TACT|BUTTON/, kind: 'switch', category: 'Pulsador / interruptor' },
  { re: /RETIMER|REDRIVER|\bPHY\b|\bLAN\b|ETHERNET|CONTROLLER|BRIDGE|HUB|\bPD\b|TYPE-?C|RF SW|AD CONVERTER|SENSOR/, kind: 'interface', category: 'IC de interfaz / control' },
  { re: /SCREW|HOLE|SPRING|GASKET|SHIELD|CLIP|STANDOFF|NUT/, kind: 'mechanical', category: 'Elemento mecánico' },
];

/** Reference-designator fallback for formats without descriptors (BRD, BDV…). */
const PREFIX: [RegExp, PartKind, string][] = [
  [/^(PC|C)\d/, 'mlcc', 'Condensador'],
  [/^(PR|R|RN|RP)\d/, 'resistor', 'Resistencia'],
  [/^(FB|BD|PLB)\d/, 'ferrite', 'Ferrita'],
  [/^(PL|L)\d/, 'inductor', 'Inductor'],
  [/^(PQ|Q)\d/, 'mosfet-n', 'Transistor / MOSFET'],
  [/^(PD|D|ZD)\d/, 'diode', 'Diodo'],
  [/^(PU|U|IC)\d/, 'ic', 'Circuito integrado'],
  [/^(X|Y|XT|XTAL)\d/, 'crystal', 'Cristal'],
  [/^(F|PF)\d/, 'fuse', 'Fusible'],
  [/^(J|CN|JP|P|JACK|CON)\d/, 'connector', 'Conector'],
  [/^(SW|S|BTN)\d/, 'switch', 'Interruptor'],
  [/^(TP|PT|T|VT|ST)\d/, 'testpoint', 'Punto de prueba'],
  [/^(H|MH|SCREW)\d/, 'mechanical', 'Orificio / mecánico'],
];

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const PKG_RE = new RegExp(
  [
    '\\b(?:01005|0201|0402|0603|0805|1206|1210|1812|2010|2512|3216|3528|6032|7343(?:\\/[A-Z])?)\\b',
    '\\b(?:SOT|SC|SOD|TSOT|SOIC|SO|SOP|TSOP|MSOP|TSSOP|SSOP|QFN|TQFN|WQFN|VQFN|UQFN|MQFN|DFN|TDFN|WDFN|UDFN|PDFN|PQFN|LGA|BGA|FBGA|FCBGA|WLCSP|CSP|LQFP|TQFP|QFP|SNT|EMT|DPAK|D2PAK|TO|PWRPAK|POWERPAK|SON|VSON|WSON|MLP)[-\\s]?[0-9A-Z.()*xX-]*',
  ].join('|'),
  'i',
);
const NOT_MPN = /^(?:\d+(?:\.\d+)?(?:P|PF|NF|UF|F|V|A|MA|W|OHM|K|M|R|UH|NH|MH|HZ|KHZ|MHZ|H|MM|CH|%)?|R\/A|SMT|SMD|DIP|STD|REV|TR|STR|SUNK|R7G|<G>|W\d+|JUMP|IP|X[5-8][RSPT]|C0G|NP0|Y5V|\d+[KMG]?BIT|\d+\*\d+|\d+C|\d+P\d*)$/i;
const ODM_RE = /^(?:\d{4}B\d{7}|S[A-Z][0-9A-Z]{8,10}|HQ\d{9,}|\d{2}\.\d+\.\d+)$/;
const KNOWN_MFR = /^(?:MURATA|SAMSUNG|TDK|YAGEO|WALSIN|DARFON|KEMET|TAIYO|AVX|KYOCERA|PANASONIC|SANYO|NEC-TOKIN|APAQ|NICHICON|RUBYCON|CYNTEC|TAI-TECH|SUNLORD|CHILISIN|COILCRAFT|VISHAY|ROHM|ONSEMI|ON|NXP|PHILIPS|NEXPERIA|INFINEON|TI|RENESAS|INTERSIL|RICHTEK|UPI|ANPEC|SILERGY|MPS|AOS|ALPHA|NIKO-SEM|NIKO|SINOPOWER|HUABEI|PANJIT|LRC|DIODES|WILLSEMI|AMAZING|SEIKO|GMT|ALLEGRO|REALTEK|ITE|ENE|NUVOTON|WINBOND|MACRONIX|GIGADEVICE|MICRON|HYNIX|SK|NVIDIA|AMD|INTEL|ACES|ARGOSY|ACON|HELE|SIWARD|TXC|EPSON|KDS|RALEC|UNIOHM|VIKING|TA-I|INVENTEC|COMPAL|QUANTA|WISTRON|PEGATRON|FOXCONN|MOLEX|JAE|HIROSE|AMPHENOL|TARNG|HANGZHOU|RICHWAVE|PERICOM|DIODES|PARADE|ASMEDIA|GENESYS|TOSHIBA|LITTELFUSE|BOURNS|SEMTECH|STM|ST|MAXIM|ADI|MICROCHIP)$/i;

const unitNorm = (s: string) => s.replace(/UF\b/i, 'µF').replace(/NF\b/i, 'nF').replace(/PF\b/i, 'pF').replace(/UH\b/i, 'µH').replace(/NH\b/i, 'nH').replace(/MA\b/, 'mA').replace(/KHZ/i, 'kHz').replace(/MHZ/i, 'MHz');

function pick(re: RegExp, s: string): string | undefined {
  const m = re.exec(s);
  return m ? m[0].trim() : undefined;
}

/** Strips the device-id prefix our GenCAD parser joins in ("XY_C251 · …"). */
function cleanRaw(mfg: string): string {
  const parts = mfg.split(' · ').map((s) => s.trim()).filter(Boolean);
  const rest = parts.filter((p, i) => !(i === 0 && parts.length > 1 && /^[A-Z0-9_]+$/i.test(p) && !/\s/.test(p)));
  return rest.join(' · ').replace(/\s+/g, ' ').trim();
}

function findMpn(tokens: string[]): string | undefined {
  for (const raw of tokens) {
    let t = raw.replace(/^[(<]+|[)>,;]+$/g, '');
    // "SW.NCP302045MNTWG", "TRASIS.LMBT3904LT1G-HS" → drop a word prefix before the dot
    const dot = /^([A-Z]{2,})\.(.+)$/.exec(t);
    if (dot && /\d/.test(dot[2])) t = dot[2];
    if (t.length < 4 || !/\d/.test(t) || !/[A-Z]/i.test(t)) continue;
    if (NOT_MPN.test(t) || ODM_RE.test(t) || PKG_RE.test(t) && PKG_RE.exec(t)![0].length >= t.length - 1) continue;
    if (/^\d+(\.\d+)?[A-Z]{0,3}\/\d/.test(t)) continue; // "1.0UH/15A"
    if (/^\(?\d{4}\)?$/.test(t)) continue;
    return t;
  }
  return undefined;
}

export function describePart(name: string, mfg: string | undefined, pinCount: number): PartInfo {
  const raw = mfg ? cleanRaw(mfg) : '';
  const up = raw.toUpperCase();
  const dnp = /NO[_ ]?ASSEMBL|NOT[_ ]?ASSEMBL|NO[_ ]?POP|NOPOP|NO[_ ]?STUFF|\bDNP\b|\bDNI\b/.test(up);

  const [headRaw, tailRaw = ''] = raw.split('//');
  const head = headRaw.trim();
  const headUp = head.toUpperCase();

  let rule = RULES.find((r) => r.re.test(headUp));
  if (!rule && headUp) rule = RULES.find((r) => r.re.test(up));
  let kind: PartKind = rule?.kind ?? 'unknown';
  let category = rule?.category ?? '';
  if (!rule) {
    const p = PREFIX.find(([re]) => re.test(name.toUpperCase()));
    if (p) {
      kind = p[1];
      category = p[2];
    }
  }
  if (kind === 'unknown' && pinCount > 8) {
    kind = 'ic';
    category = 'Circuito integrado';
  }
  if (!category) category = 'Componente';

  // Tail: "MFR/MPN", "MFR MPN PKG", "PKG/MFR/ODM", "MFR <G>" …
  const tailTokens = tailRaw.split(/[\s/]+/).filter(Boolean);
  // The first word is the category ("MLCC", "GDDR6"…) unless it is a prefixed MPN like "TRASIS.LMBT3904".
  const headTokens = head.split(/\s+/).filter((t, i) => i > 0 || /^[A-Z]{2,}\.[A-Z0-9]*\d/i.test(t));
  let manufacturer = tailTokens.find((t) => KNOWN_MFR.test(t)) ?? tailTokens.find((t) => /^[A-Z][A-Z-]{2,}$/.test(t) && !PKG_RE.test(t));
  if (manufacturer && /^(INVENTEC|COMPAL|QUANTA|WISTRON|PEGATRON|FOXCONN)$/i.test(manufacturer)) {
    // ODM house numbers: keep them separately, the real vendor is unknown
    manufacturer = undefined;
  }
  const odmPn = tailTokens.find((t) => ODM_RE.test(t));
  // GPUs are identified by their die code (GA107-725-A1), not the board-level class code.
  const gpuDie = kind === 'gpu' ? /\b(?:G[ABHNPTU]\d{3}|TU\d{3}|AD\d{3})-[0-9A-Z]{2,4}-[A-Z]\d\b/.exec(up)?.[0] : undefined;
  const mpn = gpuDie ?? findMpn(tailTokens.filter((t) => t !== manufacturer)) ?? findMpn(headTokens);
  const pkg = pick(PKG_RE, up)?.replace(/^\(|\)$/g, '');

  // Electrical specs
  const specs: Spec[] = [];
  const add = (label: string, v?: string) => v && specs.push({ label, value: v });
  const cap = pick(/\b\d+(?:\.\d+)?\s?(?:PF|NF|UF)\b/i, headUp);
  const ind = pick(/\b\d+(?:\.\d+)?\s?(?:NH|UH|MH)\b/i, headUp);
  const res = (() => {
    const m = /\b(\d+(?:\.\d+)?)\s?([KM]?)\s?OHM/i.exec(headUp);
    return m ? `${m[1]}${m[2] ? m[2].replace('K', 'k') : ''} Ω` : undefined;
  })();
  const volt = pick(/\b\d+(?:\.\d+)?\s?V\b/, headUp.replace(/\d+(?:\.\d+)?\s?(?:UF|PF|NF)\//, ''));
  const curr = pick(/\b\d+(?:\.\d+)?\s?M?A\b/, headUp);
  const watt = pick(/\b\d+\/\d+\s?W\b|\b\d+(?:\.\d+)?\s?W\b/, headUp);
  const tol = pick(/[+-]?\d+(?:\.\d+)?(?:~-?\d+)?\s?%/, up);
  const diel = pick(/\b(?:X5R|X6S|X7R|X7S|X7T|X8R|C0G|NP0|Y5V)\b/, up);
  const freq = pick(/\b\d+(?:\.\d+)?\s?(?:KHZ|MHZ)\b/i, headUp);
  const esr = pick(/\b\d+(?:\.\d+)?\s?MOHM\b/i, headUp);

  let value: string | undefined;
  if (kind === 'mlcc' || kind === 'polymer') value = cap && unitNorm(cap);
  else if (kind === 'resistor' || kind === 'thermistor') value = res;
  else if (kind === 'inductor') value = ind && unitNorm(ind);
  else if (kind === 'ferrite') value = res;
  else if (kind === 'crystal') value = freq && unitNorm(freq);

  add('Capacitancia', cap && unitNorm(cap));
  add('Inductancia', ind && unitNorm(ind));
  add(kind === 'ferrite' ? 'Impedancia @100 MHz' : 'Resistencia', res);
  add('Tensión', volt?.replace(/\s/g, ' '));
  add(kind === 'inductor' ? 'Corriente (Isat)' : 'Corriente', curr && unitNorm(curr));
  add('Potencia', watt);
  add('Tolerancia', tol);
  add('Dieléctrico', diel);
  add('Frecuencia', freq && unitNorm(freq));
  add('ESR', esr && esr.replace(/MOHM/i, ' mΩ'));

  return {
    kind,
    category,
    body: bodyFor(kind, pkg, pinCount),
    raw: raw || undefined,
    description: head || undefined,
    mpn,
    manufacturer,
    odmPn,
    pkg,
    value,
    specs,
    dnp,
  };
}

function bodyFor(kind: PartKind, pkg: string | undefined, pins: number): BodyKind {
  const p = (pkg ?? '').toUpperCase();
  if (kind === 'mlcc') return 'chip-cap';
  if (kind === 'resistor' || kind === 'thermistor') return 'chip-res';
  if (kind === 'ferrite') return pins <= 2 ? 'chip-ind' : 'sot';
  if (kind === 'inductor') return 'molded-ind';
  if (kind === 'polymer') return 'polymer';
  if (kind === 'crystal') return 'crystal';
  if (kind === 'connector') return 'connector';
  if (/BGA|CSP|LGA/.test(p) || kind === 'cpu' || kind === 'gpu' || kind === 'memory') return 'bga';
  if (/PDFN|PQFN|POWERPAK|PWRPAK|SO-8|SON|MLP/.test(p) || kind === 'power-stage') return 'pdfn';
  if (/QFN|DFN|SNT/.test(p)) return 'qfn';
  if (/QFP|SOIC|SOP|SO\b|MSOP|TSSOP/.test(p)) return 'qfp';
  if (/SOD/.test(p) || (pins === 2 && /diode|schottky|esd|led/.test(kind))) return 'sod';
  if (/SOT|SC-?70|EMT|TSOT/.test(p) || (pins <= 6 && /mosfet|bjt|diode|esd|schottky|logic|load-switch|supervisor/.test(kind))) return 'sot';
  if (pins > 40) return 'bga';
  if (pins > 8) return 'qfn';
  return 'generic';
}

/* ------------------------------------------------------------------ */
/* Repair knowledge                                                    */
/* ------------------------------------------------------------------ */

export const PKG_SIZE: Record<string, string> = {
  '01005': '0,4 × 0,2 mm', '0201': '0,6 × 0,3 mm', '0402': '1,0 × 0,5 mm', '0603': '1,6 × 0,8 mm', '0805': '2,0 × 1,25 mm',
  '1206': '3,2 × 1,6 mm', '1210': '3,2 × 2,5 mm', '2010': '5,0 × 2,5 mm', '2512': '6,3 × 3,2 mm', '3528': '3,5 × 2,8 mm', '7343': '7,3 × 4,3 mm',
};

export function packageLabel(pkg?: string): string | undefined {
  if (!pkg) return undefined;
  const code = /\d{4,5}/.exec(pkg)?.[0];
  const size = code ? PKG_SIZE[code] : undefined;
  return size ? `${pkg} (${size})` : pkg;
}

export function diagnostics(info: PartInfo): string[] {
  switch (info.kind) {
    case 'mlcc':
      return [
        'Fallo típico: cortocircuito interno (dieléctrico perforado). La red de alimentación marca ≈0 Ω a GND.',
        'Localizar: inyectar tensión baja con corriente limitada (1 V / 1–3 A) en la red y buscar el punto caliente (cámara térmica o alcohol isopropílico).',
        'Modo diodo entre terminales: 0,000 indica corto; un valor similar al resto de la red es normal (está en paralelo).',
        'No se puede medir la capacitancia en circuito de forma fiable: retirar y medir con LCR si hay duda.',
      ];
    case 'polymer':
      return [
        'Fallo típico: corto (tantalio) o aumento de ESR / pérdida de capacidad (polímero) que provoca rizado y cuelgues bajo carga.',
        'Respetar polaridad al reemplazar (banda = positivo en tantalio/polímero SMD).',
        'Medir a GND en modo diodo; 0,000 en un raíl de VCORE/VRAM suele ser este condensador o un MOSFET low-side.',
      ];
    case 'resistor':
      return [
        'Medir en circuito y comparar con el nominal; si la lectura es mayor que el nominal, la resistencia está abierta o dañada.',
        'Las de 0 Ω (puentes) deben medir < 1 Ω; si están abiertas cortan la alimentación o la señal.',
        'Las resistencias shunt (mΩ) del cargador/sensado se verifican con medición de 4 hilos o por caída de tensión.',
      ];
    case 'thermistor':
      return ['Medir resistencia a ~25 °C: debe coincidir con el nominal (tolerancia indicada).', 'Un termistor abierto o en corto puede bloquear la carga de batería o forzar ventiladores al máximo.'];
    case 'inductor':
      return [
        'Debe medir continuidad (< 1 Ω) entre terminales; abierto = el raíl de salida no existe.',
        'Antes de reemplazarlo, comprobar que la red de salida no está en corto (el inductor no suele ser la causa).',
        'Con osciloscopio, el nodo de fase (SW/PHASE) debe mostrar una onda cuadrada cuando el regulador está activo.',
      ];
    case 'ferrite':
      return ['Debe medir ≈0 Ω. Una ferrita abierta deja sin alimentación a USB, audio, pantalla o teclado.', 'Puede puentearse temporalmente para diagnóstico; reemplazar con igual corriente nominal.'];
    case 'mosfet-n':
    case 'mosfet-p':
    case 'mosfet-dual':
      return [
        'Modo diodo: diodo body Source→Drain ≈0,4–0,7 V y Drain→Source OL (canal N). Valores ≈0 indican MOSFET en corto.',
        'En VRM, el high-side en corto pone la tensión de entrada (PPBUS/VBAT) en el raíl de salida: revisar consumidores aguas abajo.',
        'Verificar la tensión de puerta (Gate) con el equipo encendido para saber si el control lo está activando.',
      ];
    case 'power-stage':
      return [
        'Etapa DrMOS: medir modo diodo VIN, PHASE/SW y VOUT contra GND y comparar con las fases hermanas.',
        'Un corto VIN–SW o SW–GND es el fallo clásico; reemplazar la etapa completa (no tiene equivalentes discretos).',
        'Comprobar PWM y EN desde el controlador con osciloscopio.',
      ];
    case 'bjt':
      return ['Modo diodo: base-emisor y base-colector ≈0,6–0,7 V; colector-emisor abierto en ambos sentidos.'];
    case 'diode':
    case 'schottky':
      return ['Modo diodo: caída directa ≈0,15–0,4 V (Schottky) o ≈0,5–0,7 V (silicio) y OL en inversa.', 'Lectura en ambos sentidos ≈0 → en corto.'];
    case 'esd':
      return [
        'Fallo muy frecuente tras descargas en puertos: corto a GND en líneas USB/HDMI/Type-C o en la alimentación del puerto.',
        'Diagnóstico rápido: levantar el componente y volver a medir la red; si el corto desaparece, era la protección.',
        'Puede omitirse temporalmente para pruebas, pero debe reponerse para mantener la protección.',
      ];
    case 'crystal':
      return ['No se verifica con multímetro: medir oscilación con osciloscopio (sonda x10) en ambos pines.', 'Sin reloj de 32,768 kHz el EC/PCH puede no arrancar; sin reloj principal, no hay POST.'];
    case 'fuse':
      return ['Debe medir continuidad. Si está abierto, buscar primero el corto aguas abajo antes de reemplazarlo.'];
    case 'charger':
      return [
        'Verificar entrada de adaptador (DCIN/ACIN), LDO interno (VDDP/REGN ~5–6 V) y comunicación SMBus con el EC.',
        'Comprobar resistencias shunt de entrada y batería, y los MOSFET de entrada/batería asociados.',
        'Medir modo diodo cada pin y comparar con una placa buena o con los pines simétricos.',
      ];
    case 'pwm':
      return ['Comprobar VIN, VCC/LDO interno, EN y PGOOD.', 'Si EN está presente y no hay salida: revisar FB, BOOT y la etapa de potencia antes de cambiar el controlador.'];
    case 'load-switch':
      return ['Verificar VIN, señal EN y VOUT. Con EN activo y VOUT ausente → interruptor defectuoso o salida en corto.'];
    case 'supervisor':
      return ['Comprobar la tensión vigilada y la salida de reset/PG; una salida baja permanente mantiene la placa en reset.'];
    case 'ec':
      return ['Necesita su alimentación always-on (3V3 AL/A) y el reloj de 32,768 kHz.', 'Firmware corrupto: reprogramar la BIOS/EC antes de sustituir el chip.', 'Revisar líneas de botón de encendido, ACIN y secuencia de SLP_S*.'];
    case 'memory':
    case 'cpu':
    case 'gpu':
      return ['Componente BGA: medir modo diodo de los raíles (VCORE, VDDQ, VPP…) y comparar con referencia.', 'Fallos de soldadura o del propio chip requieren estación de reballing; verificar primero alimentaciones y relojes.'];
    case 'flash':
      return ['Comprobar alimentación (3,3 V/1,8 V) y CS/CLK con osciloscopio durante el arranque.', 'Un firmware corrupto se resuelve reprogramando con programador SPI (CH341A, RT809).'];
    case 'connector':
      return ['Inspeccionar pines doblados, corrosión o soldaduras frías con lupa.', 'Verificar continuidad desde cada pin a su red y que las alimentaciones del conector no estén en corto.'];
    default:
      return ['Medir modo diodo de cada pin respecto a GND y comparar con una placa de referencia.'];
  }
}

export interface Replacement {
  /** Rule describing what an equivalent must match. */
  rule: string;
  /** Concrete well-known equivalents (only for widely second-sourced parts). */
  known: string[];
}

/** Second-source table for ubiquitous small-signal parts. Pinout-compatible within the same package. */
const KNOWN_EQUIV: [RegExp, string[]][] = [
  [/2N7002(?!.*DW)/, ['2N7002K (onsemi/Diodes)', '2N7002E', 'L2N7002LT1G (LRC)', 'NX7002AK (Nexperia)']],
  [/BAT54C/, ['BAT54C (Nexperia / onsemi / Diodes Inc.)']],
  [/BAT54A/, ['BAT54A (Nexperia / onsemi / Diodes Inc.)']],
  [/BAT54S/, ['BAT54S (Nexperia / onsemi / Diodes Inc.)']],
  [/BAT54(?![ACS])/, ['BAT54 (Nexperia / onsemi / Diodes Inc.)', 'BAT54W en SOT-323 si el footprint es SC-70']],
  [/BAV99W/, ['BAV99W (Nexperia / onsemi / Diodes Inc.)']],
  [/BAV99(?!W)/, ['BAV99 (Nexperia / onsemi / Diodes Inc.)']],
  [/1N4148WS/, ['1N4148WS (cualquier fabricante, SOD-323)']],
  [/MMBT3904|LMBT3904|PMBT3904/, ['MMBT3904 (onsemi)', 'PMBT3904 (Nexperia)', 'LMBT3904LT1G (LRC)']],
  [/MMBT3906|LMBT3906|PMBT3906/, ['MMBT3906 (onsemi)', 'PMBT3906 (Nexperia)']],
  [/74LVC1G08/, ['74LVC1G08GW (Nexperia)', 'SN74LVC1G08DCKR (TI)']],
  [/74LVC1G32/, ['74LVC1G32GW (Nexperia)', 'SN74LVC1G32DCKR (TI)']],
  [/74LVC1G07/, ['74LVC1G07GW (Nexperia)', 'SN74LVC1G07DCKR (TI)']],
  [/AO3401|PJA3411/, ['AO3401A (AOS)', 'PJA3411 (Panjit)']],
  [/AO3400|PJA3406/, ['AO3400A (AOS)']],
  [/BSS138(?!.*W)/, ['BSS138 (onsemi / Nexperia)', 'BSS138K']],
];

export function replacements(info: PartInfo): Replacement {
  const v = info.value ?? '—';
  const pkg = info.pkg ?? 'mismo encapsulado';
  const spec = (l: string) => info.specs.find((s) => s.label.startsWith(l))?.value;
  const known = info.mpn ? KNOWN_EQUIV.filter(([re]) => re.test(info.mpn!.toUpperCase())).flatMap(([, list]) => list) : [];
  let rule: string;
  switch (info.kind) {
    case 'mlcc':
      rule = `MLCC ${pkg}, ${v}, tensión ≥ ${spec('Tensión') ?? 'la original'}, dieléctrico ${spec('Dieléctrico') ?? 'X5R/X7R'} o superior (X7R ≥ X6S ≥ X5R). Fabricantes habituales: Murata GRM, Samsung CL, TDK C, Yageo CC.`;
      break;
    case 'polymer':
      rule = `Polímero/tantalio de ${v}, tensión ≥ ${spec('Tensión') ?? 'la original'}, ESR ≤ ${spec('ESR') ?? 'la original'}, mismo tamaño (${pkg}). Respetar polaridad. Equivalentes de la familia Panasonic SP-Cap / POSCAP.`;
      break;
    case 'resistor':
      rule = `Resistencia ${pkg} de ${v}, tolerancia ≤ ${spec('Tolerancia') ?? '5 %'}, potencia ≥ ${spec('Potencia') ?? 'la del encapsulado'}.`;
      break;
    case 'thermistor':
      rule = `NTC ${pkg} de ${v} a 25 °C con el mismo coeficiente B (consultar datasheet del original, p. ej. Murata NCP15 / Panasonic ERTJ).`;
      break;
    case 'inductor':
      rule = `Inductor de ${v}, corriente de saturación ≥ ${spec('Corriente') ?? 'la original'}, DCR ≤ original y mismo footprint. Familias equivalentes: Cyntec PEUE/PCMB, TDK SPM, Vishay IHLP.`;
      break;
    case 'ferrite':
      rule = `Ferrita ${pkg} con impedancia ${v} y corriente nominal ≥ ${spec('Corriente') ?? 'la original'} (Murata BLM, Tai-Tech HCB/FCM, Sunlord).`;
      break;
    case 'mosfet-n':
    case 'mosfet-p':
    case 'mosfet-dual':
      rule = `Mismo encapsulado y pinout (${pkg}); Vds ≥ original, Id ≥ original, Rds(on) ≤ original y Vgs(th) similar (lógico 1,8/2,5 V si la puerta la maneja el EC).`;
      break;
    case 'power-stage':
      rule = 'Etapa integrada: usar el mismo número de parte (o la revisión indicada por el fabricante). No hay equivalentes genéricos seguros.';
      break;
    case 'crystal':
      rule = `Cristal de ${v}, misma capacidad de carga (CL) y tolerancia, mismo tamaño ${pkg}.`;
      break;
    case 'esd':
    case 'diode':
    case 'schottky':
      rule = `Mismo encapsulado (${pkg}) y pinout; tensión de trabajo/ruptura igual, corriente ≥ y capacitancia ≤ (crítico en USB 3/HDMI).`;
      break;
    case 'connector':
      rule = 'Mismo paso, número de pines, altura y orientación (R/A o vertical). Buscar por el número de parte del fabricante.';
      break;
    default:
      rule = info.mpn
        ? `Usar ${info.mpn}${info.manufacturer ? ` de ${info.manufacturer}` : ''} o una variante del mismo fabricante con idéntico sufijo de encapsulado. Verificar pinout en el datasheet.`
        : 'Usar el mismo número de parte; consultar el BOM o el esquemático.';
  }
  return { rule, known };
}

export interface LinkSet {
  label: string;
  url: string;
}

export function lookupLinks(info: PartInfo): LinkSet[] {
  const q = info.mpn ?? info.odmPn;
  if (!q) return [];
  const e = encodeURIComponent;
  return [
    { label: 'Datasheet', url: `https://www.alldatasheet.com/view.jsp?Searchword=${e(q)}` },
    { label: 'Octopart', url: `https://octopart.com/search?q=${e(q)}` },
    { label: 'LCSC', url: `https://www.lcsc.com/search?q=${e(q)}` },
    { label: 'Imágenes', url: `https://www.google.com/search?tbm=isch&q=${e(`${q} ${info.pkg ?? ''}`.trim())}` },
  ];
}

/* ------------------------------------------------------------------ */
/* Circuit role, inferred from the nets the part touches              */
/* ------------------------------------------------------------------ */


const PHASE_RE = /(?:^|_)(?:PH|PHASE|LX|SW\d*|PHASE\d*)(?:\d*)(?:_|$)|_PH\d*$|PHASE/i;
const SENSE_RE = /CS[PN]\d*|ISEN|ISUM|SENSE|SNS/i;
const CTRL_RE = /(?:^|_)(?:EN|PG|PGOOD|PWRGD|GATE|DRV|UG\d*|LG\d*|DH|DL|G)\d*#?(?:_|$)/i;

export function circuitRole(board: Board, partId: number): string[] {
  const part = board.parts[partId];
  const info = part.info;
  const nets = [...new Set(part.pins.map((p) => board.pins[p].net))].map((n) => board.nets[n]);
  const named = (k: string) => nets.filter((n) => n.kind === k).map((n) => n.name);
  const power = named('power');
  const ground = named('ground');
  const signal = named('signal');
  const list = (a: string[]) => a.slice(0, 4).join(', ') + (a.length > 4 ? ` y ${a.length - 4} más` : '');
  const out: string[] = [];
  const kind = info?.kind ?? 'unknown';

  if (part.pins.length === 2 && nets.length === 2) {
    const [a, b] = nets;
    const other = a.kind === 'ground' ? b : a;
    const toGnd = a.kind === 'ground' || b.kind === 'ground';
    if (kind === 'mlcc' || kind === 'polymer') {
      out.push(toGnd
        ? other.kind === 'power'
          ? `Desacoplo / filtrado del raíl ${other.name} a masa.`
          : `Filtro o temporización de la señal ${other.name} a masa.`
        : `Acoplamiento en serie entre ${a.name} y ${b.name} (típico en líneas de alta velocidad AC-coupled).`);
    } else if (kind === 'resistor') {
      const zero = info?.value?.startsWith('0 ') || info?.value === '0 Ω';
      if (zero) out.push(`Puente de 0 Ω que une ${a.name} con ${b.name}: si se abre, ${b.kind === 'power' || a.kind === 'power' ? 'el raíl aguas abajo pierde alimentación' : 'la señal queda cortada'}.`);
      else if (toGnd) out.push(`Pull-down / divisor a masa de ${other.name}.`);
      else if (a.kind === 'power' && b.kind !== 'power') out.push(`Pull-up de ${b.name} a ${a.name}.`);
      else if (b.kind === 'power' && a.kind !== 'power') out.push(`Pull-up de ${a.name} a ${b.name}.`);
      else out.push(`Resistencia serie entre ${a.name} y ${b.name}.`);
    } else if (kind === 'ferrite') {
      out.push(`Filtro de ruido EMI entre ${a.name} y ${b.name}.`);
    } else if (kind === 'esd' || kind === 'diode' || kind === 'schottky') {
      out.push(toGnd ? `Protección / sujeción de ${other.name} contra masa.` : `Diodo entre ${a.name} y ${b.name}.`);
    } else if (kind === 'thermistor') {
      out.push(`Sensor de temperatura en ${toGnd ? other.name : `${a.name} / ${b.name}`}.`);
    } else if (kind === 'fuse') {
      out.push(`Protección de sobrecorriente entre ${a.name} y ${b.name}.`);
    }
  }

  if (!out.length && kind === 'inductor') {
    const sense = nets.filter((n) => SENSE_RE.test(n.name));
    const main = nets.filter((n) => !sense.includes(n));
    const ph = main.find((n) => PHASE_RE.test(n.name));
    const outRail = main.find((n) => n !== ph);
    if (ph) out.push(`Inductor de salida de convertidor buck: nodo de conmutación ${ph.name} → raíl ${outRail?.name ?? '—'}.`);
    else if (main.length === 2) out.push(`Filtro LC entre ${main[0].name} y ${main[1].name}.`);
    if (sense.length) out.push(`Sensado de corriente por DCR: ${list(sense.map((n) => n.name))}.`);
  }

  if (!out.length) {
    if (kind.startsWith('mosfet') || kind === 'power-stage') {
      const ctrl = nets.filter((n) => CTRL_RE.test(n.name)).map((n) => n.name);
      const rails = power.filter((n) => !ctrl.includes(n));
      if (rails.length >= 2) out.push(`Conmuta entre los raíles ${list(rails)}.`);
      else if (rails.length === 1) out.push(`Conmuta el raíl ${rails[0]}${ground.length ? ' contra masa' : ''}.`);
      if (ctrl.length) out.push(`Señales de control: ${list(ctrl)}.`);
      const ph = nets.find((n) => PHASE_RE.test(n.name));
      if (ph) out.push(`Pertenece a la etapa de potencia del nodo ${ph.name}.`);
    }
    if (power.length) out.push(`Alimentado por / conectado a: ${list(power)}.`);
    if (signal.length && part.pins.length > 2) out.push(`${signal.length} señales${signal.length <= 6 ? `: ${list(signal)}` : ''}.`);
  }
  return out;
}

/** Other populated parts on the same board sharing the exact descriptor — donor candidates. */
export function donors(board: Board, partId: number): number[] {
  const raw = board.parts[partId].info?.raw;
  if (!raw) return [];
  return board.parts.filter((p) => p.id !== partId && !p.dnp && p.info?.raw === raw).map((p) => p.id);
}
