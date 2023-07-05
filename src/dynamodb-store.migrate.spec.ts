import 'jest-dynalite/withDb';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import session from 'express-session';
import DynamoDBStoreOld from 'connect-dynamodb';
import { DynamoDBStore } from './dynamodb-store';

interface MySessionData extends Record<string, unknown> {
  user: string;
}

const DynamoDBStoreOldConnect = DynamoDBStoreOld<MySessionData>(session);

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

  describe('migration from connect-dynamodb', () => {
    it('reads old record correctly', (done) => {
      const oldStore = new DynamoDBStoreOldConnect({
        client: dynamoClient,
        hashKey: 'id',
        table: tableName,
      });

      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
        // Use the old store's default prefix
        prefix: 'sess:',
      });

      // Save record with the old store that serializes the data
      // to a JSON string field called `sess`
      oldStore.set(
        '124',
        {
          user: 'test',
          // @ts-expect-error allow this field
          cookie: {
            maxAge: 60 * 60 * 1000, // one hour in milliseconds
          },
        },
        (err) => {
          // old store gave undefined not null
          expect(err).toBeUndefined();

          // Read the record with the new store that serializes the data
          store.get('124', (err, session) => {
            expect(err).toBeNull();
            expect(session).not.toBeNull();
            expect((session as unknown as MySessionData)?.user).toBe('test');
            done();
          });
        },
      );
    });
  });
});
