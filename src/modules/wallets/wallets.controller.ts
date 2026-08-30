import { Controller, Post, Get, Body, Param, Query, HttpException, HttpStatus } from "@nestjs/common";
import { WalletsService } from "./wallets.service";

@Controller("wallets")
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  async createWallet(@Body() body: any) {
    if (!body.playerId || !body.initialBalance || !body.initialBalance.amount || !body.initialBalance.currency) {
      throw new HttpException("Dados inválidos para criação da wallet", HttpStatus.BAD_REQUEST);
    }

    try {
      const wallet = await this.walletsService.createWallet(
        body.playerId,
        body.initialBalance.amount,
        body.initialBalance.currency,
      );

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new HttpException("Erro ao criar wallet", HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(":walletId")
  async getWallet(@Param("walletId") walletId: string) {
    const wallet = await this.walletsService.getWallet(walletId);
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  @Get(":walletId/ledger")
  async getLedger(
    @Param("walletId") walletId: string,
    @Query("limit") limitVal?: string,
    @Query("cursor") cursor?: string,
  ) {
    const limit = limitVal ? parseInt(limitVal, 10) : 50;
    const result = await this.walletsService.getLedger(walletId, limit, cursor);

    return {
      data: result.entries.map((entry) => ({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt,
      })),
      nextCursor: result.nextCursor,
    };
  }

  @Post(":walletId/reconciliation")
  async reconciliation(@Param("walletId") walletId: string) {
    return await this.walletsService.auditReconciliation(walletId);
  }
}
