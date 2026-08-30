import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
  Req,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { AuthGuard } from "../auth/auth.guard";
import { WageringService, IdempotencyConflictException, CurrencyMismatchException, WalletNotFoundException } from "./wagering.service";
import { WagerTransactionRepository } from "../../infra/database/repositories/wager-transaction.repository";
import { Money } from "../../domain/money/money";
import { WagerTransactionKind, WagerTransactionStatus } from "../../domain/wagering/types";
import { randomUUID } from "crypto";

@Controller()
export class WageringController {
  constructor(
    private readonly em: EntityManager,
    private readonly wageringService: WageringService,
    private readonly wagerTxRepo: WagerTransactionRepository,
  ) {}

  @Post("wagering/transactions")
  @UseGuards(AuthGuard)
  async submitTransaction(
    @Headers("Idempotency-Key") idempotencyKey: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    if (!idempotencyKey || idempotencyKey.trim() === "") {
      throw new HttpException("Header Idempotency-Key é obrigatório", HttpStatus.BAD_REQUEST);
    }

    // Validate body structure
    if (
      !body.providerId ||
      !body.externalTransactionId ||
      !body.playerId ||
      !body.walletId ||
      !body.roundId ||
      !body.gameId ||
      !body.kind ||
      !body.money ||
      !body.money.amount ||
      !body.money.currency
    ) {
      throw new HttpException("Payload incompleto ou inválido", HttpStatus.BAD_REQUEST);
    }

    // Failsafe validation: check if request provider matches provider in body
    if (req.provider && req.provider.id !== body.providerId) {
      throw new HttpException(
        "ProviderId divergente da autenticação",
        HttpStatus.FORBIDDEN,
      );
    }

    const payloadHash = this.wageringService.calculatePayloadHash(body);

    try {
      const money = Money.from({ amount: body.money.amount, currency: body.money.currency });

      const result = await this.em.transactional(async () => {
        return await this.wageringService.submitTransactionInternal({
          id: randomUUID(),
          providerId: body.providerId,
          externalTransactionId: body.externalTransactionId,
          idempotencyKey,
          payloadHash,
          walletId: body.walletId,
          playerId: body.playerId,
          roundId: body.roundId,
          gameId: body.gameId,
          kind: body.kind as WagerTransactionKind,
          money,
          referenceExternalTransactionId: body.referenceExternalTransactionId,
          createdAt: new Date(),
        });
      });

      // Map status to HTTP codes
      if (result.status === WagerTransactionStatus.Rejected) {
        // Find failure code
        const tx = await this.wagerTxRepo.findById(result.transactionId);
        throw new HttpException(
          {
            transactionId: result.transactionId,
            status: tx?.status || WagerTransactionStatus.Rejected,
            failureCode: tx?.failureCode,
            balance: result.balance,
            idempotentReplay: result.idempotentReplay,
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      if (result.status === WagerTransactionStatus.PendingReference) {
        throw new HttpException(
          {
            transactionId: result.transactionId,
            status: result.status,
            balance: result.balance,
            idempotentReplay: result.idempotentReplay,
          },
          HttpStatus.ACCEPTED,
        );
      }

      return {
        transactionId: result.transactionId,
        status: result.status,
        balance: result.balance,
        idempotentReplay: result.idempotentReplay,
      };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      if (err instanceof IdempotencyConflictException) {
        throw new HttpException(err.message, HttpStatus.CONFLICT);
      }
      if (err instanceof CurrencyMismatchException) {
        throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
      }
      if (err instanceof WalletNotFoundException) {
        throw new HttpException(err.message, HttpStatus.NOT_FOUND);
      }
      // Outros erros
      throw new HttpException(
        "Erro interno de infraestrutura",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get("wagering/transactions/:transactionId")
  async getTransaction(@Param("transactionId") transactionId: string) {
    const tx = await this.wagerTxRepo.findById(transactionId);
    if (!tx) {
      throw new HttpException("Transação não encontrada", HttpStatus.NOT_FOUND);
    }
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      referenceTransactionId: tx.referenceTransactionId,
      failureCode: tx.failureCode,
      createdAt: tx.createdAt,
      processedAt: tx.processedAt,
    };
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  async getProviderTransaction(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ) {
    const tx = await this.wagerTxRepo.findByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    if (!tx) {
      throw new HttpException("Transação não encontrada", HttpStatus.NOT_FOUND);
    }
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      referenceTransactionId: tx.referenceTransactionId,
      failureCode: tx.failureCode,
      createdAt: tx.createdAt,
      processedAt: tx.processedAt,
    };
  }
}
