import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { LoggerContext } from "./logger-context";

@Injectable()
export class LoggerContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = (req.headers["idempotency-key"] || req.headers["x-correlation-id"]) as string;
    const providerId = req.headers["x-provider-id"] as string;

    LoggerContext.run(
      {
        correlationId,
        providerId,
      },
      () => {
        next();
      },
    );
  }
}
