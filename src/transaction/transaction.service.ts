import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { TransactionEntity, TransactionStatus } from './transaction.entity';
import { hashMessage, verifyMessage } from 'ethers';

export interface UserOperation {
  sender: string;
  target: string;
  data: string;
  signature: string;
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(TransactionEntity)
    private readonly transactionRepository: Repository<TransactionEntity>,
    @InjectQueue('transaction-queue') private readonly transactionQueue: Queue,
  ) {}

  async executeOperation(userOp: UserOperation): Promise<TransactionEntity> {
    // 1. Verify Signature (Point 3)
    const payloadToSign = `${userOp.sender}:${userOp.target}:${userOp.data}`;
    let recoveredAddress: string;
    try {
      recoveredAddress = verifyMessage(payloadToSign, userOp.signature);
    } catch (e) {
      throw new BadRequestException('Invalid signature format');
    }

    if (recoveredAddress.toLowerCase() !== userOp.sender.toLowerCase()) {
      throw new BadRequestException('Signature does not match sender address');
    }

    // 2. Persist state
    const transaction = this.transactionRepository.create({
      userAddress: userOp.sender,
      targetContract: userOp.target,
      callData: userOp.data,
      status: TransactionStatus.PENDING,
    });
    
    await this.transactionRepository.save(transaction);
    this.logger.log(`Created tracking record for transaction ${transaction.id}`);

    // 3. Queue the job (Points 1 & 2)
    await this.transactionQueue.add('execute-tx', {
      id: transaction.id,
      userOp,
    });

    return transaction;
  }
}
