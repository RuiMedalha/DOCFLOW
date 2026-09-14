import { Module, forwardRef } from '@nestjs/common';
import { StorageModule } from '../documents/storage/storage.module';
import { EmailInboundModule } from '../email-inbound/email-inbound.module';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';

@Module({
  imports: [
    StorageModule,
    forwardRef(() => EmailInboundModule),
  ],
  controllers: [InboundController],
  providers: [InboundService],
  exports: [InboundService],
})
export class InboundModule {}

