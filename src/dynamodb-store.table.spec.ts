import 'jest-dynalite/withDb';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import { DynamoDBStore } from './dynamodb-store';

describe('dynamodb-store - table via jest-dynalite', () => {
  let dynamoClient: dynamodb.DynamoDBClient;
  const tableName = 'sessions-test';

  beforeAll(() => {
    dynamoClient = new dynamodb.DynamoDBClient({
      endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
      tls: false,
      region: 'local',
    });
  });

  afterAll(() => {
    dynamoClient.destroy();
  }, 20000);

  describe('table', () => {
    it('uses existing table - record not found', (done) => {
      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
      });

      store.get('123', (err, session) => {
        expect(err).toBeNull();
        expect(session).toBeNull();
        done();
      });
    });

    it('uses existing table - record found', (done) => {
      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
      });

      store.set(
        '123',
        {
          // @ts-expect-error something
          user: 'test',
        },
        (err) => {
          expect(err).toBeNull();

          store.get('123', (err, session) => {
            expect(err).toBeNull();
            expect(session).not.toBeNull();
            done();
          });
        },
      );
    });
  });
});
