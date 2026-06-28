import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainListenerService } from './blockchain-listener.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionEntity, TransactionStatus } from './transaction.entity';
import { RpcProviderService } from '../rpc/rpc-provider.service';
import { of, throwError } from 'rxjs';

describe('BlockchainListenerService', () => {
  let service: BlockchainListenerService;
  let mockRepo: any;
  let mockRpcService: any;
  let mockProvider: any;

  beforeEach(async () => {
    mockRepo = {
      find: jest.fn(),
      save: jest.fn(),
    };

    mockProvider = {
      getTransactionReceipt: jest.fn(),
    };

    mockRpcService = {
      executeWithFallback: jest.fn().mockImplementation((fn) => {
        return of(fn({ getBlockNumber: jest.fn().mockResolvedValue(100) }));
      }),
      getProvider: jest.fn().mockReturnValue(mockProvider),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainListenerService,
        {
          provide: getRepositoryToken(TransactionEntity),
          useValue: mockRepo,
        },
        {
          provide: RpcProviderService,
          useValue: mockRpcService,
        },
      ],
    }).compile();

    service = module.get<BlockchainListenerService>(BlockchainListenerService);
  });

  afterEach(() => {
    service.onModuleDestroy(); // cleanup subscriptions
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkPendingTransactions', () => {
    it('should do nothing if there are no pending transactions', async () => {
      mockRepo.find.mockResolvedValue([]);
      
      // We directly invoke the private method to bypass the interval polling for this test
      await (service as any).checkPendingTransactions();
      
      expect(mockProvider.getTransactionReceipt).not.toHaveBeenCalled();
    });

    it('should update transaction status to MINED if receipt status is 1', async () => {
      const mockTx = { id: '1', txHash: '0xhash', status: TransactionStatus.PENDING };
      mockRepo.find.mockResolvedValue([mockTx]);
      mockProvider.getTransactionReceipt.mockResolvedValue({ status: 1 });

      await (service as any).checkPendingTransactions();

      expect(mockProvider.getTransactionReceipt).toHaveBeenCalledWith('0xhash');
      expect(mockTx.status).toBe(TransactionStatus.MINED);
      expect(mockRepo.save).toHaveBeenCalledWith(mockTx);
    });

    it('should update transaction status to FAILED if receipt status is 0', async () => {
      const mockTx = { id: '1', txHash: '0xhash', status: TransactionStatus.PENDING };
      mockRepo.find.mockResolvedValue([mockTx]);
      mockProvider.getTransactionReceipt.mockResolvedValue({ status: 0 });

      await (service as any).checkPendingTransactions();

      expect(mockProvider.getTransactionReceipt).toHaveBeenCalledWith('0xhash');
      expect(mockTx.status).toBe(TransactionStatus.FAILED);
      expect(mockRepo.save).toHaveBeenCalledWith(mockTx);
    });

    it('should not update transaction if receipt is null (still pending in mempool)', async () => {
      const mockTx = { id: '1', txHash: '0xhash', status: TransactionStatus.PENDING };
      mockRepo.find.mockResolvedValue([mockTx]);
      mockProvider.getTransactionReceipt.mockResolvedValue(null);

      await (service as any).checkPendingTransactions();

      expect(mockProvider.getTransactionReceipt).toHaveBeenCalledWith('0xhash');
      expect(mockTx.status).toBe(TransactionStatus.PENDING); // unchanged
      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully during getTransactionReceipt', async () => {
      const mockTx = { id: '1', txHash: '0xhash', status: TransactionStatus.PENDING };
      mockRepo.find.mockResolvedValue([mockTx]);
      mockProvider.getTransactionReceipt.mockRejectedValue(new Error('RPC Error'));

      await expect((service as any).checkPendingTransactions()).resolves.not.toThrow();
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('fetchLatestBlockNumber', () => {
    it('should return null on error', (done) => {
      mockRpcService.executeWithFallback.mockReturnValueOnce(throwError(() => new Error('RPC Error')));
      
      (service as any).fetchLatestBlockNumber().subscribe((val: any) => {
        expect(val).toBeNull();
        done();
      });
    });
  });

  describe('Lifecycle hooks and RxJS Polling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should initialize subscription and trigger interval pipeline', async () => {
      // Setup mocks for the pipeline
      mockRpcService.executeWithFallback.mockReturnValueOnce(of(101));
      mockRepo.find.mockResolvedValue([]); // No pending txs for simplicity

      // Call startListening (via onModuleInit)
      service.onModuleInit();
      expect((service as any).blockSubscription).toBeDefined();

      // Fast-forward time by 12 seconds to trigger the RxJS interval
      jest.advanceTimersByTime(12000);

      // We need to wait for microtasks (promises) to resolve
      await Promise.resolve();

      // Verify that the pipeline functions were executed
      expect(mockRpcService.executeWithFallback).toHaveBeenCalled();
      expect(mockRepo.find).toHaveBeenCalled();
    });

    it('should catch error in the polling stream and continue', async () => {
      // Simulate an error inside the stream (e.g., fetchLatestBlockNumber throws unhandled error)
      mockRpcService.executeWithFallback.mockReturnValueOnce(throwError(() => new Error('Stream Error')));

      service.onModuleInit();
      
      // Fast-forward to trigger the stream
      jest.advanceTimersByTime(12000);
      await Promise.resolve();

      // Ensure the error was caught and the subscription is not dead
      expect((service as any).blockSubscription.closed).toBeFalsy();
    });

    it('should unsubscribe on destroy', () => {
      service.onModuleInit();
      const unsubscribeSpy = jest.spyOn((service as any).blockSubscription, 'unsubscribe');
      service.onModuleDestroy();
      expect(unsubscribeSpy).toHaveBeenCalled();
      expect((service as any).blockSubscription.closed).toBeTruthy();
    });
  });
});
