/* eslint-disable no-console */
import session, { SessionOptions } from 'express-session';
import { DynamoDBStore } from '@pwrdrvr/connect-dynamodb-v3';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import express from 'express';

const { TABLE_NAME = 'connect-dynamodb-v3-test', PORT = '3001' } = process.env;

const dynamoDBClient = new dynamodb.DynamoDBClient({});

const sessionConfig: SessionOptions = {
  store: new DynamoDBStore({
    tableName: TABLE_NAME,
    dynamoDBClient,
  }),
  secret: 'yeah-dont-use-this',
  cookie: {
    maxAge: 60 * 60 * 1000, // one hour in milliseconds
    sameSite: 'none',
    secure: true,
  },
  // We implement `touch` to update the TTL on the session store
  // We do not want unmodified sessions to be saved as that will cause a
  // potentially massive cost issue on DynamoDB
  resave: false,
  saveUninitialized: false,
};

const app = express();
const port = 3001;

// Return a 200 response for all routes
app.use((req, res, next) => {
  res.send('Hello World!');
  res.status(200);
  next();
});

app.listen(Number.parseInt(PORT, 10), () => {
  console.log(`Example app listening on port ${port}`);
});

app.use(session(sessionConfig));
