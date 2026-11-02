import { observe } from './observe.ts';

type Outcome = 'done' | 'blocked' | 'not-finished' | 'uncertain';
type Message = { role: 'user' | 'assistant' | 'toolResult'; content: string; isError?: boolean };
type Fixture = { id: string; expected: Outcome; messages: Message[] };
type Decision = { outcome: Outcome; confidence: number; provider: string };

// Synthetic development examples, not a representative or held-out benchmark.
export const fixtures: readonly Fixture[] = [
 { id: 'done-files', expected: 'done', messages: [
  { role: 'user', content: 'Create a.txt with a and b.txt with b. Verify both.' },
  { role: 'toolResult', content: 'a.txt: a\nb.txt: b', isError: false },
  { role: 'assistant', content: 'Created and verified both files.' },
 ] },
 { id: 'done-explanation', expected: 'done', messages: [
  { role: 'user', content: 'Explain what an HTTP 404 response means in one sentence.' },
  { role: 'assistant', content: 'HTTP 404 means the server could not find the requested resource.' },
 ] },
 { id: 'blocked-approval', expected: 'blocked', messages: [
  { role: 'user', content: 'Ask for my approval before creating report.txt.' },
  { role: 'assistant', content: 'May I create report.txt? I will wait for your approval.' },
 ] },
 { id: 'blocked-credential', expected: 'blocked', messages: [
  { role: 'user', content: 'Deploy the app to the production account.' },
  { role: 'toolResult', content: 'Deployment failed: no production credential is configured.', isError: true },
  { role: 'assistant', content: 'Deployment is blocked until you provide access to the production account.' },
 ] },
 { id: 'unfinished-files', expected: 'not-finished', messages: [
  { role: 'user', content: 'Create a.txt with a and b.txt with b. Verify both.' },
  { role: 'toolResult', content: 'Created a.txt.', isError: false },
  { role: 'assistant', content: 'Created a.txt. I have not created or verified b.txt yet.' },
 ] },
 { id: 'unfinished-tests', expected: 'not-finished', messages: [
  { role: 'user', content: 'Fix the parser bug and run the test suite.' },
  { role: 'toolResult', content: 'Updated parser.ts.', isError: false },
  { role: 'assistant', content: 'I updated the parser. I still need to run the test suite.' },
 ] },
];

export type ReplayResult = { id: string; expected: Outcome; actual: Outcome; confidence: number; matches: boolean } | { id: string; expected: Outcome; error: true };
export async function replayCases(classify: (messages: readonly Message[]) => Promise<Decision> = observe): Promise<ReplayResult[]> {
 const results: ReplayResult[] = [];
 for (const fixture of fixtures) {
  try {
   // Only conversation evidence is submitted; case IDs and labels stay local.
   const decision = await classify(fixture.messages);
   results.push({ id: fixture.id, expected: fixture.expected, actual: decision.outcome, confidence: decision.confidence, matches: decision.outcome === fixture.expected });
  } catch {
   results.push({ id: fixture.id, expected: fixture.expected, error: true });
  }
 }
 return results;
}

export function formatReplay(results: readonly ReplayResult[]): string {
 const lines = results.map(result => 'error' in result
  ? `${result.id}: expected=${result.expected} error=classification_failed`
  : `${result.id}: expected=${result.expected} actual=${result.actual} confidence=${result.confidence} ${result.matches ? 'MATCH' : 'DISAGREEMENT'}`);
 const matches = results.filter(result => 'matches' in result && result.matches).length;
 const errors = results.filter(result => 'error' in result).length;
 return [...lines, `Summary: ${matches}/${results.length} matches; ${errors} errors. Synthetic development examples, not a calibrated benchmark.`].join('\n');
}
