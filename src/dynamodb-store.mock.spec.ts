/* eslint-disable no-console */
import * as dynamodb from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { DynamoDBStore } from './dynamodb-store';

describe('mock AWS API', () => {
  let dynamoClient: AwsClientStub<dynamodb.DynamoDBClient>;
  let ddbMock: AwsClientStub<DynamoDBDocumentClient>;

  const tableName = 'sessions-test';

  beforeEach(() => {
    dynamoClient = mockClient(dynamodb.DynamoDBClient);
    ddbMock = mockClient(DynamoDBDocumentClient);
  });

  describe('initialization', () => {
    it('skips CreateTable if table exists', async () => {
      dynamoClient
        .onAnyCommand()
        .callsFake((input) => {
          console.log('dynamoClient.onAnyCommand', input);
          // throw new Error('unexpected call');
        })
        .rejects()
        .on(dynamodb.DescribeTableCommand, {
          TableName: tableName,
        })
        .resolves({
          Table: {
            TableName: tableName,
          },
        })
        .on(dynamodb.CreateTableCommand, {
          TableName: tableName,
        })
        .rejects();
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log('ddbMock.onAnyCommand', input);
          throw new Error('unexpected call');
        })
        .on(
          GetCommand,
          {
            TableName: tableName,
            Key: {
              id: {
                S: 'sess:123',
              },
            },
          },
          false,
        )
        .resolves({
          Item: {
            id: {
              S: 'sess:123',
            },
            expires: {
              N: '1598420000',
            },
            data: {
              B: 'eyJ1c2VyIjoiYWRtaW4ifQ==',
            },
          },
        });

      const store = await DynamoDBStore.create({
        tableName,
        createTableOptions: {},
      });

      expect(store.tableName).toBe(tableName);
      expect(dynamoClient.calls().length).toBe(1);
    });

    it('calls CreateTable if table does not exist', async () => {
      dynamoClient
        .onAnyCommand()
        .callsFake((input) => {
          console.log('dynamoClient.onAnyCommand', input);
          throw new Error('unexpected call');
        })
        .on(dynamodb.DescribeTableCommand, {
          TableName: tableName,
        })
        .rejectsOnce({ name: 'ResourceNotFoundException' })
        .resolvesOnce({
          Table: {
            TableName: tableName,
            TableStatus: 'CREATING',
          },
        })
        .resolvesOnce({
          Table: {
            TableName: tableName,
            TableStatus: 'ACTIVE',
          },
        })
        .rejects()
        .on(dynamodb.CreateTableCommand, {
          TableName: tableName,
          AttributeDefinitions: [
            {
              AttributeName: 'id',
              AttributeType: 'S',
            },
          ],
          KeySchema: [
            {
              AttributeName: 'id',
              KeyType: 'HASH',
            },
          ],
        })
        .resolves({})
        .on(dynamodb.UpdateTimeToLiveCommand, {
          TableName: tableName,
          TimeToLiveSpecification: {
            AttributeName: 'expires',
            Enabled: true,
          },
        })
        .resolves({});
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log('ddbMock.onAnyCommand', input);
          throw new Error('unexpected call');
        })
        .on(
          GetCommand,
          {
            TableName: tableName,
            Key: {
              id: {
                S: 'sess:123',
              },
            },
          },
          false,
        )
        .resolves({
          Item: {
            id: {
              S: 'sess:123',
            },
            expires: {
              N: '1598420000',
            },
            data: {
              B: 'eyJ1c2VyIjoiYWRtaW4ifQ==',
            },
          },
        });

      const store = await DynamoDBStore.create({
        tableName,
        createTableOptions: {},
      });

      expect(store.tableName).toBe(tableName);
      expect(dynamoClient.calls().length).toBe(5);
    });
  });

  describe('ttl', () => {
    it('does not update the TTL if the session was recently modified', (done) => {
      void (async () => {
        dynamoClient
          .onAnyCommand()
          .callsFake((input) => {
            console.log('dynamoClient.onAnyCommand', input);
            throw new Error('unexpected call');
          })
          .rejects()
          .on(dynamodb.DescribeTableCommand, {
            TableName: tableName,
          })
          .resolves({
            Table: {
              TableName: tableName,
            },
          })
          .on(dynamodb.CreateTableCommand, {
            TableName: tableName,
          })
          .rejects();
        ddbMock.onAnyCommand().callsFake((input) => {
          console.log('ddbMock.onAnyCommand', input);
          throw new Error('unexpected call');
        });

        const store = await DynamoDBStore.create({
          tableName,
          createTableOptions: {},
        });

        expect(store.tableName).toBe(tableName);
        expect(dynamoClient.calls().length).toBe(1);
        expect(ddbMock.calls().length).toBe(0);

        store.touch(
          '123',
          {
            // @ts-expect-error we know we have a cookie field
            user: 'test',
            lastModified: new Date().toISOString(),
            cookie: {
              originalMaxAge: 1000 * (14 * 24) * 60 * 60,
              expires: new Date(Date.now() + 1000 * (14 * 24 - 0.9) * 60 * 60),
            },
          },
          (err) => {
            expect(err).toBeNull();

            // Nothing should have happened
            expect(dynamoClient.calls().length).toBe(1);
            expect(ddbMock.calls().length).toBe(0);

            done();
          },
        );
      })();
    });

    it('does update the TTL if the session was last modified more than touchAfter seconds ago', (done) => {
      void (async () => {
        dynamoClient
          .onAnyCommand()
          .callsFake((input) => {
            console.log('dynamoClient.onAnyCommand', input);
            throw new Error('unexpected call');
          })
          .rejects()
          .on(dynamodb.DescribeTableCommand, {
            TableName: tableName,
          })
          .resolves({
            Table: {
              TableName: tableName,
            },
          })
          .on(dynamodb.CreateTableCommand, {
            TableName: tableName,
          })
          .rejects();
        ddbMock
          .onAnyCommand()
          .callsFake((input) => {
            console.log('ddbMock.onAnyCommand', input);
            throw new Error('unexpected call');
          })
          .on(
            UpdateCommand,
            {
              TableName: 'sessions-test',
              Key: { id: 'session#123' },
              UpdateExpression: 'set expires = :e, sess.lastModified = :lm',
              // ExpressionAttributeValues: { ':e': 2898182909 },
              ReturnValues: 'UPDATED_NEW',
            },
            false,
          )
          .resolvesOnce({
            Attributes: {
              expires: 2898182909,
            },
          });

        const store = await DynamoDBStore.create({
          tableName,
          createTableOptions: {},
        });

        expect(store.tableName).toBe(tableName);
        expect(dynamoClient.calls().length).toBe(1);
        expect(ddbMock.calls().length).toBe(0);

        store.touch(
          '123',
          {
            // @ts-expect-error we know we have a cookie field
            user: 'test',
            expires: Math.floor((Date.now() + 1000 * (14 * 24 - 1.1) * 60 * 60) / 1000),
            lastModified: '2021-08-01T00:00:00.000Z',
            cookie: {
              maxAge: 1000 * (14 * 24 - 4) * 60 * 60,
              originalMaxAge: 1000 * (14 * 24) * 60 * 60,
              expires: new Date(Date.now() + 1000 * (14 * 24 - 4) * 60 * 60),
            },
          },
          (err) => {
            expect(err).toBeNull();

            // We should have written to the DB
            expect(dynamoClient.calls().length).toBe(1);
            expect(ddbMock.calls().length).toBe(1);

            done();
          },
        );
      })();
    });

    it('does update the TTL if the session has no lastModified field', (done) => {
      void (async () => {
        dynamoClient
          .onAnyCommand()
          .callsFake((input) => {
            console.log('dynamoClient.onAnyCommand', input);
            throw new Error('unexpected call');
          })
          .rejects()
          .on(dynamodb.DescribeTableCommand, {
            TableName: tableName,
          })
          .resolves({
            Table: {
              TableName: tableName,
            },
          })
          .on(dynamodb.CreateTableCommand, {
            TableName: tableName,
          })
          .rejects();
        ddbMock
          .onAnyCommand()
          .callsFake((input) => {
            console.log('ddbMock.onAnyCommand', input);
            throw new Error('unexpected call');
          })
          .on(
            UpdateCommand,
            {
              TableName: 'sessions-test',
              Key: { id: 'session#123' },
              UpdateExpression: 'set expires = :e, sess.lastModified = :lm',
              // ExpressionAttributeValues: { ':e': 2898182909 },
              ReturnValues: 'UPDATED_NEW',
            },
            false,
          )
          .resolvesOnce({
            Attributes: {
              expires: 2898182909,
            },
          });

        const store = await DynamoDBStore.create({
          tableName,
          createTableOptions: {},
        });

        expect(store.tableName).toBe(tableName);
        expect(dynamoClient.calls().length).toBe(1);
        expect(ddbMock.calls().length).toBe(0);

        store.touch(
          '123',
          {
            // @ts-expect-error we know we have a cookie field
            user: 'test',
            cookie: {
              maxAge: 1000 * (14 * 24 - 4) * 60 * 60,
              originalMaxAge: 1000 * (14 * 24) * 60 * 60,
              expires: new Date(Date.now() + 1000 * (14 * 24 - 4) * 60 * 60),
            },
          },
          (err) => {
            expect(err).toBeNull();

            // We should have written to the DB
            expect(dynamoClient.calls().length).toBe(1);
            expect(ddbMock.calls().length).toBe(1);

            done();
          },
        );
      })();
    });
  });
});
