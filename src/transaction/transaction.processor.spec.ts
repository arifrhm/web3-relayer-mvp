import { Test, TestingModule } from '@nestjs/testing';
import { TransactionProcessor } from './transaction.processor';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionEntity, TransactionStatus } from './transaction.entity';
import { ConfigService } from '@nestjs/config';
import { RpcProviderService } from '../rpc/rpc-provider.service';
import { of } from 'rxjs';
import { Job } from 'bullmq';

jest.mock('ethers', () => {
  return {
    Wallet: jest.fn().mockImplementation(() => ({
      sendTransaction: jest.fn().mockResolvedValue({ hash: 'mock-tx-hash' }),
    })),
  };
});

describe('TransactionProcessor', () => {
  let processor: TransactionProcessor;
  let mockRepo: any;
  let mockRpcService: any;
  let mockConfigService: any;
  let module: TestingModule;

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    mockRpcService = {
      executeWithFallback: jest.fn().mockImplementation((fn) => {
        const mockProvider = {
          getFeeData: jest.fn().mockResolvedValue({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n }),
          estimateGas: jest.fn().mockResolvedValue(21000n),
        };
        return of(fn(mockProvider)); // Execute the callback immediately for the test
      }),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('mock-private-key'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionProcessor,
        {
          provide: getRepositoryToken(TransactionEntity),
          useValue: mockRepo,
        },
        {
          provide: RpcProviderService,
          useValue: mockRpcService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    processor = module.get<TransactionProcessor>(TransactionProcessor);
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  it('should exit early if transaction record not found', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    const mockJob = { id: 'job-1', data: { id: 'missing-id', userOp: {} } } as any as Job;
    
    await processor.process(mockJob);
    
    expect(mockRepo.save).not.toHaveBeenCalled();
    expect(mockRpcService.executeWithFallback).not.toHaveBeenCalled();
  });

  it('should process transaction, estimate gas, and broadcast successfully', async () => {
    const mockTx = { id: 'tx-1', status: TransactionStatus.PENDING };
    mockRepo.findOne.mockResolvedValue(mockTx);
    
    const mockJob = {
      id: 'job-1',
      data: {
        id: 'tx-1',
        userOp: { sender: '0x1', target: '0x2', data: '0x' }
      }
    } as any as Job;

    await processor.process(mockJob);

    expect(mockRpcService.executeWithFallback).toHaveBeenCalled();
    expect(mockTx).toHaveProperty('txHash', 'mock-tx-hash');
    expect(mockRepo.save).toHaveBeenCalledWith(mockTx);
  });

  it('should mark transaction as FAILED if broadcast throws an error', async () => {
    const mockTx = { id: 'tx-1', status: TransactionStatus.PENDING };
    mockRepo.findOne.mockResolvedValue(mockTx);
    
    mockRpcService.executeWithFallback.mockImplementation(() => {
      throw new Error('Simulation failed');
    });

    const mockJob = {
      id: 'job-1',
      data: {
        id: 'tx-1',
        userOp: { sender: '0x1', target: '0x2', data: '0x' }
      }
    } as any as Job;

    await expect(processor.process(mockJob)).rejects.toThrow('Simulation failed');
    
    expect(mockTx.status).toBe(TransactionStatus.FAILED);
    expect(mockRepo.save).toHaveBeenCalledWith(mockTx);
  });
});
