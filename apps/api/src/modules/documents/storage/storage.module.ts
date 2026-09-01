import { Module } from '@nestjs/common';
import { LocalFilesystemStorage } from './local-filesystem.storage';
import { StorageService } from './storage-service.interface';

/**
 * StorageModule — wires the active StorageService implementation.
 *
 * Today: LocalFilesystemStorage (dev/CI). The day we ship S3/MinIO, add a
 * conditional provider here that selects `S3Storage` when
 * `STORAGE_DRIVER=s3`. Every other module depends on `StorageService`
 * via DI — no call sites change.
 */
@Module({
  providers: [
    LocalFilesystemStorage,
    {
      provide: StorageService,
      useExisting: LocalFilesystemStorage,
    },
  ],
  exports: [StorageService, LocalFilesystemStorage],
})
export class StorageModule {}