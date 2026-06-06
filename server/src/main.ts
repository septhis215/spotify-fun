import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The Angular client runs on its own origin (dev: 127.0.0.1:4200).
  // Allow it to call the API. No cookies are used (token is held
  // server-side in memory), so credentials aren't required.
  const clientUrl = process.env.CLIENT_URL ?? 'http://127.0.0.1:4200';
  app.enableCors({
    origin: [clientUrl, 'http://localhost:4200'],
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
