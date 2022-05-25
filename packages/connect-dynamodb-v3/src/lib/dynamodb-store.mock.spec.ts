import { inspect } from 'util';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
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
      dynamoClient.onAnyCommand().callsFake((input) => {
        console.log(inspect(input, true, 10, true));
      });
      ddbMock
        .onAnyCommand()
        .callsFake((input) => {
          console.log(inspect(input, true, 10, true));
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

      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
      });

      await store.createTableIfNotExists();

      expect(store.tableName).toBe(TEST_TABLE_NAME);
    });
  });
});
