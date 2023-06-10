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
const debug = Debug('connect-dynamodb-v3');

export interface DynamoDBStoreOptions {
  /**
   * AWS v3 SDK DynamoDB client, optionally wrapped with XRay, etc.
   *
   * @default - new DynamoDBClient({})
   */
  readonly dynamoDBClient?: DynamoDBClient;

  /**
   * Name of the DynamoDB table to use (and optionally create)
   *
   * @default sessions
   */
  readonly tableName?: string;

  /**
   * Time to live for sessions in seconds.
   *
   * The IaaC (infrastructure as code) that creates the DynamoDB table
   * should set the TimeToLive configuration for the Table to use the field
   * `expires`.
   *
   * The DynamoDB built-in mechanism for TTL is the only way that records
   * will ever be automatically aged out.  Scanning and deleting is
   * incredibly expensive and inefficient and is not provided as an option.
   *
   * @default 1209600 (2 weeks)
   */
  readonly ttl?: number;

  /**
   * Only update the session TTL on `touch` events if `touchAfter` seconds has passed
   * since the last time the session TTL was updated.
   *
   * Set to `0` to always update the session TTL. - This is not suggested.
   *
   * Writes on DynamoDB cost 5x as much as reads for sessions < 1 KB.
   *
   * Writes on DynamoDB cost 20x as much as reads for sessions >= 3 KB and < 4 KB
   * - Reading a 3.5 KB session takes 1 RCUs
   * - Writing that same 3.5 KB session takes 4 WCUs
   *
   * ```
   * `UpdateItem` — Modifies a single item in the table. DynamoDB considers the size of the item as
   * it appears before and after the update. The provisioned throughput consumed reflects the
   * larger of these item sizes. Even if you update just a subset of the item's attributes,
   * UpdateItem will still consume the full amount of provisioned throughput (the larger of the
   * "before" and "after" item sizes).
   * ```
   *
   * @see {@link https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ProvisionedThroughput.html#ItemSizeCalculations.Writes }
   *
   * @default 3600 (1 hour) or 10% of the `ttl` if `ttl` is less than 36,000 (10 hours)
   */
  readonly touchAfter?: number;

  /**
   * Hash key name of the existing DynamoDB table or name of the hash key
   * to create if the table does not exist and the createTableOptions
   * do not provide a hash key name.
   */
  readonly hashKey?: string;

  /**
   * Prefix to add to the `sid` in the `hashKey` written to the DynamoDB table.
   *
   * @default `sess:`
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
   * @default false
   */
  readonly useStronglyConsistentReads?: boolean;
}

export class DynamoDBStore extends session.Store {
  private _dynamoDBClient: DynamoDBClient;
  private _ddbDocClient: DynamoDBDocument;
  private _createTableOptions: Partial<CreateTableCommandInput>;

  private _tableName: string;
  public get tableName(): string {
    return this._tableName;
  }

  private _touchAfter: number;
  public get touchAfter(): number {
    return this._touchAfter;
  }

  private _useStronglyConsistentReads: boolean;
  public get useStronglyConsistentReads(): boolean {
    return this._useStronglyConsistentReads;
  }
  public set useStronglyConsistentReads(value: boolean) {
    this._useStronglyConsistentReads = value;
  }

  private _ttl: number;
  public get ttl(): number {
    return this._ttl;
  }

  private _hashKey: string;
  public get hashKey(): string {
    return this._hashKey;
  }

  private _prefix: string;
  public get prefix(): string {
    return this._prefix;
  }

  /**
   * Create the table if it does not exist
   * @returns
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
    } catch (error) {
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
        } catch (error) {
          debug('table %s not active yet: %s', this._tableName, error.message);
        }

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
   * @param options
   */
  constructor(options: DynamoDBStoreOptions) {
    super();

    const {
      dynamoDBClient = new DynamoDBClient({}),
      tableName = 'sessions',
      ttl = 1209600,
      touchAfter,
      createTableOptions,
      hashKey = 'id',
      useStronglyConsistentReads = false,
    } = options;

    let touchAfterDefault = 3600;
    if (touchAfter === undefined && ttl < touchAfterDefault * 10) {
      touchAfterDefault = Math.floor(ttl * 0.1);
      debug('reducing touchAfter default to %d seconds', touchAfterDefault);
    }

    this._dynamoDBClient = dynamoDBClient;
    this._ddbDocClient = DynamoDBDocument.from(dynamoDBClient);
    this._tableName = tableName;
    this._ttl = ttl;
    this._touchAfter = touchAfter ?? touchAfterDefault;
    this._createTableOptions = createTableOptions;
    this._hashKey = hashKey;
    this._useStronglyConsistentReads = useStronglyConsistentReads;

    // Don't await this - the table will either be ready or not on the first request
    // In non-quick-and-dirty tests the table will be created before the application is
    // every started (via CDK, SAM, CloudFormation, Terraform, etc.)
    if (this._createTableOptions !== undefined) {
      void this.createTableIfNotExists();
    }
  }

  /**
   * Create the store and optionally await creation of the table.
   *
   * Note: Store-created tables is not advised for production use.
   *
   * @param options
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

  public get(sid: string, callback: (err: unknown, session?: session.SessionData) => void): void {
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

        // TODO: If session expired, return null

        // TODO: If no sessionData, return null

        callback(null, Item.sess);
      } catch (err) {
        callback(err);
      }
    })();
  }

  public set(sid: string, session: session.SessionData, callback?: (err?: unknown) => void): void {
    void (async () => {
      try {
        await this._ddbDocClient.put({
          TableName: this._tableName,
          Item: {
            [this._hashKey]: `${this._prefix}${sid}`,
            // TODO: expires field
            sess: session,
          },
        });
        callback(null);
      } catch (error) {
        callback(error);
      }
    })();
  }

  public touch(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    sid: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    session: session.SessionData,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    callback?: (err?: unknown) => void,
  ): void {
    throw new Error('Method not implemented.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public destroy(sid: string, callback?: (err?: unknown) => void): void {
    throw new Error('Method not implemented.');
  }
}
