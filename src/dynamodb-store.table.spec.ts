/* eslint-disable @typescript-eslint/no-non-null-assertion */
import 'jest-dynalite/withDb';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBStore } from './dynamodb-store';

describe('dynamodb-store - table via jest-dynalite', () => {
  let dynamoClient: dynamodb.DynamoDBClient;
  let ddbDocClient: DynamoDBDocumentClient;
  const tableName = 'sessions-test';

  beforeAll(() => {
    dynamoClient = new dynamodb.DynamoDBClient({
      endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
      tls: false,
      region: 'local',
    });
    ddbDocClient = DynamoDBDocumentClient.from(dynamoClient);
  });

  afterAll(() => {
    dynamoClient.destroy();
  }, 20000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

    it('record found, not expired', (done) => {
      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
      });

      store.set(
        '123',
        {
          user: 'test',
          // @ts-expect-error something
          cookie: {},
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

    it('record found, expired', (done) => {
      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
      });

      // Mock the current date and time
      const mockCurrentTime = new Date('2022-07-01T00:00:00Z').getTime();

      // Spy on the Date object and mock the now() method
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => mockCurrentTime);

      store.set(
        '301',
        {
          user: 'test',
          // @ts-expect-error something
          cookie: {
            expires: new Date(),
          },
        },
        (err) => {
          expect(err).toBeNull();

          // Reset the mock so we check the current time against the expires field
          nowSpy.mockReset();

          store.get('301', (err, session) => {
            expect(err).toBeNull();

            // There should be no session returned since it expired
            expect(session).toBeNull();
            done();
          });
        },
      );
    });

    it('does not change ttl on get after create', (done) => {
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

          ddbDocClient
            .send(new GetCommand({ TableName: tableName, Key: { id: 'session#123' } }))
            .then(({ Item }) => {
              const expiresAfterSet = Item!.expires;

              expect(expiresAfterSet).not.toBeNull();
              expect(expiresAfterSet).toBeGreaterThan(Date.now() / 1000);

              store.get('123', (err, session) => {
                expect(err).toBeNull();
                expect(session).not.toBeNull();

                // Read the item from the table and check the TTL
                ddbDocClient
                  .send(new GetCommand({ TableName: tableName, Key: { id: 'session#123' } }))
                  .then(({ Item }) => {
                    const expiresAfterFirstGet = Item!.expires;

                    store.get('123', (err2, session2) => {
                      expect(err2).toBeNull();
                      expect(session2).not.toBeNull();

                      // TODO: Read the item from the table and check the TTL
                      ddbDocClient
                        .send(new GetCommand({ TableName: tableName, Key: { id: 'session#123' } }))
                        .then(({ Item }) => {
                          const expiresAfterSecondGet = Item!.expires;

                          expect(expiresAfterSet).toEqual(expiresAfterFirstGet);
                          expect(expiresAfterFirstGet).toEqual(expiresAfterSecondGet);

                          done();
                        })
                        .catch((err) => {
                          done(err);
                        });
                    });
                  })
                  .catch((err) => {
                    done(err);
                  });
              });
            })
            .catch((err) => {
              done(err);
            });
        },
      );
    });
  });
});
