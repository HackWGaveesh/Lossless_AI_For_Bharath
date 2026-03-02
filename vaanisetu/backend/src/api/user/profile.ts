import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';

const dynamo = new DynamoDBClient({ region: process.env.REGION });
const doc = DynamoDBDocumentClient.from(dynamo);
const USERS_TABLE = process.env.USERS_TABLE ?? 'vaanisetu-users';

function normalizeProfile(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (raw.name != null) out.name = raw.name;
  if (raw.fullName != null) { out.name = raw.fullName; out.fullName = raw.fullName; }
  if (raw.phone != null) out.phone = raw.phone;
  if (raw.state != null) out.state = raw.state;
  if (raw.district != null) out.district = raw.district;
  if (raw.age != null) out.age = raw.age;
  if (raw.gender != null) out.gender = raw.gender;
  if (raw.occupation != null) out.occupation = raw.occupation;
  if (raw.email != null) out.email = raw.email;
  if (raw.pincode != null) out.pincode = raw.pincode;
  if (raw.address != null) out.address = raw.address;
  const income = raw.annualIncome ?? raw.annual_income;
  if (income != null) { out.annualIncome = income; out.annual_income = income; }
  const caste = raw.casteCategory ?? raw.caste_category;
  if (caste != null) { out.casteCategory = caste; out.caste_category = caste; }
  const lang = raw.preferredLanguage ?? raw.preferred_language;
  if (lang != null) { out.preferredLanguage = lang; out.preferred_language = lang; }
  const bpl = raw.bplCardholder ?? raw.bpl_cardholder;
  if (bpl != null) { out.bplCardholder = bpl; out.bpl_cardholder = bpl; }
  if (raw.family_members != null) out.family_members = raw.family_members;
  return out;
}

function toPublicProfile(item: Record<string, unknown>): Record<string, unknown> {
  return {
    name: item.name,
    fullName: item.fullName ?? item.name,
    phone: item.phone,
    state: item.state,
    district: item.district,
    age: item.age,
    gender: item.gender,
    occupation: item.occupation,
    email: item.email,
    pincode: item.pincode,
    address: item.address,
    annualIncome: item.annualIncome ?? item.annual_income,
    annual_income: item.annual_income ?? item.annualIncome,
    casteCategory: item.casteCategory ?? item.caste_category,
    caste_category: item.caste_category ?? item.casteCategory,
    preferredLanguage: item.preferredLanguage ?? item.preferred_language,
    preferred_language: item.preferred_language ?? item.preferredLanguage,
    bplCardholder: item.bplCardholder ?? item.bpl_cardholder,
    bpl_cardholder: item.bpl_cardholder ?? item.bplCardholder,
    family_members: item.family_members,
  };
}

const IN_MEMORY_PROFILES: Record<string, any> = {};

export const handler: APIGatewayProxyHandler = async (event) => {
  const body = (event.httpMethod === 'PUT' || event.httpMethod === 'POST') ? parseJsonBody(event) : undefined;
  const userId = getUserIdFromEvent(event, body);
  if (!userId) {
    return sendErrorResponse(401, 'Unauthorized');
  }

  try {
    if (event.httpMethod === 'GET') {
      try {
        const res = await doc.send(
          new GetCommand({ TableName: USERS_TABLE, Key: { user_id: userId } })
        );
        const profile = (res.Item ?? IN_MEMORY_PROFILES[userId] ?? {}) as Record<string, unknown>;
        return sendSuccessResponse({ profile: toPublicProfile(profile) });
      } catch (dbError) {
        logger.warn('DynamoDB failed, using in-memory profile', { userId });
        const profile = (IN_MEMORY_PROFILES[userId] ?? {}) as Record<string, unknown>;
        return sendSuccessResponse({ profile: toPublicProfile(profile) });
      }
    }

    if (event.httpMethod === 'PUT' || event.httpMethod === 'POST') {
      const updates = normalizeProfile((body ?? {}) as Record<string, unknown>);
      const updatedFields = Object.keys(updates);
      if (!updatedFields.length) {
        return sendErrorResponse(400, 'No profile fields to update');
      }
      const updatedAt = new Date().toISOString();
      let merged: Record<string, unknown> = { ...(IN_MEMORY_PROFILES[userId] ?? {}), ...updates, updated_at: updatedAt };

      try {
        const existing = await doc.send(new GetCommand({ TableName: USERS_TABLE, Key: { user_id: userId } }));
        merged = {
          ...(existing.Item ?? {}),
          ...updates,
          user_id: userId,
          updated_at: updatedAt,
        };
        await doc.send(
          new PutCommand({
            TableName: USERS_TABLE,
            Item: merged,
          })
        );
      } catch (dbError) {
        logger.warn('DynamoDB failed, saving to in-memory store', { userId });
      }

      // Always update in-memory for immediate retrieval in dev
      IN_MEMORY_PROFILES[userId] = { ...(IN_MEMORY_PROFILES[userId] ?? {}), ...updates, updated_at: updatedAt };

      return sendSuccessResponse({
        profile: toPublicProfile(merged),
        updated_at: updatedAt,
        updatedFields,
      });
    }

    return sendErrorResponse(405, 'Method not allowed');
  } catch (error) {
    logger.error('Profile error', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};
