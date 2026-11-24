import { Injectable } from '@nestjs/common';
import {
  guessIsVeg,
  menuNameKey,
  type MenuImport,
  type MenuImportResult,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

interface PlannedItem {
  name: string;
  price: number;
  description?: string;
  isVeg?: boolean;
  taxRatePercent?: number;
  halfPrice?: number | null;
}

/**
 * Menu › Upload JSON (format: packages/types/src/menu-import.ts). Adds what is
 * new and updates matching dishes; never deletes or hides anything. With
 * dryRun the same plan is worked out and returned without writing (preview).
 */
@Injectable()
export class MenuImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async importMenu(
    branchId: string,
    userId: string,
    file: MenuImport,
    dryRun: boolean,
  ): Promise<MenuImportResult> {
    const result: MenuImportResult = {
      dryRun,
      categoriesCreated: [],
      itemsCreated: [],
      itemsUpdated: [],
      itemsUnchanged: 0,
    };

    // The same category twice in a file is merged; a dish listed twice in a
    // category takes its last entry.
    const groups = new Map<
      string,
      { name: string; items: Map<string, PlannedItem> }
    >();
    for (const cat of file.menu) {
      const key = menuNameKey(cat.category);
      const group = groups.get(key) ?? {
        name: cat.category.trim().replace(/\s+/g, ' '),
        items: new Map<string, PlannedItem>(),
      };
      groups.set(key, group);
      for (const item of cat.items) {
        group.items.set(menuNameKey(item.name), {
          name: item.name.trim().replace(/\s+/g, ' '),
          price: item.price,
          description: item.description || cat.serving || undefined,
          isVeg: item.veg ?? item.isVeg,
          taxRatePercent: item.taxRatePercent ?? file.taxRatePercent,
          halfPrice: item.halfPrice,
        });
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        const categories = await tx.menuCategory.findMany({
          where: { branchId },
          select: { id: true, name: true, sortOrder: true },
        });
        const byName = new Map(categories.map((c) => [menuNameKey(c.name), c]));
        let nextCategoryOrder =
          Math.max(0, ...categories.map((c) => c.sortOrder)) + 1;

        for (const [key, group] of groups) {
          let categoryId = byName.get(key)?.id ?? null;
          if (!categoryId) {
            result.categoriesCreated.push(group.name);
            if (!dryRun) {
              categoryId = (
                await tx.menuCategory.create({
                  data: {
                    branchId,
                    name: group.name,
                    sortOrder: nextCategoryOrder,
                  },
                  select: { id: true },
                })
              ).id;
            }
            nextCategoryOrder++;
          }

          const existing = categoryId
            ? await tx.menuItem.findMany({
                where: { branchId, categoryId },
                select: {
                  id: true,
                  name: true,
                  price: true,
                  description: true,
                  isVeg: true,
                  taxRatePercent: true,
                  halfPrice: true,
                  sortOrder: true,
                },
              })
            : [];
          const itemsByName = new Map(
            existing.map((i) => [menuNameKey(i.name), i]),
          );
          let nextItemOrder =
            Math.max(0, ...existing.map((i) => i.sortOrder)) + 1;

          for (const [itemKey, item] of group.items) {
            const found = itemsByName.get(itemKey);
            if (!found) {
              const isVeg = guessIsVeg(item.name, item.isVeg);
              result.itemsCreated.push({
                category: group.name,
                name: item.name,
                price: item.price,
                isVeg,
              });
              if (!dryRun && categoryId) {
                await tx.menuItem.create({
                  data: {
                    branchId,
                    categoryId,
                    name: item.name,
                    price: item.price,
                    description: item.description,
                    isVeg,
                    taxRatePercent: item.taxRatePercent ?? 0,
                    halfPrice: item.halfPrice ?? null,
                    sortOrder: nextItemOrder,
                  },
                });
              }
              nextItemOrder++;
              continue;
            }

            // Only what the file says; everything else on the dish stays.
            const data: Record<string, unknown> = {};
            if (Number(found.price) !== item.price) data.price = item.price;
            if (
              item.description !== undefined &&
              item.description !== found.description
            )
              data.description = item.description;
            if (item.isVeg !== undefined && item.isVeg !== found.isVeg)
              data.isVeg = item.isVeg;
            if (
              item.taxRatePercent !== undefined &&
              Number(found.taxRatePercent) !== item.taxRatePercent
            )
              data.taxRatePercent = item.taxRatePercent;
            if (
              item.halfPrice !== undefined &&
              (found.halfPrice === null ? null : Number(found.halfPrice)) !==
                item.halfPrice
            )
              data.halfPrice = item.halfPrice;

            if (Object.keys(data).length === 0) {
              result.itemsUnchanged++;
              continue;
            }
            result.itemsUpdated.push({
              category: group.name,
              name: found.name,
              priceBefore: Number(found.price),
              price: item.price,
            });
            if (!dryRun) {
              await tx.menuItem.update({ where: { id: found.id }, data });
            }
          }
        }
      },
      // A few hundred small writes; well within this on a phone too.
      { timeout: 60_000 },
    );

    if (!dryRun) {
      await this.audit.record({
        userId,
        action: 'menu.imported',
        entity: 'MenuCategory',
        entityId: branchId,
        metadata: {
          categoriesCreated: result.categoriesCreated.length,
          itemsCreated: result.itemsCreated.length,
          itemsUpdated: result.itemsUpdated.map((i) => ({
            name: i.name,
            priceBefore: i.priceBefore,
            priceAfter: i.price,
          })),
        },
      });
    }
    return result;
  }
}
