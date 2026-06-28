import { Test, TestingModule } from '@nestjs/testing';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { TransactionStatus } from './transaction.entity';

describe('TransactionController', () => {
  let controller: TransactionController;
  let mockTransactionService: any;

  beforeEach(async () => {
    mockTransactionService = {
      executeOperation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionController],
      providers: [
        {
          provide: TransactionService,
          useValue: mockTransactionService,
        },
      ],
    }).compile();

    controller = module.get<TransactionController>(TransactionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return tracking ID and status', async () => {
    mockTransactionService.executeOperation.mockResolvedValue({
      id: 'mock-tracking-id',
      status: TransactionStatus.PENDING,
    });

    const result = await controller.executeUserOperation({
      sender: '0x123',
      target: '0x456',
      data: '0x789',
      signature: '0xabc',
    });

    expect(result).toEqual({
      trackingId: 'mock-tracking-id',
      status: 'PENDING',
    });
    expect(mockTransactionService.executeOperation).toHaveBeenCalledWith({
      sender: '0x123',
      target: '0x456',
      data: '0x789',
      signature: '0xabc',
    });
  });
});
