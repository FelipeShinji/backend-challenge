import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MikroORM } from "@mikro-orm/core";
import { Logger } from "@nestjs/common";
import { JsonLoggerService } from "./infra/observability/json-logger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const jsonLogger = app.get(JsonLoggerService);
  app.useLogger(jsonLogger);

  const logger = new Logger("Bootstrap");

  // Enable graceful shutdown hooks (crucial for workers and consumers, Section 10)
  app.enableShutdownHooks();

  // Run pending database migrations automatically on startup
  const orm = app.get(MikroORM);
  try {
    const migrator = orm.getMigrator();
    logger.log("Executando migrações pendentes...");
    await migrator.up();
    logger.log("Migrações concluídas com sucesso.");
  } catch (err) {
    logger.error("Falha ao executar migrações", err);
    process.exit(1);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Aplicação rodando na porta ${port}`);
}

bootstrap();

