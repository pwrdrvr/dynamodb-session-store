# Cross-Account Example Setup

There are a variety of ways to set this up, such as through the AWS Console, the AWS CLI, SAM, CDK, etc.  For the purposes of demonstrating that the session renewal works automatically, we will use the AWS CLI.

[Example Source Code](./cross-account.ts)

## Setup in the Account that Owns the Table

Change `ACCOUNT_USAGE` to the account number that will be using the table.

Copy and paste the whole thing into a shell and it will create the table and the role.

```bash
export TABLE_NAME=dynamodb-session-store-test
export ACCOUNT_USAGE=123456789012
export ROLE_NAME_TABLE=dynamodb-session-store-test

# Create the table
aws dynamodb create-table --table-name ${TABLE_NAME} --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST

# Save the table ARN
export TABLE_ARN=$(aws dynamodb describe-table --table-name ${TABLE_NAME} --query Table.TableArn --output text)

# Create the IAM role and allow all roles in the usage account to assume it
# Note: Don't use `root` as the trust policy in anything other than a demo account
aws iam create-role --role-name "${ROLE_NAME_TABLE}" --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAssumeRole",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::'"${ACCOUNT_USAGE}"':root"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}'

# Add inline policy to allow access to the table
aws iam put-role-policy --policy-name "dynamodb-access" --role-name "${ROLE_NAME_TABLE}" --policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowDynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": "'"${TABLE_ARN}"'"
    }
  ]
}'
```

## Run the Example App

In the same shell, change to the Usage Account.

Run the example app:

```bash
# Note: TABLE_ARN will be set to the full ARN of the table in the Table Account
# Note: TABLE_ROLE_ARN will be set to the full ARN of the role in the Table Account
npm run example:cross-account
```

## Hit the Login Route

http://localhost:3001/login

## Observations

- On AWS Console / CloudTrail / Event History
  - In Table account
  - Set event source to `sts.amazonaws.com`
  - You will observe an AssumeRole operation that succeeds from the Usage Account
  - When the session is about to expire, you will observe another AssumeRole operation that succeeds from the Usage Account
- On the node app console
  - No errors will be observed when the session is renewed

## Cleaning Up Resources

```bash
aws iam delete-role-policy --role-name "${ROLE_NAME_TABLE}" --policy-name "dynamodb-access"
aws iam delete-role --role-name "${ROLE_NAME_TABLE}"
aws dynamodb delete-table --table-name "${TABLE_NAME}"
```