/**
 * Reproduction script for node-pty FD leak
 * 
 * Issue: Each PTY spawn leaks one /dev/ptmx file descriptor, even after the
 * child process exits. Eventually this leads to "posix_spawnp failed" errors.
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
  console.log('Spawning PTYs until we hit "posix_spawnp failed"...');
  console.log('');
  
  let i = 0;
  
  while (true) {
    i++;
    
    try {
      // Spawn a PTY that does some real work
      const p = pty.spawn('bash', ['-c', `
        echo "Hello from spawn ${i}"
        ls -la /tmp | head -3
        echo "Done"
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
      
      // This is what copilot-agent-runtime does in shutdown() - calls kill()
      try {
        p.kill();
      } catch (e) {
        // Process already dead, ignore
      }
      
      // Wait for internal cleanup
      await sleep(100);
      
      if (i % 50 === 0) {
        const ptmxFDs = getPtmxFDs();
        console.log(`Spawn ${i}: ${ptmxFDs.length} ptmx FDs leaked`);
      }
      
    } catch (err) {
      console.log('');
      console.log('=======================================');
      console.log(`❌ CRASHED at spawn ${i}`);
      console.log('=======================================');
      console.log(`Error: ${err.message}`);
      console.log('');
      
      const ptmxFDs = getPtmxFDs();
      console.log(`Leaked ptmx FDs at crash: ${ptmxFDs.length}`);
      console.log('');
      console.log('Leaked FDs:');
      ptmxFDs.slice(0, 20).forEach(line => console.log('  ' + line));
      if (ptmxFDs.length > 20) {
        console.log(`  ... and ${ptmxFDs.length - 20} more`);
      }
      
      console.log('');
      console.log('This reproduces the error from github/copilot-cli#677:');
      console.log('  "posix_spawnp failed"');
      break;
    }
  }
}

main().catch(console.error);
