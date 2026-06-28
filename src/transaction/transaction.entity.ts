import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum TransactionStatus {
  PENDING = 'PENDING',
  MINED = 'MINED',
  FAILED = 'FAILED',
}

@Entity('transactions')
@Index(['status'])
export class TransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userAddress: string;

  @Column({ nullable: true })
  txHash: string;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ type: 'text', nullable: true })
  targetContract: string;

  @Column({ type: 'text', nullable: true })
  callData: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
