import {
  DEFAULT_BILL_SETTINGS,
  type BillSettings,
} from '@nodedr-restaurant/types';
import { readJob } from './escpos/read-job';
import {
  buildKotEscPosJob,
  buildKotTestSlip,
  buildOpenDrawer,
  buildReceiptEscPos,
  buildReceiptEscPosJob,
  buildTestSlip,
  resolveProfile,
} from './escpos-receipt';

const DRAWER = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
const base = {
  restaurantName: 'Test Cafe',
  currency: 'INR',
  branch: {
    name: 'Main',
    address: null,
    phone: null,
    gstNumber: null,
    taxRegime: 'INDIA_GST' as const,
    taxMode: 'INCLUSIVE' as const,
    taxLabel: null,
    taxId: null,
  },
  order: {
    orderNumber: '1',
    createdAt: new Date('2026-10-04T10:00:00Z').toISOString(),
    type: 'TAKEAWAY',
    tableLabel: null,
    items: [],
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 0,
    tipAmount: 0,
    totalAmount: 100,
    payments: [{ method: 'CASH', amount: 100 }],
  },
};

describe('cash drawer', () => {
  it('open-drawer is init + the standard pulse', () => {
    expect(buildOpenDrawer().subarray(-5).equals(DRAWER)).toBe(true);
  });

  it('only kicks the drawer when asked', () => {
    const without = buildReceiptEscPos(base as any);

    const withKick = buildReceiptEscPos({ ...(base as any), openDrawer: true });
    expect(without.includes(DRAWER)).toBe(false);
    expect(withKick.subarray(-5).equals(DRAWER)).toBe(true);
    expect(withKick.length).toBe(without.length + 5);
  });
});

// ---------------------------------------------------------------------------
// Full-job tests: receipt and kitchen ticket content, 58/80 mm layout, code
// page behaviour. Bytes are decoded with readJob() (see escpos/read-job.ts).
// Paper output on a physical printer is NOT covered here - see the docs.
// ---------------------------------------------------------------------------

const order = {
  orderNumber: '20261018-0042',
  createdAt: new Date('2026-10-18T10:30:00Z'),
  type: 'DINE_IN',
  table: { label: 'T7' },
  customer: null,
  subtotal: 31.4,
  discountAmount: 0,
  taxAmount: 2.85,
  tipAmount: 0,
  loyaltyPointsRedeemed: 0,
  loyaltyDiscountAmount: 0,
  totalAmount: 31.4,
  items: [
    {
      nameSnapshot: 'Paella Valenciana con mariscos y azafrán de La Mancha',
      quantity: 2,
      unitPriceSnapshot: 12.5,
      lineTotal: 25,
      taxRateSnapshot: 10,
      modifiers: [{ nameSnapshot: 'Sin gluten', priceAdjSnapshot: 0 }],
    },
    {
      nameSnapshot: 'Crema Catalana',
      quantity: 1,
      unitPriceSnapshot: 6.4,
      lineTotal: 6.4,
      taxRateSnapshot: 10,
      modifiers: [],
    },
  ],
  payments: [{ method: 'CARD', amount: 31.4 }],
};
const branch = {
  name: 'Casa Ñandú',
  address: 'Calle Mayor 1, Madrid',
  phone: null,
  gstNumber: null,
  taxRegime: 'ES_IVA' as const,
  taxMode: 'INCLUSIVE' as const,
  taxLabel: null,
  taxId: 'B12345678',
};
const fmt = { timeZone: 'UTC', locale: 'en-GB' };

describe('receipt job', () => {
  it.each([
    [58, 32],
    [80, 48],
  ])('prints a %i mm bill inside %i columns with native text', (mm, cols) => {
    const job = buildReceiptEscPosJob({
      restaurantName: 'Casa Ñandú',
      currency: 'EUR',
      branch,
      order,
      profile: resolveProfile({ paperWidthMm: mm }),
      ...fmt,
    });
    const { lines, text } = readJob(job.buffer);
    lines.forEach((l) => expect(l.length).toBeLessThanOrEqual(cols));
    expect(job.unsupportedChars).toEqual([]);
    // the long name wraps across lines but loses nothing
    expect(text.replace(/\n/g, ' ')).toContain(
      'Paella Valenciana con mariscos y azafrán de La Mancha',
    );
    expect(text).toContain('+ Sin gluten');
    expect(text).toContain('2 x €12.50');
    expect(text).toContain('€25.00');
    expect(text).toContain('IVA');
    const total = lines.find((l) => l.startsWith('TOTAL'))!;
    expect(total.endsWith('€31.40')).toBe(true);
    expect(total).toHaveLength(cols); // value flush right at the last column
    expect(text).toContain('18/10/2026');
    // a bitmap job would contain GS v 0 / ESC * raster commands
    expect(job.buffer.includes(Buffer.from([0x1d, 0x76, 0x30]))).toBe(false);
    expect(job.buffer.includes(Buffer.from([0x1b, 0x2a]))).toBe(false);
  });

  it('falls back to "EUR" on a code page that has no euro sign', () => {
    const job = buildReceiptEscPosJob({
      restaurantName: 'Casa',
      currency: 'EUR',
      branch,
      order,
      profile: resolveProfile({ codepage: 'CP437' }),
      ...fmt,
    });
    const { text } = readJob(job.buffer, 'CP437');
    expect(text).toContain('EUR 31.40');
    expect(text).not.toContain('?');
  });

  it('flags unprintable item names instead of silently mangling them', () => {
    const job = buildReceiptEscPosJob({
      restaurantName: 'Casa',
      currency: 'EUR',
      branch,
      order: {
        ...order,
        items: [{ ...order.items[1], nameSnapshot: 'ラーメン Ramen' }],
      },
      ...fmt,
    });
    expect(job.unsupportedChars.length).toBeGreaterThan(0);
    expect(readJob(job.buffer).text).toContain('could not be printed');
  });

  it('ends with a full style reset and a cut', () => {
    const job = buildReceiptEscPosJob({
      restaurantName: 'Casa',
      currency: 'EUR',
      branch,
      order,
      ...fmt,
    });
    const { commands } = readJob(job.buffer);
    expect(commands.slice(-6)).toEqual([
      '1d2100',
      '1b4500',
      '1b2d00',
      '1d4200',
      '1b6100',
      '1d5600',
    ]);
  });
});

describe('kitchen ticket job', () => {
  const kot = {
    orderNumber: '20261018-0042',
    type: 'DINE_IN',
    createdAt: new Date('2026-10-18T10:30:00Z'),
    table: { label: 'T7' },
    customer: null,
    items: [
      {
        nameSnapshot: 'Paella Valenciana',
        quantity: 2,
        kitchenNote: 'Sin azafrán, alergia',
        modifiers: [{ nameSnapshot: 'Sin gluten' }],
      },
      {
        nameSnapshot: 'Crema Catalana',
        quantity: 1,
        kitchenNote: null,
        modifiers: [],
      },
    ],
  };

  it('has order, type, table, time, quantities, modifiers and notes - and no money', () => {
    const job = buildKotEscPosJob({
      branchName: 'Casa Ñandú',
      order: kot,
      ...fmt,
    });
    const { text } = readJob(job.buffer);
    expect(text).toContain('#20261018-0042');
    expect(text).toContain('DINE IN - Table T7');
    expect(text).toContain('18/10/2026');
    expect(text).toContain('2 x Paella Valenciana');
    expect(text).toContain('+ Sin gluten');
    expect(text).toContain('NOTE: Sin azafrán, alergia');
    expect(text).toContain('1 x Crema Catalana');
    expect(text).toContain('2 line(s), 3 item(s)');
    expect(text).not.toMatch(/[€$]|TOTAL|IVA|Subtotal|Paid|\d\.\d{2}/);
  });

  it('stamps a reprint clearly and names the ticket and station', () => {
    const copy = readJob(
      buildKotEscPosJob({
        branchName: 'Casa',
        order: kot,
        ticket: { number: 'ab12-2', station: 'Tandoor', reprint: 2 },
        ...fmt,
      }).buffer,
    ).text;
    expect(copy).toContain('*** REPRINT #2 ***');
    expect(copy).toContain('Ticket ab12-2 - Tandoor');
    const first = readJob(
      buildKotEscPosJob({
        branchName: 'Casa',
        order: kot,
        ticket: { number: 'ab12-1', reprint: 0 },
        ...fmt,
      }).buffer,
    ).text;
    expect(first).not.toContain('REPRINT');
  });

  it('prints the order-level note above the items', () => {
    const { text } = readJob(
      buildKotEscPosJob({
        branchName: 'Casa',
        order: { ...kot, notes: 'Nut allergy' },
        ...fmt,
      }).buffer,
    );
    expect(text.indexOf('ORDER NOTE: Nut allergy')).toBeGreaterThan(-1);
    expect(text.indexOf('ORDER NOTE')).toBeLessThan(text.indexOf('Paella'));
  });

  it('builds a sample kitchen ticket for the test print', () => {
    const { text } = readJob(buildKotTestSlip().buffer);
    expect(text).toContain('KITCHEN ORDER');
    expect(text).toContain('2 x Sample dish');
    expect(text).toContain('+ Extra spicy');
    expect(text).toContain('NOTE: No onion');
  });

  it('wraps a long note on 58 mm paper', () => {
    const job = buildKotEscPosJob({
      branchName: 'Casa',
      order: {
        ...kot,
        items: [
          {
            ...kot.items[0],
            kitchenNote:
              'sin cebolla, sin ajo, salsa aparte y muy poco hecho por favor',
          },
        ],
      },
      profile: resolveProfile({ paperWidthMm: 58 }),
      ...fmt,
    });
    readJob(job.buffer).lines.forEach((l) =>
      expect(l.length).toBeLessThanOrEqual(32),
    );
  });
});

describe('VERI*FACTU QR on the receipt', () => {
  const verifactu = {
    url: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=T1-000001&fecha=18-10-2026&importe=31.40',
    heading: 'QR tributario:',
    legend: 'Factura verificable en la sede electrónica de la AEAT',
    short: 'VERI*FACTU',
    invoiceNumber: 'T1-000001',
  };
  const job = (o: typeof order & { isProvisional?: boolean }) =>
    buildReceiptEscPosJob({
      restaurantName: 'Casa Ñandú',
      currency: 'EUR',
      branch,
      order: { ...o, verifactu },
      profile: resolveProfile({ paperWidthMm: 80 }),
      ...fmt,
    });

  it('prints a native, level-M, centred QR with the AEAT legend on a paid receipt', () => {
    const { buffer } = job(order);
    const text = buffer.toString('latin1');
    // GS ( k: model 2, module size 6, error correction M (0x31), store the URL, print
    expect(
      buffer.includes(
        Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
      ),
    ).toBe(true);
    expect(
      buffer.includes(
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
      ),
    ).toBe(true);
    expect(
      buffer.includes(
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
      ),
    ).toBe(true);
    const len = verifactu.url.length + 3;
    expect(
      buffer.includes(
        Buffer.concat([
          Buffer.from([
            0x1d,
            0x28,
            0x6b,
            len & 0xff,
            len >> 8,
            0x31,
            0x50,
            0x30,
          ]),
          Buffer.from(verifactu.url),
        ]),
      ),
    ).toBe(true);
    expect(
      buffer.includes(
        Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
      ),
    ).toBe(true);
    expect(text).toContain('Factura simplificada T1-000001');
    expect(text).toContain('QR tributario:');
    expect(text).toContain('VERI*FACTU');
  });

  it('prints no QR on a bill handed over before payment', () => {
    const { buffer } = job({ ...order, isProvisional: true });
    expect(buffer.includes(Buffer.from([0x1d, 0x28, 0x6b]))).toBe(false);
    expect(buffer.toString('latin1')).not.toContain('QR tributario');
  });

  it('prints no QR when the sale has no VERI*FACTU invoice', () => {
    const { buffer } = buildReceiptEscPosJob({
      restaurantName: 'Casa Ñandú',
      currency: 'EUR',
      branch,
      order,
      profile: resolveProfile({ paperWidthMm: 80 }),
      ...fmt,
    });
    expect(buffer.includes(Buffer.from([0x1d, 0x28, 0x6b]))).toBe(false);
  });
});

describe('test slip', () => {
  it('prints a column ruler and the code page sample', () => {
    const { text } = readJob(
      buildTestSlip(resolveProfile({ paperWidthMm: 58 })),
    );
    expect(text).toContain('12345678901234567890123456789012');
    expect(text).toContain('58 mm - 32 columns - CP858');
    expect(text).toContain('áéíóú ñ ü ¿? ¡! € £');
  });
});

describe('bill settings (Settings › Bill)', () => {
  const indianBranch = {
    ...branch,
    name: 'Anna Nagar',
    address: '2nd Avenue, Chennai',
    gstNumber: '33ABCDE1234F1Z5',
    taxRegime: 'INDIA_GST' as const,
    taxId: null,
  };
  const print = (bill: Partial<BillSettings> = {}) =>
    readJob(
      buildReceiptEscPosJob({
        restaurantName: 'Kaappi',
        currency: 'INR',
        branch: indianBranch,
        order,
        bill: { ...DEFAULT_BILL_SETTINGS, ...bill },
        profile: resolveProfile({ paperWidthMm: 80 }),
        ...fmt,
      }).buffer,
    );

  it('prints the table number on the right of the order line', () => {
    const { lines } = print();
    const line = lines.find((l) => l.includes('Table: T7'))!;
    expect(line.startsWith('Order: #20261018-0042')).toBe(true);
    expect(line.endsWith('Table: T7')).toBe(true);
    expect(line).toHaveLength(48);
  });

  it('a bill without GST has no tax lines', () => {
    const withGst = print().text;
    expect(withGst).toContain('CGST');
    const { text } = print({ showTaxBreakup: false, showTaxId: false });
    expect(text).not.toContain('GST');
    expect(text).not.toContain('@ 10%');
    expect(text).toContain('TOTAL');
  });

  it('leaves out the header parts that are switched off and prints the own footer', () => {
    const { text } = print({
      showAddress: false,
      showBranchName: false,
      showTable: false,
      headerNote: 'Pure veg',
      footerText: 'Come again!',
    });
    expect(text).not.toContain('Chennai');
    expect(text).not.toContain('Anna Nagar');
    expect(text).not.toContain('T7');
    expect(text).toContain('Pure veg');
    expect(text).toContain('Come again!');
  });
});

describe('bill logos', () => {
  const logo = (width: number, height: number) => ({
    image: 'data:image/png;base64,AAAA',
    raster: {
      width,
      height,
      data: Buffer.alloc((width / 8) * height, 0xff).toString('base64'),
    },
  });
  const printWith = (bill: Partial<BillSettings>, paperWidthMm = 58) =>
    buildReceiptEscPosJob({
      restaurantName: 'Kaappi',
      currency: 'INR',
      branch,
      order,
      bill: { ...DEFAULT_BILL_SETTINGS, logoSizeMm: 10, ...bill },
      profile: resolveProfile({ paperWidthMm }),
      ...fmt,
    }).buffer;
  const RASTER = Buffer.from([0x1d, 0x76, 0x30, 0x00]);
  const band = (job: Buffer) => {
    const at = job.indexOf(RASTER);
    const rowBytes = job[at + 4] | (job[at + 5] << 8);
    const rows = job[at + 6] | (job[at + 7] << 8);
    const data = job.subarray(at + 8, at + 8 + rowBytes * rows);
    return {
      at,
      rowBytes,
      rows,
      row: (y: number) => [...data.subarray(y * rowBytes, (y + 1) * rowBytes)],
    };
  };

  it('prints the left and right logos as one band at the paper edges', () => {
    // 10 mm = 80 dots tall: these logos are already that size, nothing scaled
    const job = printWith({ logoLeft: logo(16, 80), logoRight: logo(16, 80) });
    const b = band(job);
    expect(b.at).toBeGreaterThanOrEqual(0);
    expect([b.rowBytes, b.rows]).toEqual([48, 80]); // 58 mm = 384 dots = 48 bytes
    expect(b.row(0).slice(0, 3)).toEqual([0xff, 0xff, 0]);
    expect(b.row(79).slice(45)).toEqual([0, 0xff, 0xff]);
    expect(job.subarray(b.at).includes(Buffer.from('Kaappi'))).toBe(true);
  });

  it('scales the logo to the chosen size', () => {
    const b = band(printWith({ logoLeft: logo(16, 40), logoSizeMm: 15 }));
    expect(b.rows).toBe(120); // 15 mm x 8 dots
    expect(b.row(0).slice(0, 7)).toEqual([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0,
    ]); // 16 -> 48 dots wide
  });

  it('moves a smaller logo up or down beside a taller one', () => {
    // the 80-dot logo is drawn at 80 rows; a wide short one keeps its width limit
    const wide = logo(184, 40); // can't grow wider than half the paper: stays 40 rows
    const top = band(
      printWith({ logoLeft: logo(16, 80), logoRight: wide, logoAlign: 'top' }),
    );
    expect(top.row(0)[47]).toBe(0xff);
    expect(top.row(79)[47]).toBe(0);
    const bottom = band(
      printWith({
        logoLeft: logo(16, 80),
        logoRight: wide,
        logoAlign: 'bottom',
      }),
    );
    expect(bottom.row(0)[47]).toBe(0);
    expect(bottom.row(79)[47]).toBe(0xff);
  });

  it('one logo only prints just that one', () => {
    const b = band(printWith({ logoRight: logo(8, 80) }));
    expect(b.row(0)[0]).toBe(0);
    expect(b.row(0)[47]).toBe(0xff);
  });

  it('no logos: no picture in the job', () => {
    expect(printWith({}).includes(RASTER)).toBe(false);
  });
});

describe('bill totals switches', () => {
  const simple = { ...order, taxAmount: 0, discountAmount: 0, tipAmount: 0 };
  const print = (bill: Partial<BillSettings>, o = simple) =>
    readJob(
      buildReceiptEscPosJob({
        restaurantName: 'Kaappi',
        currency: 'EUR',
        branch: { ...branch, taxRegime: 'INDIA_GST' as const },
        order: o,
        bill: { ...DEFAULT_BILL_SETTINGS, showTaxBreakup: false, ...bill },
        profile: resolveProfile({ paperWidthMm: 80 }),
        ...fmt,
      }).buffer,
    ).text;

  it('one total: no subtotal when it would only repeat the total', () => {
    const text = print({});
    expect(text).not.toContain('Subtotal');
    expect(text).toContain('TOTAL');
  });

  it('subtotal when a discount sits between, unless switched off', () => {
    const withDiscount = { ...simple, discountAmount: 3.4, totalAmount: 28 };
    expect(print({}, withDiscount)).toContain('Subtotal');
    expect(print({ showSubtotal: false }, withDiscount)).not.toContain(
      'Subtotal',
    );
  });

  it('payment lines can be switched off', () => {
    expect(print({})).toContain('Paid (CARD)');
    expect(print({ showPayments: false })).not.toContain('Paid (CARD)');
  });
});

describe('picture printing (Tamil and other scripts)', () => {
  it('includes the logos in the picture, first', () => {
    const logo = {
      image: 'data:image/png;base64,AAAA',
      raster: {
        width: 16,
        height: 80,
        data: Buffer.alloc(160, 0xff).toString('base64'),
      },
    };
    const j = buildReceiptEscPosJob({
      restaurantName: 'ஊர் Crumbs',
      currency: 'INR',
      branch,
      order,
      bill: {
        ...DEFAULT_BILL_SETTINGS,
        logoLeft: logo,
        logoRight: logo,
        logoSizeMm: 10,
      },
      profile: resolveProfile({ paperWidthMm: 80, codepage: 'PICTURE' }),
      ...fmt,
    });
    const first = j.picture?.items[0];
    expect(first?.k).toBe('image');
    expect(
      first && first.k === 'image' ? [first.width, first.height] : null,
    ).toEqual([576, 80]);
  });

  const tamilOrder = {
    ...order,
    items: [{ ...order.items[1], nameSnapshot: 'பில்டர் காபி' }],
  };
  const job = (codepage: string) =>
    buildReceiptEscPosJob({
      restaurantName: 'ஊர் Crumbs',
      currency: 'INR',
      branch: { ...branch, taxRegime: 'INDIA_GST' as const },
      order: tamilOrder,
      profile: resolveProfile({ paperWidthMm: 58, codepage }),
      ...fmt,
    });

  it('a text code page cannot print Tamil (question marks, flagged)', () => {
    const j = job('CP858');
    expect(j.picture).toBeUndefined();
    expect(j.unsupportedChars.length).toBeGreaterThan(0);
  });

  it('the picture character set keeps every line in its original script', () => {
    const j = job('PICTURE');
    expect(j.unsupportedChars).toEqual([]);
    expect(j.picture?.paperWidthMm).toBe(58);
    const texts = JSON.stringify(j.picture?.items);
    expect(texts).toContain('ஊர் Crumbs');
    expect(texts).toContain('பில்டர் காபி');
    expect(texts).toContain('₹');
    expect(
      j.picture?.items.some((i) => i.k === 'row' && i.left === 'TOTAL'),
    ).toBe(true);
    expect(j.picture?.cut).toBe(true);
  });
});
