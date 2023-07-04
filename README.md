# Overview

Partial, as of 2022-05-25, implementation of a DynamoDB-based session store for [express-session](https://www.npmjs.com/package/express-session), using the [AWS SDK for JS v3](https://github.com/aws/aws-sdk-js-v3).

# Features

- Configurability of `Strongly Consistent Reads`
  - Off by default as Eventually Consistent Reads are less expensive and more reliable
- Configurability of PoC-level Table creation
  - This should only be used during PoCs, else tables will be created in any accounts that developers point at using credentials that have permissions to create tables
- Cost reduction through reducing the TTL write on every read via `.touch()` calls from `express-session`
  - These TTL writes consumed WCUs based on the size of the entire session, not just hte `expires` field
  - These writes were 10x more expensive than reads for under 1 KB session with ConsistentReads turned off
  - These writes were 40x more expensive than reads for 3-4 KB session with consistent reads turned off
    - Cost of 1 WCU is 5x that of 1 RCU
    - Eventually Consistent Read of 4 KB takes 0.5 RCU
    - Write of 1 KB takes 1 WCU, write of 4 KB takes 4 WCU

# Running Examples

## [express](./examples/express)

1. Create DynamoDB Table using AWS Console or any other method
   1. Default name is `connect-dynamodb-v3-test`
   2. Default partition key is `id`
   3. No sort key
   5. On-demand throughput is sufficient for the example, although not suggested for high volume use
   6. Time to live can be turned on for a field named `expires`
2. `npm run example:express`
   1. If the table name was changed: `TABLE_NAME=my-table-name npm run example:express`
