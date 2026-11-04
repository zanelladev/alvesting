import { Global, Module } from '@nestjs/common';
import { ENV, parseEnv } from './env.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => parseEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
