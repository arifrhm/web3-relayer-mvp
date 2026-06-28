import { Module } from '@nestjs/common';
import { RpcProviderService } from './rpc-provider.service';

@Module({
  providers: [RpcProviderService],
  exports: [RpcProviderService],
})
export class RpcModule {}
