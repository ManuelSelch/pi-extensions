import { formatReplay, replayCases } from './replay.ts';

if (process.argv.slice(2).join(' ') !== '--live') {
 console.error('Usage: node agentic-flow/jev/replay-cli.ts --live\nSends six synthetic fixtures to the configured Jev provider; this may incur costs.');
 process.exitCode = 2;
} else {
 console.error('Sending six synthetic fixtures to the configured Jev provider.');
 const results = await replayCases();
 console.log(formatReplay(results));
 if (results.some(result => 'error' in result)) process.exitCode = 1;
}
