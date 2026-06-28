import { Test, TestingModule } from '@nestjs/testing';
import { TransactionService } from './transaction.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionEntity, TransactionStatus } from './transaction.entity';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { Wallet } from 'ethers';

describe('TransactionService', () => {
  let service: TransactionService;
  let mockQueue: any;
  let mockRepo: any;
  let wallet: Wallet;

  beforeEach(async () => {
    wallet = Wallet.createRandom();

    mockQueue = {
      add: jest.fn(),
    };

    mockRepo = {
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'test-id' })),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        {
          provide: getRepositoryToken(TransactionEntity),
          useValue: mockRepo,
        },
        {
          provide: getQueueToken('transaction-queue'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<TransactionService>(TransactionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeOperation', () => {
    it('should throw BadRequestException for invalid signature format', async () => {
      await expect(
        service.executeOperation({
          sender: wallet.address,
          target: wallet.address,
          data: '0x',
          signature: 'invalid-signature',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if signature does not match sender', async () => {
      const payloadToSign = `${wallet.address}:${wallet.address}:0x`;
      const signature = await wallet.signMessage(payloadToSign);
      
      // Pass a different sender
      await expect(
        service.executeOperation({
          sender: Wallet.createRandom().address,
          target: wallet.address,
          data: '0x',
          signature,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should save PENDING transaction and queue job if signature is valid', async () => {
      const target = Wallet.createRandom().address;
      const data = '0x1234';
      const payloadToSign = `${wallet.address}:${target}:${data}`;
      const signature = await wallet.signMessage(payloadToSign);

      const result = await service.executeOperation({
        sender: wallet.address,
        target,
        data,
        signature,
      });

      expect(mockRepo.create).toHaveBeenCalledWith({
        userAddress: wallet.address,
        targetContract: target,
        callData: data,
        status: TransactionStatus.PENDING,
      });
      expect(mockRepo.save).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith('execute-tx', {
        id: 'test-id',
        userOp: {
          sender: wallet.address,
          target,
          data,
          signature,
        },
      });
      expect(result.id).toBe('test-id');
      expect(result.status).toBe(TransactionStatus.PENDING);
    });
  });
});
