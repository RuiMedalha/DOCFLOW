import { Module } from '@nestjs/common';
import { BankingService } from './banking.service';
import { BankingController } from './banking.controller';

/**
 * BankingModule — CSV / CAMT.053 imports, CsvTemplate CRUD, transaction
 * list + export. AuditModule is global so AuditService is injectable
 * without an explicit import here.
 */
@Module({
  controllers: [BankingController],
  providers: [BankingService],
  exports: [BankingService],
})
export class BankingModule {}