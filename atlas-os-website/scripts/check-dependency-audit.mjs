import { spawnSync } from 'node:child_process';

const acceptedAdvisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const blocksBuild = (severity) => severity === 'high' || severity === 'critical';

export function assessAudit(report) {
  if (report?.error || report?.auditReportVersion !== 2 || !report.vulnerabilities ||
      typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) {
    throw new Error('npm did not return a valid dependency audit.');
  }

  const findings = new Map(Object.entries(report.vulnerabilities));
  const blocked = new Set();
  let accepted = false;
  for (const [name, finding] of findings) {
    if (!blocksBuild(finding?.severity)) continue;

    // npm also reports packages affected through dependencies. Resolve each
    // blocking finding to its underlying advisories, even through cycles.
    const pending = [name];
    const visited = new Set();
    let foundBlockingAdvisory = false;
    while (pending.length) {
      const dependency = pending.pop();
      if (visited.has(dependency)) continue;
      visited.add(dependency);
      const causes = findings.get(dependency)?.via;
      if (!Array.isArray(causes) || !causes.length) {
        throw new Error(`Missing audit details for ${dependency}.`);
      }

      for (const cause of causes) {
        if (typeof cause === 'string') {
          pending.push(cause);
          continue;
        }
        if (typeof cause?.url !== 'string' || typeof cause?.severity !== 'string') {
          throw new Error(`Invalid audit details for ${dependency}.`);
        }
        if (!blocksBuild(cause.severity)) continue;
        foundBlockingAdvisory = true;
        // The public deployment serves static output. Glob patterns used for
        // local development and builds come from source/configuration.
        // Remove this exception when the website lockfile can move to a fix.
        if (finding.severity === 'high' && dependency === 'picomatch' &&
            cause.name === 'picomatch' && cause.severity === 'high' &&
            cause.url === acceptedAdvisory) {
          accepted = true;
        } else {
          blocked.add(cause.url);
        }
      }
    }
    if (!foundBlockingAdvisory) throw new Error(`Missing blocking advisory for ${name}.`);
  }
  return { accepted, blocked: [...blocked] };
}

if (import.meta.main) {
  const result = spawnSync('npm', ['audit', '--json', '--audit-level=high'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === 'win32',
  });

  try {
    if (result.error || ![0, 1].includes(result.status)) {
      throw result.error ?? new Error(`npm audit exited with status ${result.status}.`);
    }
    const { accepted, blocked } = assessAudit(JSON.parse(result.stdout));
    if (result.status === 1 && !accepted && blocked.length === 0) {
      throw new Error('npm audit failed without reporting a blocking advisory.');
    }
    if (accepted) {
      console.warn(`::warning::Website build dependency picomatch remains affected by ${acceptedAdvisory}. The public site serves static assets.`);
    }
    for (const url of blocked) console.error(`Blocking dependency advisory: ${url}`);
    if (blocked.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (result.stderr) console.error(result.stderr.trim());
    process.exitCode = 1;
  }
}
