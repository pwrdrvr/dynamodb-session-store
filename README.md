# Overview

Partial, as of 2022-05-25, implementation of a DynamoDB-based session store for [express-session](https://www.npmjs.com/package/express-session), using the [AWS SDK for JS v3](https://github.com/aws/aws-sdk-js-v3).

# Features

- Configurability of `Strongly Consistent Reads`
  - Off by default as Eventually Consistent Reads are less expensive and more reliable
- Configurability of PoC-level Table creation
  - This should only be used during PoCs, else tables will be created in any accounts that developers point at using credentials that have permissions to create tables
- Cost reduction through reducing the TTL write on every read via `.touch()` calls from `express-session`
  - [This PR](https://github.com/expressjs/session/pull/892) for `express-session` would have made that a configurable option for every session store, but alas, it was rejected in favor of implementing the same thing 15+ times
  - These TTL writes consumed WCUs based on the size of the entire session, not just hte `expires` field
  - These writes were 10x more expensive than reads for under 1 KB session with ConsistentReads turned off
  - These writes were 40x more expensive than reads for 3-4 KB session with consistent reads turned off
    - Cost of 1 WCU is 5x that of 1 RCU
    - Eventually Consistent Read of 4 KB takes 0.5 RCU
    - Write of 1 KB takes 1 WCU, write of 4 KB takes 4 WCU

# Running Examples

## [express](./examples/express)

1. Create DynamoDB Table using AWS Console or any other method
   1. AWS CLI Example: ```aws dynamodb create-table --table-name dynamodb-session-store-test --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST```
   2. Default name is `dynamodb-session-store-test`
   3. Default partition key is `id`
   4. No sort key
   5. On-demand throughput is sufficient for the example, although not suggested for high volume use
   6. Time to live can be turned on for a field named `expires`
      1. `aws dynamodb update-time-to-live --table-name dynamodb-session-store-test --time-to-live-specification "Enabled=true, AttributeName=expires"`
2. `npm run example:express`
   1. If the table name was changed: `TABLE_NAME=my-table-name npm run example:express`

## [express with dynamodb-connect module - for comparison](./examples/other)

1. Create DynamoDB Table using AWS Console or any other method
   1. AWS CLI Example: ```aws dynamodb create-table --table-name connect-dynamodb-test --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST```
   2. Default name is `dynamodb-session-store-test`
   3. Default partition key is `id`
   4. No sort key
   5. On-demand throughput is sufficient for the example, although not suggested for high volume use
   6. Time to live can be turned on for a field named `expires`
      1. `aws dynamodb update-time-to-live --table-name connect-dynamodb-test --time-to-live-specification "Enabled=true, AttributeName=expires"`
2. `npm run example:express`
   1. If the table name was changed: `TABLE_NAME=my-table-name npm run example:other`

# Comparison with [dynamodb-connect](https://www.npmjs.com/package/dynamodb-connect)

## Benefits of `@pwrdrvr/dynamodb-session-store`

- Removes dangerous `scan` functionality that can make the DB completely unavailable if accidentally invoked
- Uses eventually consistent reads on DynamoDB by default to reduce cost, increase throughput, and improve reliability (configurable)
- Allows skipping `touch` calls that update the TTL on every read, which can be very expensive (configurable)
- Serializes the `sess` field to a `Map` on DynamoDB for easier querying vs `dynamodb-connect` which serializes to a `String`
- Migration from `dynamodb-connect` is easy, just set the `prefix`, `hashKey`, and `table` fields to the same values as `dynamodb-connect` - the `get` function will automatically deserialize the JSON `sess` field if found
- Examples of how to use the module with `express-session` are provided

## Example `@pwrdrvr/dynamodb-session-store` DB Record

```json
{
  "id": "123",
  "sess": {
    "cookie": {
       "originalMaxAge": null,
       "expires": null,
       "httpOnly": true,
       "path": "/"
    },
    "name": "paul"
  },
  "expires": 1621968000
}
```

<img width="1236" alt="image" src="https://github.com/pwrdrvr/connect-dynamodb-v3/assets/5617868/fdc9e6b4-4b28-4562-bf51-48b43d5555b1">

## Example `dynamodb-connect` DB Record

```json
{
  "id": "123",
  "sess": "{\"cookie\":{\"originalMaxAge\":null,\"expires\":null,\"httpOnly\":true,\"path\":\"/\"},\"name\":\"paul\"}",
  "expires": 1621968000
}
```

<img width="1236" alt="image" src="https://github.com/pwrdrvr/connect-dynamodb-v3/assets/5617868/7815582a-c12a-49ec-83c0-323d76d441a6">


