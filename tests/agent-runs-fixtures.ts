/**
 * Synthetic cursor-agent stream-json events.
 *
 * Deliberately NOT copied from a real transcript: real ones carry internal
 * tracker keys, repo names and employer paths, which must never enter this
 * public repo. Each fixture reproduces the *structure* of a fact measured from
 * real data — see the "Data facts" table in the implementation plan — with
 * neutral placeholder content.
 */

/** Fact 2: system/init carries no timestamp_ms at all. */
export const INIT_NO_TS = {
  type: 'system',
  subtype: 'init',
  apiKeySource: 'login',
  cwd: '/home/dev/app',
  session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  model: 'Auto Cost',
  permissionMode: 'default',
}

/** Fact 2: user has no timestamp_ms either (the spec named only init and result). */
export const USER_NO_TS = {
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'text', text: '# PROJ-1 — add a health endpoint\n\nBranch: `feat/health`.' }],
  },
}

/** Fact 1: call_id is two ids joined by a newline; both phases carry the same one. */
export const CALL_ID_WITH_NEWLINE =
  'call_AbCdEf123456\nfc_02fa42882cc621fd016a7b96e5de488190bf990483f88d3952'

/** Fact 4 + 7: args carry a full shell AST to be dropped; startedAtMs is a string. */
export const SHELL_STARTED = {
  type: 'tool_call',
  subtype: 'started',
  call_id: CALL_ID_WITH_NEWLINE,
  tool_call: {
    shellToolCall: {
      args: {
        command: 'npm test',
        workingDirectory: '/home/dev/app',
        timeout: 30000,
        toolCallId: CALL_ID_WITH_NEWLINE,
        simpleCommands: ['npm'],
        parsingResult: {
          parsingFailed: false,
          executableCommands: [{ name: 'npm', args: [{ type: 'word', value: 'test' }], fullText: 'npm test' }],
        },
      },
      toolCallId: CALL_ID_WITH_NEWLINE,
      startedAtMs: '1700000003000',
    },
    hookAdditionalContexts: [],
  },
  session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  timestamp_ms: 1_700_000_003_000,
}

/** Fact 6: exitCode is an int, inside result.success. */
export const SHELL_COMPLETED_OK = {
  type: 'tool_call',
  subtype: 'completed',
  call_id: CALL_ID_WITH_NEWLINE,
  tool_call: {
    shellToolCall: {
      args: { command: 'npm test', workingDirectory: '/home/dev/app' },
      result: {
        success: {
          command: 'npm test', workingDirectory: '/home/dev/app',
          exitCode: 0, signal: '', stdout: '5 passing\n', stderr: '',
          executionTime: 1200, interleavedOutput: '5 passing\n',
        },
        isBackground: false,
      },
    },
  },
  timestamp_ms: 1_700_000_004_000,
}

export const SHELL_STARTED_FAILURE = {
  type: 'tool_call', subtype: 'started', call_id: 'call_FailCase0001\nfc_deadbeef',
  tool_call: { shellToolCall: { args: { command: 'npm run build' }, startedAtMs: '1700000004500' } },
  timestamp_ms: 1_700_000_004_500,
}

/**
 * Fact 3: failure is a SEPARATE discriminator carrying real stdout/stderr and
 * exitCode — not `success: <non-dict>`. The reference normalizer collapsed this
 * to an opaque blob and lost the diagnostics.
 */
export const SHELL_COMPLETED_FAILURE = {
  type: 'tool_call', subtype: 'completed', call_id: 'call_FailCase0001\nfc_deadbeef',
  tool_call: {
    shellToolCall: {
      args: { command: 'npm run build' },
      result: {
        failure: {
          command: 'npm run build', exitCode: 1, signal: '',
          stdout: '', stderr: 'error TS2304: Cannot find name "foo".\n',
          executionTime: 900,
        },
      },
    },
  },
  timestamp_ms: 1_700_000_005_000,
}

/** Fact 10: thinking arrives as deltas followed by a `completed` terminator. */
export const THINKING_DELTAS = [
  { type: 'thinking', subtype: 'delta', text: '**Reading** the ', timestamp_ms: 1_700_000_001_000 },
  { type: 'thinking', subtype: 'delta', text: 'router setup', timestamp_ms: 1_700_000_001_100 },
  { type: 'thinking', subtype: 'completed', timestamp_ms: 1_700_000_001_200 },
]

export const ASSISTANT_MD = {
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: '## Plan\n\n- read `router.ts`\n- **add** the route' }] },
  timestamp_ms: 1_700_000_002_000,
}

/** Fact 2 + 8: result carries no timestamp, and a run can contain several. */
export const RESULT_NO_TS = {
  type: 'result', subtype: 'success', duration_ms: 1_491_836, is_error: false,
  result: '## Done\n\nAdded `/health`. See PROJ-1.',
  session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  usage: { inputTokens: 10367, outputTokens: 3083, cacheReadTokens: 1_658_368 },
}

/** Fact 8: a resumed turn whose result body is empty. */
export const RESULT_EMPTY_BODY = {
  type: 'result', subtype: 'success', duration_ms: 4200, is_error: false,
  result: '', usage: { inputTokens: 10, outputTokens: 0 },
}

/** Fact 9: connection/retry chatter maps to kind 'other'. */
export const CONNECTION_EVENTS = [
  { type: 'connection', subtype: 'reconnecting', timestamp_ms: 1_700_000_009_000 },
  { type: 'retry', subtype: 'starting', timestamp_ms: 1_700_000_009_100 },
]
