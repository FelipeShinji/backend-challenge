#!/bin/sh
ENDPOINT="http://localhost:4566"

awslocal --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=false

DLQ_ARN=$(awslocal --endpoint-url=$ENDPOINT sqs get-queue-attributes \
  --queue-url $ENDPOINT/000000000000/wager-transactions-dlq.fifo \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes "FifoQueue=true,ContentBasedDeduplication=false,RedrivePolicy={\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"}"

echo "Filas criadas."
