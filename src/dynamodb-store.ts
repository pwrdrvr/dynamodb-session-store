import * as session from 'express-session';
import {
  DynamoDBClient,
  CreateTableCommandInput,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import Debug from 'debug';
import { promisify } from 'util';

const sleep = promisify(setTimeout);
const debug = Debug('@pwrdrvr/dynamodb-session-store');

/**
 * DynamoDBStoreOptions are the options for creating a { @link DynamoDBStore }
 */
export interface DynamoDBStoreOptions {
  /**
   * AWS v3 SDK DynamoDB client, optionally wrapped with XRay, etc.
   *
   * @default new DynamoDBClient({})
   */
  readonly dynamoDBClient?: DynamoDBClient;

  /**
   * Name of the DynamoDB table to use (and optionally create)
   *
   * @defaultValue 'sessions'
   */
  readonly tableName?: string;

  /**
   * Only update the session TTL on `touch` events if `touchAfter` seconds has passed
   * since the last time the session TTL was updated.
   *
   * Set to `0` to always update the session TTL. - This is not suggested.
   *
   * @remarks
   *
   * Writes on DynamoDB cost 5x as much as reads for sessions < 1 KB.
   *
   * Writes on DynamoDB cost 20x as much as reads for sessions >= 3 KB and < 4 KB
   * - Reading a 3.5 KB session takes 1 RCUs
   * - Writing that same 3.5 KB session takes 4 WCUs
   *
   * ### Calculating Write Capacity Units - from AWS Docs
   *
   * [Managing settings on DynamoDB provisioned capacity tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ProvisionedThroughput.html#ItemSizeCalculations.Writes)
   *
   * `UpdateItem` — Modifies a single item in the table. DynamoDB considers the size of the item as
   * it appears before and after the update. The provisioned throughput consumed reflects the
   * larger of these item sizes. Even if you update just a subset of the item's attributes,
   * `UpdateItem` will still consume the full amount of provisioned throughput (the larger of the
   * "before" and "after" item sizes).
   *
   * @see {@link https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ProvisionedThroughput.html#ItemSizeCalculations.Writes }
   *
   * @defaultValue 3600 (1 hour) or 10% of the `ttl` if `ttl` is less than 36,000 (10 hours)
   */
  readonly touchAfter?: number;

  /**
   * Hash key name of the existing DynamoDB table or name of the hash key
   * to create if the table does not exist and the `createTableOptions`
   * do not provide a hash key name.
   *
   * @defaultValue 'id'
   */
  readonly hashKey?: string;

  /**
   * Prefix to add to the `sid` in the `hashKey` written to the DynamoDB table.
   *
   * @defaultValue 'session#'
   */
  readonly prefix?: string;

  /**
   * Create the DynamoDB table if it does not exist with OnDemand capacity
   *
   * NOT SUGGESTED: this can create the table in many accounts and regions
   * for any developer running the app locally with AWS credentials that
   * have permission to create tables.  This is also a bad idea
   * because the least expensive option for relatively stable loads
   * is to use ProvisionedCapacity with Application Auto Scaling
   * configured to adjust the Read and Write capacity.
   *
   * Set to `{}` enable creation of the table with default parameters, or
   * specify additional parameters.
   *
   * @default undefined - table will not be created
   */
  readonly createTableOptions?: Partial<CreateTableCommandInput>;

  /**
   * Strongly Consistent Reads should rarely be needed for a session store unless
   * the values in the session are updated frequently and they must absolutely
   * be the most recent version (which is very unliley as the most recent
   * write could fail, in which case the session would not be the most
   * recent version...).
   *
   * Reasons not to use Strongly Consistent Reads:
   * - They cost 2x more than Eventually Consistent Reads
   * - They can return a 500 if there is a network error or outage
   * - They can have higher latency than Eventually Consistent Reads
   *
   * @see { @link https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html }
   * @see { @link https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html}
   *
   * @defaultValue false
   */
  readonly useStronglyConsistentReads?: boolean;
}

/**
 * DynamoDBStore is an [express-session](https://www.npmjs.com/package/express-session) store that uses
 * [DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
 * as the backing store.
 *
 * @remarks
 *
 * DynamoDB is an excellent choice for session stores because it is
 * a fully managed service that is highly available, durable, and
 * can scale automatically (to nearly unlimited levels) to meet demand.
 *
 * DynamoDB reads will typically return in 1-3 ms if capacity is set
 * correctly and the caller is located in the same region as the `Table`.
 *
 * ### Example of Pricing
 *
 * Disclaimer: perform your own pricing calculation, monitor your costs
 * while launching, and setup cost alerts to avoid unexpected charges.
 *
 * [Saved AWS Pricing Calculation](https://calculator.aws/#/estimate?id=fb2f0d461ab2acd6c98a107059f75a4325918bda)
 *
 * Assumptions:
 * - Using Provisioned Capacity with auto-scaling
 * - Using Eventually Consistent Reads
 * - 2 KB average session size
 * - 100k RPM (requests per minute) average load
 * - 1 million new sessions per month (~0.4 new sessions / second)
 * - 8 million existing sessions
 * - 2 million session updates / expirations per month (~0.8 updates / second)
 *
 * Pricing:
 * - Storage
 *   - 2 KB * 8 million = 16 GB of storage
 *   - 16 GB * $0.25 / GB / month = $4 / month for storage
 * - Reads
 *   - 100k RPM / 60 seconds = ~1,700 RPS (requests per second)
 *   - 1 RCU (read capacity unit) per item * 0.5 (eventually consistent reads) = 0.5 RCU per read
 *   - 1,700 RPS * 0.5 RCU per read = 850 RCUs
 *   - 850 RCUs / read * 720 hours / month * $0.00013 / RCU / hour = ~$80 / month for reads
 * - Writes
 *   - 0.4 new sessions / second + 0.8 updates / second = 1.2 WPS (writes per second)
 *   - 1.2 WPS * 2 WCU (write capacity unit) per item = 2.4 WCUs
 *   - Allocate more WCUs to handle bursts
 *   - 100 WCUs * 720 hours / month * $0.00065 / WCU / hour = ~$50 / month for writes
 * - Total
 *   - $4 / month for storage
 *   - $80 / month for reads
 *   - $50 / month for writes
 *   - $134 / month total
 */
export class DynamoDBStore extends session.Store {
  private _dynamoDBClient: DynamoDBClient;
  private _ddbDocClient: DynamoDBDocument;
  private _createTableOptions?: Partial<CreateTableCommandInput>;

  private _tableName: string;
  /**
   * { @inheritDoc DynamoDBStoreOptions.tableName }
   */
  public get tableName(): string {
    return this._tableName;
  }

  private _touchAfter: number;
  /**
   * { @inheritDoc DynamoDBStoreOptions.touchAfter }
   */
  public get touchAfter(): number {
    return this._touchAfter;
  }

  private _useStronglyConsistentReads: boolean;
  /**
   * { @inheritDoc DynamoDBStoreOptions.useStronglyConsistentReads }
   */
  public get useStronglyConsistentReads(): boolean {
    return this._useStronglyConsistentReads;
  }
  public set useStronglyConsistentReads(value: boolean) {
    this._useStronglyConsistentReads = value;
  }

  private _hashKey: string;
  /**
   * { @inheritDoc DynamoDBStoreOptions.hashKey }
   */
  public get hashKey(): string {
    return this._hashKey;
  }

  private _prefix: string;
  /**
   * { @inheritDoc DynamoDBStoreOptions.prefix }
   */
  public get prefix(): string {
    return this._prefix;
  }

  /**
   * Create the table if it does not exist
   * Enable TTL field on the table if configured
   *
   * @remarks
   * This is not recommended for production use.
   *
   * For production the table should be created with IaaC (infrastructure as code)
   * such as AWS CDK, SAM, CloudFormation, Terraform, etc.
   */
  private async createTableIfNotExists() {
    try {
      const describeTable = await this._dynamoDBClient.send(
        new DescribeTableCommand({
          TableName: this._tableName,
        }),
      );
      if (describeTable.Table) {
        debug('table %s already exists', this._tableName);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      debug('table %s does not exist: %s', this._tableName, error.message);
    }

    const params: CreateTableCommandInput = {
      TableName: this._tableName,
      AttributeDefinitions: [
        {
          AttributeName: this._hashKey,
          AttributeType: 'S',
        },
      ],
      KeySchema: [
        {
          AttributeName: this._hashKey,
          KeyType: 'HASH',
        },
      ],
      ...this._createTableOptions,
    };

    debug('creating table %s, with params: %O', this._tableName, params);

    try {
      await this._dynamoDBClient.send(new CreateTableCommand(params));

      // Wait until the table is active
      let tableReady = false;
      for (let i = 0; i < 10; i++) {
        try {
          const describeTable = await this._dynamoDBClient.send(
            new DescribeTableCommand({
              TableName: this._tableName,
            }),
          );
          if (describeTable.Table && describeTable.Table.TableStatus === 'ACTIVE') {
            debug('table %s created', this._tableName);
            tableReady = true;
            break;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          debug('table %s not active yet: %s', this._tableName, error.message);
        }

        // Wait a bit before we check if the table is ready again
        await sleep(3000);
      }

      if (!tableReady) {
        debug('table not ready, returning %s', this._tableName, params);
        return;
      }

      // Create the TTL Config
      // This is probably really something that should be done in IaaC instead
      await this._dynamoDBClient.send(
        new UpdateTimeToLiveCommand({
          TableName: this._tableName,
          TimeToLiveSpecification: {
            AttributeName: 'expires',
            Enabled: true,
          },
        }),
      );

      debug('created table %s', this._tableName, params);
    } catch (err) {
      debug('error creating table %s: %s', this._tableName, err);
      throw err;
    }
  }

  /**
   * Create a DynamoDB Table-based express-session store.
   *
   * Note: This does not await creation of a table (which should only
   * be used in quick and dirty tests).
   *
   * @param options DynamoDBStore options
   *
   * @remarks
   * `createTableOptions` is not recommended for production use.
   */
  constructor(options: DynamoDBStoreOptions) {
    super();

    const {
      dynamoDBClient = new DynamoDBClient({}),
      tableName = 'sessions',
      createTableOptions,
      hashKey = 'id',
      useStronglyConsistentReads = false,
      prefix = 'session#',
      touchAfter = 3600,
    } = options;

    this._prefix = prefix;
    this._dynamoDBClient = dynamoDBClient;
    this._ddbDocClient = DynamoDBDocument.from(dynamoDBClient, {
      marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true },
    });
    this._tableName = tableName;
    this._touchAfter = touchAfter;
    this._createTableOptions = createTableOptions;
    this._hashKey = hashKey;
    this._useStronglyConsistentReads = useStronglyConsistentReads;

    // Don't await this - the table will either be ready or not on the first request
    // In non-quick-and-dirty tests the table will be created before the application is
    // ever started (via CDK, SAM, CloudFormation, Terraform, etc.)
    if (this._createTableOptions !== undefined) {
      void this.createTableIfNotExists();
    }
  }

  /**
   * Create the store and optionally await creation of the table.
   *
   * Note: Store-created tables is not advised for production use.
   *
   * @param options DynamoDBStore options
   */
  public static async create(options: DynamoDBStoreOptions): Promise<DynamoDBStore> {
    const optionsMinusTableOptions = {
      ...options,
    };
    delete optionsMinusTableOptions.createTableOptions;
    const store = new DynamoDBStore(optionsMinusTableOptions);

    if (options.createTableOptions !== undefined) {
      await store.createTableIfNotExists();
    }

    return store;
  }

  public get(
    /**
     * Session ID
     */
    sid: string,
    /**
     * Callback to return the session data
     * @param err Error
     * @param session Session data
     * @returns void
     */
    callback: (err: unknown, session?: session.SessionData | null) => void,
  ): void {
    void (async () => {
      try {
        const { Item } = await this._ddbDocClient.get({
          TableName: this._tableName,
          Key: {
            [this._hashKey]: `${this._prefix}${sid}`,
          },
          ConsistentRead: this._useStronglyConsistentReads,
        });

        if (!Item) {
          return callback(null, null);
        }

        // If session expired, return null
        // Note: DynamoDB uses seconds since epoch for the TTL field value
        if (Item.expires && Item.expires * 1000 < Date.now()) {
          return callback(null, null);
        }

        // If no sessionData, return null
        if (!Item.sess) {
          return callback(null, null);
        }

        // If the sessionData is a string, try to parse it as JSON
        if (typeof Item.sess === 'string') {
          try {
            Item.sess = JSON.parse(Item.sess);
          } catch (err) {
            return callback(err);
          }
        }

        // Return the session
        callback(null, Item.sess);
      } catch (err) {
        callback(err);
      }
    })();
  }

  public set(
    /**
     * Session ID
     */
    sid: string,
    /**
     * Session data
     * @remarks
     * The `expires` field is set by the session middleware and is used
     * by DynamoDB to automatically expire the session.
     * @see {@link https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html}
     * @see {@link https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html}
     * @see {@link https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/time-to-live-ttl-how-to.html}
     */
    session: session.SessionData,
    /**
     * Callback to return an error if the session was not saved
     * @param err Error
     * @returns void
     */
    callback?: (err?: unknown) => void,
  ): void {
    void (async () => {
      try {
        await this._ddbDocClient.put({
          TableName: this._tableName,
          Item: {
            [this._hashKey]: `${this._prefix}${sid}`,
            // Note: DynamoDB uses seconds since epoch for the expires field
            expires: this.newExpireSecondsSinceEpochUTC(session),
            // The `cookie` object is not marshalled correctly by the DynamoDBDocument client
            // so we strip the fields that we don't want and make sure the `expires` field
            // is turned into a string
            sess: {
              ...session,
              ...(session.cookie
                ? { cookie: { ...JSON.parse(JSON.stringify(session.cookie)) } }
                : {}),
            },
          },
        });
        if (callback) {
          callback(null);
        }
      } catch (error) {
        if (callback) {
          callback(error);
        }
      }
    })();
  }

  /**
   * Reset the TTL on the DynamoDB record to 100% of the original TTL
   *
   * @remarks
   * This is called by the session middleware on every single `get` request.
   */
  public touch(
    /**
     * Session ID
     */
    sid: string,
    /**
     * Session data
     */
    session: session.SessionData,
    /**
     * Callback to return an error if the session TTL was not updated
     */
    callback?: (err?: unknown) => void,
  ): void {
    void (async () => {
      try {
        // @ts-expect-error expires may exist
        const expiresTimeSecs = session.expires ? session.expires : 0;
        const currentTimeSecs = Math.floor(Date.now() / 1000);

        // Compute how much time has passed since this session was last touched
        const timePassedSecs =
          currentTimeSecs + session.cookie.originalMaxAge / 1000 - expiresTimeSecs;

        // Update the TTL only if touchAfter
        // seconds have passed since the TTL was last updated

        const touchAfterSecsCapped =
          this._touchAfter * 1000 > session.cookie.originalMaxAge
            ? Math.floor(0.1 * (session.cookie.originalMaxAge / 1000))
            : this._touchAfter;

        if (timePassedSecs > touchAfterSecsCapped) {
          const newExpires = this.newExpireSecondsSinceEpochUTC(session);

          await this._ddbDocClient.update({
            TableName: this._tableName,
            Key: {
              [this._hashKey]: `${this._prefix}${sid}`,
            },
            UpdateExpression: 'set expires = :e',
            ExpressionAttributeValues: {
              ':e': newExpires,
            },
            ReturnValues: 'UPDATED_NEW',
          });
        }
        if (callback) {
          callback(null);
        }
      } catch (err) {
        if (callback) {
          callback(err);
        }
      }
    })();
  }

  /**
   * Destroy the session in DynamoDB
   */
  public destroy(
    /**
     * Session ID
     */
    sid: string,
    /**
     * Callback to return an error if the session was not destroyed
     * @param err Error
     * @returns void
     */
    callback?: (err?: unknown) => void,
  ): void {
    void (async () => {
      try {
        await this._ddbDocClient.delete({
          TableName: this._tableName,
          Key: {
            [this._hashKey]: `${this._prefix}${sid}`,
          },
        });
        if (callback) {
          callback(null);
        }
      } catch (err) {
        if (callback) {
          callback(err);
        }
      }
    })();
  }

  private newExpireSecondsSinceEpochUTC(sess: session.SessionData): number {
    const expires =
      typeof sess.cookie.maxAge === 'number'
        ? +new Date() + sess.cookie.maxAge
        : +new Date() + 60 * 60 * 24 * 1000;
    return Math.floor(expires / 1000);
  }
}
