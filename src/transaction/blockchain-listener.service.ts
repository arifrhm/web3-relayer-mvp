import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionEntity, TransactionStatus } from './transaction.entity';
import { RpcProviderService } from '../rpc/rpc-provider.service';
import { Subscription, interval, from } from 'rxjs';
import { filter, switchMap, catchError, tap } from 'rxjs/operators';

@Injectable()
export class BlockchainListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockchainListenerService.name);
  private blockSubscription: Subscription | null = null;

  constructor(
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    private readonly rpcService: RpcProviderService,
  ) {}

  onModuleInit() {
    this.startListening();
  }

  onModuleDestroy() {
    if (this.blockSubscription) {
      this.blockSubscription.unsubscribe();
    }
  }

  private startListening() {
    this.logger.log('Starting blockchain listener for new blocks...');

    this.blockSubscription = interval(12000)
      .pipe(
        switchMap(() => this.fetchLatestBlockNumber()),
        filter(blockNumber => blockNumber !== null),
        tap(blockNumber => this.logger.debug(`Processing block: ${blockNumber}`)),
        switchMap(() => from(this.checkPendingTransactions())),
        catchError((error, caught) => {
          this.logger.error(`Error in block listener stream: ${error.message}`);
          return caught;
        })
      )
      .subscribe();
  }

  private fetchLatestBlockNumber() {
    return this.rpcService.executeWithFallback(provider => provider.getBlockNumber()).pipe(
      catchError(err => {
        this.logger.error('Could not fetch latest block number.');
        return [null];
      })
    );
  }

  private async checkPendingTransactions() {
    const pendingTxs = await this.transactionRepository.find({
      where: { status: TransactionStatus.PENDING },
      take: 50,
    });

    const provider = this.rpcService.getProvider();

    for (const tx of pendingTxs) {
      if (!tx.txHash) continue;

      try {
        const receipt = await provider.getTransactionReceipt(tx.txHash);
        
        if (receipt) {
          tx.status = receipt.status === 1 ? TransactionStatus.MINED : TransactionStatus.FAILED;
          await this.transactionRepository.save(tx);
          
          this.logger.log(
            `Transaction ${tx.txHash} has been ${tx.status === TransactionStatus.MINED ? 'mined successfully' : 'mined but reverted'}`
          );
        }
      } catch (error: any) {
        this.logger.error(`Error checking status for tx ${tx.txHash}: ${error.message}`);
      }
    }
  }
}
