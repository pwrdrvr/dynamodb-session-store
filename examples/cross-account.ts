/* eslint-disable no-console */
import session from 'express-session';
import { DynamoDBStore } from '@pwrdrvr/dynamodb-session-store';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import express from 'express';

const {
  TABLE_ARN = 'dynamodb-session-store-test',
  TABLE_ROLE_ARN = '',
  PORT = '3001',
} = process.env;

const dynamoDBClient = new dynamodb.DynamoDBClient({
  // fromTemporaryCredentials docs:
  // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-credential-providers/Variable/fromTemporaryCredentials/
  // Note: this will auto-renew the session either before it expires or when it detects
  // an unauthorized error (I haven't check the docs or code to confirm which, but I suspect on error)
  credentials: fromTemporaryCredentials({
    // Required. Options passed to STS AssumeRole operation.
    params: {
      // Required. ARN of role to assume.
      RoleArn: TABLE_ROLE_ARN,
      // Optional. An identifier for the assumed role session. If skipped, it generates a random
      // session name with prefix of 'aws-sdk-js-'.
      RoleSessionName: 'dynamodb-session-store-cross-account',
      // Optional. The duration, in seconds, of the role session.
      // Set to 900 seconds (15 minutes) to see the session get refreshed around 10 mins
      DurationSeconds: 3600,
      // ... For more options see https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
    },
  }),
});

const app = express();
const port = 3001;

app.use(
  session({
    store: new DynamoDBStore({
      tableName: TABLE_ARN,
      dynamoDBClient,
      touchAfter: 60 * 5, // 5 minutes in seconds
    }),
    secret: 'yeah-dont-use-this',
    cookie: {
      maxAge: 60 * 60 * 1000, // one hour in milliseconds
    },
    resave: false,
    saveUninitialized: false,
  }),
);

// Add a fake login route that will set a session cookie
app.get('/login', (req, res) => {
  console.log(`Session ID: ${req.session?.id}`);
  // @ts-expect-error user is defined
  req.session.user = 'test';
  res.send('Logged in');
});

// Return a 200 response for all routes
app.get('/*', (req, res) => {
  res.status(200).send('Hello world');
});

app.listen(Number.parseInt(PORT, 10), () => {
  console.log(`Example app listening on port ${port}`);
});
