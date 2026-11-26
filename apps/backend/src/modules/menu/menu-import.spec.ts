import {
  guessIsVeg,
  MENU_IMPORT_SAMPLE,
  menuImportSchema,
  menuNameKey,
  type MenuImport,
} from '@nodedr-restaurant/types';
import { MenuImportService } from './menu-import.service';

// A tiny in-memory stand-in for the two tables the import touches.
interface Cat {
  id: string;
  branchId: string;
  name: string;
  sortOrder: number;
}
interface Item {
  id: string;
  branchId: string;
  categoryId: string;
  name: string;
  price: number;
  description: string | null;
  isVeg: boolean;
  taxRatePercent: number;
  halfPrice: number | null;
  sortOrder: number;
}

function fakeDb(cats: Cat[] = [], items: Item[] = []) {
  let seq = 0;
  const tx = {
    menuCategory: {
      findMany: ({ where }: { where: { branchId: string } }) =>
        Promise.resolve(cats.filter((c) => c.branchId === where.branchId)),
      create: ({ data }: { data: Omit<Cat, 'id'> }) => {
        const c = { ...data, id: `c${++seq}` };
        cats.push(c);
        return Promise.resolve(c);
      },
    },
    menuItem: {
      findMany: ({
        where,
      }: {
        where: { branchId: string; categoryId: string };
      }) =>
        Promise.resolve(
          items.filter(
            (i) =>
              i.branchId === where.branchId &&
              i.categoryId === where.categoryId,
          ),
        ),
      create: ({ data }: { data: Omit<Item, 'id'> }) => {
        const i: Item = {
          ...data,
          description: data.description ?? null,
          halfPrice: data.halfPrice ?? null,
          id: `i${++seq}`,
        };
        items.push(i);
        return Promise.resolve(i);
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Item>;
      }) => {
        const i = items.find((x) => x.id === where.id)!;
        Object.assign(i, data);
        return Promise.resolve(i);
      },
    },
  };
  const prisma = {
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new MenuImportService(prisma as never, audit as never);
  return { service, cats, items, audit };
}

const file = (
  menu: MenuImport['menu'],
  extra: Partial<MenuImport> = {},
): MenuImport => menuImportSchema.parse({ menu, ...extra });

describe('menu import helpers', () => {
  it('guesses non-veg from the name unless the file says', () => {
    expect(guessIsVeg('Chicken Momos')).toBe(false);
    expect(guessIsVeg('Egg Puff')).toBe(false);
    expect(guessIsVeg('Cheese Bread Omlett')).toBe(false);
    expect(guessIsVeg('Veg Puff')).toBe(true);
    expect(guessIsVeg('Eggless Cake')).toBe(true);
    expect(guessIsVeg('Chicken-style Soya', true)).toBe(true);
  });

  it('matches names regardless of case and spaces', () => {
    expect(menuNameKey('  Filter   COFFEE ')).toBe(
      menuNameKey('filter coffee'),
    );
  });

  it('accepts the sample and the user-style file (category / items / name / price)', () => {
    expect(menuImportSchema.safeParse(MENU_IMPORT_SAMPLE).success).toBe(true);
    expect(
      menuImportSchema.safeParse({
        menu: [
          {
            category: 'Momos',
            serving: '5 pcs / plate',
            items: [{ name: 'Veg Momos', price: 80 }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('says where a file is wrong', () => {
    const r = menuImportSchema.safeParse({
      menu: [{ category: 'X', items: [{ name: 'Tea', price: 'abc' }] }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['menu', 0, 'items', 0, 'price']);
  });
});

describe('MenuImportService', () => {
  it('a preview (dry run) changes nothing', async () => {
    const db = fakeDb();
    const r = await db.service.importMenu(
      'b1',
      'u1',
      file([{ category: 'Hot Items', items: [{ name: 'Tea', price: 20 }] }]),
      true,
    );
    expect(r.categoriesCreated).toEqual(['Hot Items']);
    expect(r.itemsCreated).toHaveLength(1);
    expect(db.cats).toHaveLength(0);
    expect(db.items).toHaveLength(0);
    expect(db.audit.record).not.toHaveBeenCalled();
  });

  it('adds new categories and dishes, with the serving note and default tax', async () => {
    const db = fakeDb();
    await db.service.importMenu(
      'b1',
      'u1',
      file(
        [
          {
            category: 'Momos',
            serving: '5 pcs / plate',
            items: [
              { name: 'Veg Momos', price: 80 },
              { name: 'Chicken Momos', price: 100 },
            ],
          },
        ],
        { taxRatePercent: 5 },
      ),
      false,
    );
    expect(db.cats.map((c) => c.name)).toEqual(['Momos']);
    expect(
      db.items.map((i) => [
        i.name,
        i.price,
        i.isVeg,
        i.description,
        i.taxRatePercent,
      ]),
    ).toEqual([
      ['Veg Momos', 80, true, '5 pcs / plate', 5],
      ['Chicken Momos', 100, false, '5 pcs / plate', 5],
    ]);
    expect(db.audit.record).toHaveBeenCalledTimes(1);
  });

  it('updates the price of a matching dish and leaves the rest alone; nothing is deleted', async () => {
    const db = fakeDb(
      [{ id: 'c1', branchId: 'b1', name: 'Hot Items', sortOrder: 1 }],
      [
        {
          id: 'i1',
          branchId: 'b1',
          categoryId: 'c1',
          name: 'Tea',
          price: 20,
          description: 'Strong',
          isVeg: true,
          taxRatePercent: 5,
          halfPrice: null,
          sortOrder: 1,
        },
        {
          id: 'i2',
          branchId: 'b1',
          categoryId: 'c1',
          name: 'Coffee',
          price: 25,
          description: null,
          isVeg: true,
          taxRatePercent: 5,
          halfPrice: null,
          sortOrder: 2,
        },
        {
          id: 'i3',
          branchId: 'b1',
          categoryId: 'c1',
          name: 'Old Special',
          price: 40,
          description: null,
          isVeg: true,
          taxRatePercent: 5,
          halfPrice: null,
          sortOrder: 3,
        },
      ],
    );
    const r = await db.service.importMenu(
      'b1',
      'u1',
      file([
        {
          category: '  hot ITEMS ',
          items: [
            { name: 'TEA', price: 22 },
            { name: 'Coffee', price: 25 },
            { name: 'Black Tea', price: 15 },
          ],
        },
      ]),
      false,
    );
    expect(r.categoriesCreated).toEqual([]);
    expect(r.itemsUpdated).toEqual([
      { category: 'hot ITEMS', name: 'Tea', priceBefore: 20, price: 22 },
    ]);
    expect(r.itemsUnchanged).toBe(1);
    expect(r.itemsCreated.map((i) => i.name)).toEqual(['Black Tea']);
    const tea = db.items.find((i) => i.id === 'i1')!;
    expect([tea.price, tea.description, tea.name]).toEqual([
      22,
      'Strong',
      'Tea',
    ]);
    expect(db.items.find((i) => i.id === 'i3')!.price).toBe(40);
    expect(db.items).toHaveLength(4);
  });

  it('importing the same file twice makes no duplicates', async () => {
    const db = fakeDb();
    const f = file([
      {
        category: 'Snacks',
        items: [
          { name: 'Veg Puff', price: 25 },
          { name: 'Egg Puff', price: 30 },
        ],
      },
    ]);
    await db.service.importMenu('b1', 'u1', f, false);
    const again = await db.service.importMenu('b1', 'u1', f, false);
    expect(again.itemsCreated).toHaveLength(0);
    expect(again.itemsUnchanged).toBe(2);
    expect(db.items).toHaveLength(2);
    expect(db.cats).toHaveLength(1);
  });
});
