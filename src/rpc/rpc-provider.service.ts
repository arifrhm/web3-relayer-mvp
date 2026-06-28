import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonRpcProvider } from 'ethers';
import { Observable, defer, throwError, timer } from 'rxjs';
import { catchError, retry, mergeMap } from 'rxjs/operators';

@Injectable()
export class RpcProviderService {
  private readonly logger = new Logger(RpcProviderService.name);
  
  private rpcUrls: string[];
  private currentRpcIndex = 0;

  constructor(private configService: ConfigService) {
    this.rpcUrls = this.configService.get<string[]>('web3.rpcUrls', []);
    if (this.rpcUrls.length === 0) {
      throw new Error('No RPC URLs provided in configuration.');
    }
  }

  getProvider(): JsonRpcProvider {
    return new JsonRpcProvider(this.rpcUrls[this.currentRpcIndex]);
  }

  executeWithFallback<T>(operation: (provider: JsonRpcProvider) => Promise<T>): Observable<T> {
    return defer(() => operation(this.getProvider())).pipe(
      catchError((error) => {
        this.logger.warn(`RPC failed: ${this.rpcUrls[this.currentRpcIndex]}. Error: ${error.message}`);
        
        this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcUrls.length;
        this.logger.log(`Switching to fallback RPC: ${this.rpcUrls[this.currentRpcIndex]}`);
        
        return throwError(() => new Error('RPC_FAILED'));
      }),
      retry({
        count: 3,
        delay: (error, retryCount) => {
          this.logger.log(`Retrying... Attempt ${retryCount}`);
          return timer(1000);
        }
      })
    );
  }
}
