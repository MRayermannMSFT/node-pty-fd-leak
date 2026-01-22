/**
 * Reproduction script for node-pty FD leak
 * 
 * Issue: Each PTY spawn leaks one /dev/ptmx file descriptor, even after the
 * child process exits. The internal socket cleanup happens, but the PTY master
 * FD is not being closed properly.
 * 
 * Run with: node repro.js
 */

const pty = require('node-pty');
const { execSync } = require('child_process');

function getLsofOutput() {
  try {
    const pid = process.pid;
    return execSync(`lsof -p ${pid} 2>/dev/null`, { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function getPtmxFDs() {
  const output = getLsofOutput();
  return output.split('\n').filter(line => line.includes('ptmx'));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('node-pty /dev/ptmx FD leak reproduction');
  console.log('=======================================');
  console.log(`PID: ${process.pid}`);
  console.log('');
  
  const ITERATIONS = 5;
  
  console.log('=== INITIAL STATE ===');
  const initialPtmx = getPtmxFDs();
  console.log(`ptmx FDs: ${initialPtmx.length}`);
  if (initialPtmx.length > 0) {
    initialPtmx.forEach(line => console.log('  ' + line));
  }
  console.log('');
  
  for (let i = 1; i <= ITERATIONS; i++) {
    console.log(`--- Spawn ${i} ---`);
    
    // Spawn a PTY that does some real work
    const p = pty.spawn('bash', ['-c', `
      echo "Hello from spawn ${i}"
      ls -la /tmp | head -5
      sleep 5
      echo "Done with spawn ${i}"
    `], {
      name: 'xterm-color',
      cols: 80,
      rows: 24
    });
    
    // Collect output
    let output = '';
    p.onData(data => { output += data; });
    
    // Wait for process to exit
    await new Promise(r => p.onExit(r));

    console.log('Output received:');
    console.log(output.split('\n').map(l => '  > ' + l).join('\n'));
    
    // This is what copilot-agent-runtime does in shutdown() - calls kill()
    try {
      p.kill();
    } catch (e) {
      // Process already dead, ignore
    }
    console.log('Process exited, kill() called');
    
    
    // Wait for internal cleanup (socket destroy timeout is 200ms)
    await sleep(500);
    
    const ptmxFDs = getPtmxFDs();
    console.log(`\nptmx FDs after spawn ${i}: ${ptmxFDs.length}`);
    ptmxFDs.forEach(line => console.log('  ' + line));
    console.log('');
    
    // Pause between spawns so output is readable
    await sleep(2000);
  }
  
  console.log('=======================================');
  console.log('FINAL STATE');
  console.log('=======================================');
  const finalPtmx = getPtmxFDs();
  console.log(`Total ptmx FDs leaked: ${finalPtmx.length}`);
  console.log('');
  console.log('Leaked FDs:');
  finalPtmx.forEach(line => console.log('  ' + line));
  
  if (finalPtmx.length > 0) {
    console.log('');
    console.log('❌ FD LEAK CONFIRMED');
    console.log('');
    console.log('Each spawn leaks 1 /dev/ptmx file descriptor.');
    console.log('Over time, this leads to: "posix_spawnp failed" errors');
  }
}

main().catch(console.error);
