/* eslint-disable no-console */
import session from 'express-session';
import { DynamoDBStore } from '@pwrdrvr/connect-dynamodb-v3';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import express from 'express';

const { TABLE_NAME = 'connect-dynamodb-v3-test', PORT = '3001' } = process.env;

const dynamoDBClient = new dynamodb.DynamoDBClient({});

const app = express();
const port = 3001;

// Augment the session data with our own properties
// Note: we can't do this because it changes the type in all files of the project
// declare module 'express-session' {
//   interface SessionData {
//     user: string;
//     animal: 'cow' | 'pig';
//   }
// }

app.use(
  session({
    store: new DynamoDBStore({
      tableName: TABLE_NAME,
      dynamoDBClient,
    }),
    secret: 'yeah-dont-use-this',
    cookie: {
      maxAge: 60 * 60 * 1000, // one hour in milliseconds
      // sameSite: 'none',
      // If you set this to `true` then http://localhost will not work
      // there will be no Set-Cookie response header
      // secure: true,
    },
    // We implement `touch` to update the TTL on the session store
    // We do not want unmodified sessions to be saved as that will cause a
    // potentially massive cost issue on DynamoDB
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
