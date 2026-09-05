import { z } from 'zod';
import { dateSchema, networkSchema } from '../config/env.js';

export const pagination = { limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).max(1000000).default(0) };
const optionalPeriod = { from: dateSchema.optional(), to: dateSchema.optional(), network: networkSchema.optional() };
const validPeriod = (v: { from?: string; to?: string }) => !v.from || !v.to || v.from <= v.to;
export const syncSchema = z.object({ from: dateSchema.optional(), to: dateSchema.optional() }).strict().refine(validPeriod, 'from must be <= to');
export const recentSchema = z.object({ ...pagination, limit: pagination.limit.default(10) }).strict();
export const spendingSchema = z.object({ from: dateSchema, to: dateSchema, network: networkSchema.optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('month') }).strict().refine(validPeriod, 'from must be <= to');
export const searchSchema = z.object({ ...optionalPeriod, ...pagination, query: z.string().trim().min(1).max(200), categoryCode: z.string().max(100).optional() }).strict().refine(validPeriod, 'from must be <= to');
export const historySchema = z.object({ ...optionalPeriod, ...pagination, pluId: z.string().min(1).max(100) }).strict().refine(validPeriod, 'from must be <= to');
export const topSchema = z.object({ from: dateSchema, to: dateSchema, network: networkSchema.optional(),
  categoryCode: z.string().max(100).optional(), limit: pagination.limit }).strict().refine(validPeriod, 'from must be <= to');
