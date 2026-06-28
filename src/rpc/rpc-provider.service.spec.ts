import { Test, TestingModule } from '@nestjs/testing';
import { RpcProviderService } from './rpc-provider.service';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, throwError, of } from 'rxjs';
import { JsonRpcProvider } from 'ethers';

jest.mock('ethers', () => {
  return {
    JsonRpcProvider: jest.fn().mockImplementation((url) => ({
      _url: url,
    })),
  };
});

describe('RpcProviderService', () => {
  let service: RpcProviderService;
  let mockConfigService: any;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key) => {
        if (key === 'web3.rpcUrls') return ['http://rpc1.com', 'http://rpc2.com'];
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RpcProviderService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RpcProviderService>(RpcProviderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw an error if no RPC URLs are provided in config', () => {
    mockConfigService.get.mockReturnValue([]);
    expect(() => new RpcProviderService(mockConfigService as ConfigService)).toThrow('No RPC URLs provided in configuration.');
  });

  it('should return a provider using the first RPC URL initially', () => {
    const provider = service.getProvider();
    expect(provider).toBeDefined();
    expect((provider as any)._url).toBe('http://rpc1.com');
  });

  describe('executeWithFallback', () => {
    it('should execute operation successfully on first try', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const result = await firstValueFrom(service.executeWithFallback(mockOperation));
      
      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should fallback to next RPC on failure', (done) => {
      // It fails the first time, succeeds the second time (on retry with next RPC)
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce('success_after_fallback');
      
      // We don't want to wait 1 second for retry in tests, so we mock timer if needed, 
      // but since we are just waiting for it to finish, we can just use subscribe.
      service.executeWithFallback(mockOperation).subscribe({
        next: (value) => {
          expect(value).toBe('success_after_fallback');
          // Check if RPC index rotated
          const provider = service.getProvider();
          expect((provider as any)._url).toBe('http://rpc2.com');
          done();
        },
        error: (err) => {
          done(err);
        }
      });
    }, 10000); // give it time for the 1s delay
  });
});
