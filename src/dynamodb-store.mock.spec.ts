/* eslint-disable no-console */
import * as dynamodb from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient, AwsClientStub } from 'aws-sdk-client-mock';
import { DynamoDBStore } from './dynamodb-store';

describe('dynamodb-store - mock AWS API', () => {
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
});
