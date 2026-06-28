import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { IsEthereumAddress, IsNotEmpty, IsString } from 'class-validator';
import { TransactionService, UserOperation } from './transaction.service';

class ExecuteOperationDto implements UserOperation {
  @IsEthereumAddress()
  @IsNotEmpty()
  sender: string;

  @IsEthereumAddress()
  @IsNotEmpty()
  target: string;

  @IsString()
  @IsNotEmpty()
  data: string;

  @IsString()
  @IsNotEmpty()
  signature: string;
}

@Controller('wallet')
export class TransactionController {
  constructor(private readonly transactionService: TransactionService) {}

  @Post('execute')
  @HttpCode(HttpStatus.ACCEPTED)
  async executeUserOperation(@Body() dto: ExecuteOperationDto) {
    const transaction = await this.transactionService.executeOperation(dto);
    
    return {
      trackingId: transaction.id,
      status: transaction.status,
    };
  }
}
