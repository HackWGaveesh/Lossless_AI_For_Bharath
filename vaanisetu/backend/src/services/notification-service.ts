import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '../utils/logger.js';

const sns = new SNSClient({ region: process.env.REGION });
const dynamo = new DynamoDBClient({ region: process.env.REGION });
const doc = DynamoDBDocumentClient.from(dynamo);

const USERS_TABLE = process.env.USERS_TABLE ?? 'vaanisetu-users';
const NOTIFICATION_TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN;

export async function sendSMS(phone: string, message: string): Promise<boolean> {
  if (!NOTIFICATION_TOPIC_ARN) {
    logger.warn('NOTIFICATION_TOPIC_ARN not set, skipping SMS');
    return false;
  }
  try {
    await sns.send(
      new PublishCommand({
        TopicArn: NOTIFICATION_TOPIC_ARN,
        Message: message,
        MessageAttributes: {
          phone: { DataType: 'String', StringValue: phone },
          type: { DataType: 'String', StringValue: 'sms' },
        },
      })
    );
    logger.info('SMS sent', { phone: phone.slice(-4) });
    return true;
  } catch (error) {
    logger.error('SMS send failed', { error });
    return false;
  }
}

export async function sendStatusUpdate(
  userId: string,
  applicationId: string,
  status: string,
  message: string
): Promise<boolean> {
  const res = await doc.send(
    new GetCommand({ TableName: USERS_TABLE, Key: { user_id: userId } })
  );
  const phone = res.Item?.phone as string | undefined;
  if (!phone) return false;
  const fullMessage = `[VaaniSetu] Application ${applicationId}: ${status}. ${message}`;
  return sendSMS(phone, fullMessage);
}
