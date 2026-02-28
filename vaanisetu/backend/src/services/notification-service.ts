import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '../utils/logger.js';

const sns = new SNSClient({ region: process.env.REGION });
const dynamo = new DynamoDBClient({ region: process.env.REGION });
const doc = DynamoDBDocumentClient.from(dynamo);

const USERS_TABLE = process.env.USERS_TABLE ?? 'vaanisetu-users';

export async function sendSMS(phone: string, message: string): Promise<boolean> {
  const target = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '').slice(-10)}`;
  try {
    await sns.send(
      new PublishCommand({
        PhoneNumber: target,
        Message: message,
      })
    );
    logger.info('SMS sent', { phone: target.slice(-4) });
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
