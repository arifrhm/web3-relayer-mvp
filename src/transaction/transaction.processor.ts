import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet, TransactionRequest } from 'ethers';
import { ConfigService } from '@nestjs/config';
import { RpcProviderService } from '../rpc/rpc-provider.service';
import { TransactionEntity, TransactionStatus } from './transaction.entity';
import { UserOperation } from './transaction.service';
import { lastValueFrom } from 'rxjs';

@Processor('transaction-queue', { concurrency: 1 })
export class TransactionProcessor extends WorkerHost {
  private readonly logger = new Logger(TransactionProcessor.name);
  private readonly relayerPrivateKey: string;

  constructor(
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    private readonly rpcService: RpcProviderService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.relayerPrivateKey = this.configService.get<string>('web3.relayerPrivateKey') as string;
  }

  async process(job: Job<{ id: string; userOp: UserOperation }>) {
    this.logger.log(`Processing job ${job.id} for transaction ${job.data.id}`);
    const { id, userOp } = job.data;

    const transaction = await this.transactionRepository.findOne({ where: { id } });
    if (!transaction) {
      this.logger.error(`Transaction record not found: ${id}`);
      return;
    }

    try {
      const txHash = await lastValueFrom(
        this.rpcService.executeWithFallback(async (provider) => {
          const wallet = new Wallet(this.relayerPrivateKey, provider);
          
          // --- Gas Estimation & Dynamic Fee (Point 4) ---
          const feeData = await provider.getFeeData();
          
          const txRequest: TransactionRequest = {
            to: userOp.target,
            data: userOp.data,
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            // ethers.js wallet implicitly manages nonce here, but in high throughput,
            // we'd use a robust atomic Redis lock to fetch `wallet.getNonce()` explicitly.
          };

          // Simulate the transaction to prevent wasting gas on failing calls
          await provider.estimateGas(txRequest);

          // Broadcast
          const txResponse = await wallet.sendTransaction(txRequest);
          return txResponse.hash;
        })
      );

      transaction.txHash = txHash;
      // We keep it as PENDING. The blockchain listener sweeps it to MINED later.
      await this.transactionRepository.save(transaction);
      this.logger.log(`Transaction broadcasted: ${txHash}`);
    } catch (error: any) {
      this.logger.error(`Failed to broadcast transaction ${id}: ${error.message}`);
      transaction.status = TransactionStatus.FAILED;
      await this.transactionRepository.save(transaction);
      throw error; // Re-throw for BullMQ to mark job as failed/retry
    }
  }
}
