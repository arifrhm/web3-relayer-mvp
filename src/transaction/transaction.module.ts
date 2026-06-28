import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { BlockchainListenerService } from './blockchain-listener.service';
import { TransactionProcessor } from './transaction.processor';
import { TransactionEntity } from './transaction.entity';
import { RpcModule } from '../rpc/rpc.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionEntity]),
    BullModule.registerQueue({
      name: 'transaction-queue',
    }),
    RpcModule,
  ],
  controllers: [TransactionController],
  providers: [TransactionService, BlockchainListenerService, TransactionProcessor],
})
export class TransactionModule {}
