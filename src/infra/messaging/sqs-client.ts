import { Injectable } from "@nestjs/common";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

@Injectable()
export class SqsClient {
  private readonly client: SQSClient;

  constructor() {
    const endpoint = process.env.SQS_ENDPOINT || "http://localhost:4566";
    this.client = new SQSClient({
      endpoint,
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
      },
    });
  }

  async publish(
    queueName: string,
    body: string,
    messageGroupId: string,
    messageDeduplicationId: string,
  ): Promise<void> {
    const endpoint = process.env.SQS_ENDPOINT || "http://localhost:4566";
    const queueUrl = `${endpoint}/000000000000/${queueName}`;
    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: messageDeduplicationId,
    });
    await this.client.send(command);
  }

  getClient(): SQSClient {
    return this.client;
  }
}
