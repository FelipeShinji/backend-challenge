import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { SqsClient } from "../../infra/messaging/sqs-client";
import { ListQueuesCommand } from "@aws-sdk/client-sqs";

@Controller("health")
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly sqsClient: SqsClient,
  ) {}

  @Get("live")
  getLive() {
    return { status: "UP" };
  }

  @Get("ready")
  async getReady() {
    try {
      // 1. Check Postgres
      await this.em.getConnection().execute("SELECT 1");

      // 2. Check SQS
      await this.sqsClient.getClient().send(new ListQueuesCommand({ MaxResults: 1 }));

      return { status: "UP", services: { postgres: "UP", sqs: "UP" } };
    } catch (err) {
      throw new HttpException(
        { status: "DOWN", error: (err as Error).message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
