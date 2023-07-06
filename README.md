[![npm (scoped)](https://img.shields.io/npm/v/%40pwrdrvr/dynamodb-session-store)](https://www.npmjs.com/package/@pwrdrvr/dynamodb-session-store) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT) [![API Docs](https://img.shields.io/badge/API%20Docs-View%20Here-blue)](https://pwrdrvr.github.io/dynamodb-session-store/) [![Build - CI](https://github.com/pwrdrvr/dynamodb-session-store/actions/workflows/ci.yml/badge.svg)](https://github.com/pwrdrvr/dynamodb-session-store/actions/workflows/ci.yml) [![Publish Docs](https://github.com/pwrdrvr/dynamodb-session-store/actions/workflows/docs.yml/badge.svg)](https://github.com/pwrdrvr/dynamodb-session-store/actions/workflows/docs.yml)

# Overview

[DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)-based session store for [express-session](https://www.npmjs.com/package/express-session), using the [AWS SDK for JS v3](https://github.com/aws/aws-sdk-js-v3), offering configurability for cost, performance, and reliability not found in other DynamoDB session stores.

DynamoDB is an excellent choice for session stores because it is a fully managed service that is highly available, durable, and can scale automatically (to nearly unlimited levels) to meet demand. DynamoDB reads will typically return in 1-3 ms if capacity is set correctly and the caller is located in the same region as the `Table`.

# Features

- Configurability of `Strongly Consistent Reads`
  - Off by default as Eventually Consistent Reads are less expensive and more reliable
- Configurability of PoC-level Table creation
  - This should only be used during PoCs, else tables will be created in any accounts that developers point at using credentials that have permissions to create tables
- Cost reduction through reducing the TTL write on every read via `.touch()` calls from `express-session`
  - [This PR](https://github.com/expressjs/session/pull/892) for `express-session` would have made that a configurable option for every session store, but alas, it was rejected in favor of implementing the same thing 15+ times
  - These TTL writes consumed WCUs based on the size of the entire session, not just the `expires` field
  - These writes were 10x more expensive than reads for under 1 KB session with ConsistentReads turned off
  - These writes were 40x more expensive than reads for 3-4 KB session with consistent reads turned off
    - Cost of 1 WCU is 5x that of 1 RCU
    - Eventually Consistent Read of 4 KB takes 0.5 RCU
    - Write of 1 KB takes 1 WCU, write of 4 KB takes 4 WCU

# Configuration Tips

- Use a Table per-region if you are deployed in multiple regions
- Use a Table per-environment if you are deployed in multiple environments (e.g. dev/qa/prod)
- Use a Table unique to the session store - do not try to overload other data into this Table as the scaling and expiration needs will not overlap well
- For applications attached to a VPC (including Lambda's attached to a VPC), use a VPC Endpoint for DynamoDB to avoid the cost, latency, and additional reliability exposure of crossing NAT Gateway to reach DynamoDB
- Use Provisioned Capacity with auto-scaling to avoid throttling and to achieve the lowest cost - On Demand seems nice but it is costly

# Example of Pricing

Disclaimer: perform your own pricing calculation, monitor your costs during and after initial launch, and setup cost alerts to avoid unexpected charges.

[Saved AWS Pricing Calculation](https://calculator.aws/#/estimate?id=fb2f0d461ab2acd6c98a107059f75a4325918bda)

## Assumptions
 - Using Provisioned Capacity with auto-scaling
 - Using Eventually Consistent Reads
 - 2 KB average session size
 - 100k RPM (requests per minute) average load
 - 1 million new sessions per month (~0.4 new sessions / second)
 - 8 million existing sessions
 - 2 million session updates / expirations per month (~0.8 updates / second)

## Pricing Calculation
 - Storage
   - 2 KB * 8 million = 16 GB of storage
   - 16 GB * $0.25 / GB / month = $4 / month for storage
 - Reads
   - 100k RPM / 60 seconds = ~1,700 RPS (requests per second)
   - 1 RCU (read capacity unit) per item * 0.5 (eventually consistent reads) = 0.5 RCU per read
   - 1,700 RPS * 0.5 RCU per read = 850 RCUs
   - 850 RCUs / read * 720 hours / month * $0.00013 / RCU / hour = ~$80 / month for reads
 - Writes
   - 0.4 new sessions / second + 0.8 updates / second = 1.2 WPS (writes per second)
   - 1.2 WPS * 2 WCU (write capacity unit) per item = 2.4 WCUs
   - Allocate more WCUs to handle bursts
   - 100 WCUs * 720 hours / month * $0.00065 / WCU / hour = ~$50 / month for writes
 - Total
   - $4 / month for storage
   - $80 / month for reads
   - $50 / month for writes
   - $134 / month total

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
3. Load `http://localhost:3001/login` in a browser
4. Observe that a cookie is returned and does not change

## [cross-account](./examples/cross-account)

This example has the DynamoDB in one account and the express app using an IAM role from another account to access the DynamoDB Table using temporary credentials from an STS AssumeRole call (neatly encapsulated by the AWS SDK for JS v3).

This example is more involved than the others as it requires setting up an IAM role that can be assumed by the app account.

[Instructions for Cross-Account DynamoDB Table Example](./examples/CROSS-ACCOUNT.md)

![Session Store with DynamoDB Table in Another Account](https://github.com/pwrdrvr/dynamodb-session-store/assets/5617868/dbc8d07b-b2f3-42c8-96c9-2476007ed24c)

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
3. Load `http://localhost:3001/login` in a browser
4. Observe that a cookie is returned and does not change

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
