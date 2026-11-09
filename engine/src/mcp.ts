#!/usr/bin/env -S npx tsx
// laytime-engine MCP server (stdio). Two tools, both COMPUTE: nothing is stored, nothing leaves the process.
//   laytime_check  — check someone's laytime figure against every reading the documents allow
//   laytime_case   — run every reading of a case and return the range and the swing per disputed point
// Dates are ISO strings in the port's local time carried as UTC (e.g. "2026-03-24T00:00Z"), unless terms.portTimeZone is set.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { checkSheet, caseFromJson } from './check.js';
import { runCase } from './case.js';

const CASE_HELP = 'A case file as JSON: { id, title, terms: { quantityMt, ratePerDayMt | allowedHours, exceptionRule (shinc|shex|fhex|eiu|uu), ' +
  'commencedAt?, completedAt, demurrageRate, despatchRate, despatchBasis?, onceOnDemurrage?, currency? }, quotes: [{field,text,source}], ' +
  'base: [{start,end,reason,sourceRef?,clause?,appliesOnDemurrage?,countFraction?}], points: [{id,title,facts,readings:[{id,label,why,side,commencedAt?,stoppages?}]}] }. ' +
  'Quote clauses verbatim; leave a value null when the documents do not give it: the engine returns NULL, never a guess.';

const server = new McpServer({ name: 'laytime-engine', version: '0.1.0' });
const reply = (x: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(x, null, 1) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: String((e as Error)?.message ?? e) }] });

server.registerTool('laytime_check', {
  title: 'Check a laytime sheet',
  description: 'Checks a demurrage or despatch figure against every reading the charter party and SOF allow. Returns a verdict ' +
    '(agrees · reproduced · agrees-under-other-readings · differs · null), which readings reproduce the figure, the nearest cell when none does, ' +
    'the swing per disputed point, and a minute-by-minute ledger with the SOF line and clause behind each stretch of time. ' +
    'It computes; it does not decide which reading is right.',
  inputSchema: {
    case: z.record(z.string(), z.any()).describe(CASE_HELP),
    sheet: z.object({
      amount: z.number().nonnegative().describe('the figure on the sheet, positive'),
      kind: z.enum(['demurrage', 'despatch']),
      readings: z.record(z.string(), z.string()).optional().describe('point id → reading id the sheet takes, if known'),
      tolerance: z.number().nonnegative().optional().describe('currency units; default 0.01'),
      label: z.string().optional(),
    }),
  },
}, async ({ case: c, sheet }) => { try { return reply(checkSheet(caseFromJson(c), sheet)); } catch (e) { return fail(e); } });

server.registerTool('laytime_case', {
  title: 'Run a laytime case',
  description: 'Runs every combination of readings in a case: demurrage (+) or despatch (−) per cell, the range, and how far each ' +
    'disputed point moves the money. NULL cells say what the record is missing.',
  inputSchema: { case: z.record(z.string(), z.any()).describe(CASE_HELP) },
}, async ({ case: c }) => { try { return reply(runCase(caseFromJson(c))); } catch (e) { return fail(e); } });

await server.connect(new StdioServerTransport());
