import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Wallet } from 'ethers';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionEntity, TransactionStatus } from '../src/transaction/transaction.entity';

describe('AppController (e2e) with Testcontainers', () => {
  let app: INestApplication;
  let postgresContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedRedisContainer;
  let wallet: Wallet;

  beforeAll(async () => {
    // 1. Start Testcontainers
    jest.setTimeout(60000); // Allow time for containers to pull and start
    postgresContainer = await new PostgreSqlContainer().start();
    redisContainer = await new RedisContainer().start();

    // 2. Override environment variables dynamically
    process.env.DB_HOST = postgresContainer.getHost();
    process.env.DB_PORT = postgresContainer.getPort().toString();
    process.env.DB_USERNAME = postgresContainer.getUsername();
    process.env.DB_PASSWORD = postgresContainer.getPassword();
    process.env.DB_NAME = postgresContainer.getDatabase();
    
    process.env.REDIS_HOST = redisContainer.getHost();
    process.env.REDIS_PORT = redisContainer.getPort().toString();

    process.env.RELAYER_PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
    process.env.RPC_URLS = 'http://localhost:8545'; // dummy for test

    // 3. Initialize Nest App
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    wallet = Wallet.createRandom();
  });

  afterAll(async () => {
    await app.close();
    await postgresContainer.stop();
    await redisContainer.stop();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  describe('/wallet/execute (POST)', () => {
    it('should reject invalid payload (400 Bad Request)', () => {
      return request(app.getHttpServer())
        .post('/wallet/execute')
        .send({
          sender: 'invalid-address',
        })
        .expect(400);
    });

    it('should accept valid signed operation and persist to DB', async () => {
      const target = Wallet.createRandom().address;
      const data = '0x1234';
      const payloadToSign = `${wallet.address}:${target}:${data}`;
      const signature = await wallet.signMessage(payloadToSign);

      const response = await request(app.getHttpServer())
        .post('/wallet/execute')
        .send({
          sender: wallet.address,
          target,
          data,
          signature,
        })
        .expect(202);

      expect(response.body.trackingId).toBeDefined();
      expect(response.body.status).toBe(TransactionStatus.PENDING);

      // Verify in Postgres
      const repository = app.get(getRepositoryToken(TransactionEntity));
      const record = await repository.findOne({ where: { id: response.body.trackingId } });
      
      expect(record).toBeDefined();
      expect(record.userAddress).toBe(wallet.address);
      expect(record.status).toBe(TransactionStatus.PENDING);
    });
  });
});
