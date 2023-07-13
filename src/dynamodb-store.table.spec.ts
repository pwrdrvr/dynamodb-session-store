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

    it('destroy record', (done) => {
      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
      });

      store.set(
        '456',
        {
          user: 'test',
          // @ts-expect-error something
          cookie: {},
        },
        (err) => {
          expect(err).toBeNull();

          store.destroy('456', (err) => {
            expect(err).toBeNull();

            store.get('456', (err, session) => {
              expect(err).toBeNull();

              // There should be no record returned
              expect(session).toBeNull();
              done();
            });
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
          // @ts-expect-error something
          user: 'test',
          cookie: {
            expires: new Date(),
            maxAge: 0,
            originalMaxAge: 60 * 60 * 1000, // one hour in milliseconds
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
          user: 'test',
          // @ts-expect-error something
          cookie: {
            maxAge: 60 * 60 * 1000, // one hour in milliseconds
          },
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

                      // Read the item from the table and check the TTL
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

    it('can serialize Date objects to strings', (done) => {
      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
      });

      const originalSessionObject = {
        // Use a static date to ensure the same value is stored and retrieved
        dateField: new Date('2021-07-01T01:02:03Z'),
      };

      store.set(
        '129',
        {
          mySessionInfo: originalSessionObject,
          // @ts-expect-error something
          cookie: {
            maxAge: 60 * 60 * 1000, // one hour in milliseconds
          },
        },
        (err) => {
          expect(err).toBeNull();

          ddbDocClient
            .send(new GetCommand({ TableName: tableName, Key: { id: 'session#129' } }))
            .then(({ Item }) => {
              expect(Item).toBeDefined();
              expect(Item!.sess).toBeDefined();
              expect(Item!.sess.mySessionInfo).toBeDefined();
              expect(Item!.sess.mySessionInfo.dateField).toBeDefined();

              // Check that the DB has a string
              expect(Item!.sess.mySessionInfo.dateField).toBe('2021-07-01T01:02:03.000Z');

              store.get('129', (err, session) => {
                expect(err).toBeNull();
                expect(session).toBeDefined();

                // @ts-expect-error yes mySessionInfo exists
                const typedSession = session as {
                  mySessionInfo: {
                    dateField: Date;
                  };
                };

                expect(typedSession!.mySessionInfo).toBeDefined();
                // The date field is not going to be a date object
                // since we do not have a schema to know which fields to
                // convert to back into dates and which were strings
                // to begin with
                // expect(typedSession!.mySessionInfo.dateField).toBeInstanceOf(Date);
                expect(typedSession!.mySessionInfo.dateField).toEqual('2021-07-01T01:02:03.000Z');

                // Confirm that the original field is still a date object
                expect(originalSessionObject.dateField).toBeInstanceOf(Date);

                done();
              });
            })
            .catch((err) => {
              done(err);
            });
        },
      );
    });

    it('can serialize / deserialize string / object / boolean / number values', (done) => {
      const store = new DynamoDBStore({
        dynamoDBClient: dynamoClient,
        tableName,
      });

      store.set(
        '129',
        {
          mySessionInfo: {
            stringField: 'some string',
            numberField: 123,
            floatingNumberField: 123.456,
            someBooleanField: true,
            someOtherBooleanField: false,
            someObjectField: {
              nestedField: 'nested value',
            },
            someUndefinedField: undefined,
            someNullField: null,
          },
          // @ts-expect-error something
          cookie: {
            maxAge: 60 * 60 * 1000, // one hour in milliseconds
          },
        },
        (err) => {
          expect(err).toBeNull();

          ddbDocClient
            .send(new GetCommand({ TableName: tableName, Key: { id: 'session#129' } }))
            .then(({ Item }) => {
              expect(Item).toBeDefined();
              expect(Item!.sess).toBeDefined();
              expect(Item!.sess.mySessionInfo).toBeDefined();

              // Check that the DB record looks correct
              expect(Item!.sess.mySessionInfo.stringField).toBe('some string');
              expect(Item!.sess.mySessionInfo.numberField).toBe(123);
              expect(Item!.sess.mySessionInfo.floatingNumberField).toBe(123.456);
              expect(Item!.sess.mySessionInfo.someBooleanField).toBe(true);
              expect(Item!.sess.mySessionInfo.someOtherBooleanField).toBe(false);
              expect(Item!.sess.mySessionInfo.someObjectField).toBeDefined();
              expect(Item!.sess.mySessionInfo.someObjectField.nestedField).toBe('nested value');
              expect(Item!.sess.mySessionInfo.someUndefinedField).toBeUndefined();
              expect(Item!.sess.mySessionInfo.someNullField).toBeNull();

              store.get('129', (err, session) => {
                expect(err).toBeNull();
                expect(session).toBeDefined();

                // @ts-expect-error yes mySessionInfo exists
                const typedSession = session as {
                  mySessionInfo: {
                    stringField: string;
                    numberField: number;
                    floatingNumberField: number;
                    someBooleanField: boolean;
                    someOtherBooleanField: boolean;
                    someObjectField: {
                      nestedField: string;
                    };
                    someUndefinedField: undefined;
                    someNullField: null;
                  };
                };

                expect(typedSession!.mySessionInfo).toBeDefined();

                // Check that the values are correct
                expect(typedSession!.mySessionInfo.stringField).toBe('some string');
                expect(typedSession!.mySessionInfo.numberField).toBe(123);
                expect(typedSession!.mySessionInfo.floatingNumberField).toBe(123.456);
                expect(typedSession!.mySessionInfo.someBooleanField).toBe(true);
                expect(typedSession!.mySessionInfo.someOtherBooleanField).toBe(false);
                expect(typedSession!.mySessionInfo.someObjectField).toBeDefined();
                expect(typedSession!.mySessionInfo.someObjectField.nestedField).toBe(
                  'nested value',
                );
                expect(typedSession!.mySessionInfo.someUndefinedField).toBeUndefined();
                expect(typedSession!.mySessionInfo.someNullField).toBeNull();

                done();
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
