import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import {
  billPreviewRequestSchema,
  branchSettingsSchema,
  restaurantSettingsSchema,
  type BillPreviewRequest,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { buildReceiptHtml } from '../orders/receipt.html';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import {
  assertValidImageSignature,
  imageUploadOptions,
} from '../../common/upload/image-upload.config';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('v1/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('settings.manage')
  @Get()
  async get(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.settingsService.get(user.restaurantId, branchId);
  }

  @Auth('settings.manage')
  @Patch('restaurant')
  @UsePipes(new ZodValidationPipe(restaurantSettingsSchema))
  async updateRestaurant(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
  ) {
    return this.settingsService.updateRestaurant(
      user.restaurantId,
      user.id,
      body as never,
    );
  }

  @Auth('settings.manage')
  @Post('restaurant/logo')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  uploadRestaurantLogo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    // See menu.controller.ts's uploadItemImage — same rationale for
    // checking the bytes on disk before this URL is saved and served back
    // publicly as the restaurant's branding.
    assertValidImageSignature(file.path);
    return { url: `/api/uploads/${file.filename}` };
  }

  @Auth('settings.manage')
  @Patch('branch')
  @UsePipes(new ZodValidationPipe(branchSettingsSchema))
  async updateBranch(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.settingsService.updateBranch(branchId, user.id, body as never);
  }

  // Settings › Bill live preview: a sample paid bill (two items, table T1)
  // drawn with the switches and header fields being edited, before saving.
  @Auth('settings.manage')
  @Post('bill-preview')
  @UsePipes(new ZodValidationPipe(billPreviewRequestSchema))
  async billPreview(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const { bill, branch: edits } = body as BillPreviewRequest;
    const { restaurant, branch } = await this.settingsService.get(
      user.restaurantId,
      branchId,
    );
    // Two 5% items, tax-inclusive prices (like the POS): Rs 250 with 11.90 tax.
    const items = [
      { name: 'Coffee', quantity: 1, price: 150 },
      { name: 'Tea', quantity: 1, price: 100 },
    ];
    const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const tax = Math.round((total - total / 1.05) * 100) / 100;
    const html = buildReceiptHtml({
      restaurantName: restaurant.name,
      currency: restaurant.currency,
      branch: {
        name: branch.name,
        address: edits.address !== undefined ? edits.address : branch.address,
        phone: edits.phone !== undefined ? edits.phone : branch.phone,
        gstNumber:
          edits.gstNumber !== undefined ? edits.gstNumber : branch.gstNumber,
        taxRegime: edits.taxRegime ?? branch.taxRegime,
        taxMode: branch.taxMode,
        taxLabel:
          edits.taxLabel !== undefined ? edits.taxLabel : branch.taxLabel,
        taxId: branch.taxId,
      },
      order: {
        orderNumber: 'SAMPLE-0001',
        type: 'DINE_IN',
        createdAt: new Date(),
        table: { label: 'T1' },
        customer: { name: 'Priya', phone: null },
        subtotal: total,
        discountAmount: 0,
        taxAmount: tax,
        tipAmount: 0,
        loyaltyPointsRedeemed: 0,
        loyaltyDiscountAmount: 0,
        totalAmount: total,
        items: items.map((i) => ({
          nameSnapshot: i.name,
          quantity: i.quantity,
          unitPriceSnapshot: i.price,
          lineTotal: i.price * i.quantity,
          taxRateSnapshot: 5,
          modifiers: [],
        })),
        payments: [{ method: 'CASH', amount: total }],
      },
      bill,
    });
    res.type('html').send(html);
  }

  @Auth('settings.manage')
  @Post('kiosk/:action')
  async setKiosk(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('action') action: string,
  ) {
    if (action !== 'enable' && action !== 'rotate' && action !== 'disable') {
      throw new BadRequestException('Unknown kiosk action');
    }
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.settingsService.setKioskToken(branchId, user.id, action);
  }
}
