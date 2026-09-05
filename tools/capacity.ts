/**
 * Capacity and unit-cost model.
 *
 * Answers the only question that decides whether KidPC can be sold at
 * Rs 149-399/month: how many subscribers fit on one server, and what does the
 * infrastructure therefore cost per subscriber?
 *
 * It reads the real sizing functions rather than restating them, so it cannot
 * drift from what the broker will actually ask a host for.
 *
 *   pnpm tsx tools/capacity.ts [subscribers]
 */
import { AGE_BANDS, type AgeBand, appsForBand, memoryBudgetMib } from '@kidpc/shared';
import { sizeForBand } from '@kidpc/broker';

// ---------------------------------------------------------------------------
// Demand assumptions. Every one of these is a guess to be replaced with a
// measurement from the pilot; they are collected here so it is obvious which
// number to argue about.
// ---------------------------------------------------------------------------
const ASSUMPTIONS = {
  /** Share of subscribers in each band. Skews young: the brief's entry price
   *  point is aimed at first-computer households. */
  bandMix: { explorer: 0.35, builder: 0.45, coder: 0.2 } as Record<AgeBand, number>,
  /** Fraction of subscribers who use it on a given day. */
  dailyActiveRate: 0.55,
  /** Minutes an active child actually spends, averaged. Bounded by the
   *  conservative default budgets (30/45/60). */
  minutesPerActiveDay: 38,
  /** Indian after-school reality: nearly all usage lands between 16:00 and
   *  21:00, so capacity is sized for that window, not for 24 hours. */
  peakWindowMinutes: 300,
  /** Peak hour carries more than its even share of that window. */
  peakBunching: 2.0,
  /** Fraction of a host's RAM available to sessions after the OS, the agent
   *  and page cache. */
  hostRamUsable: 0.85,
  /** Target utilisation at peak. Running a shared host at 100% means the first
   *  unlucky child gets OOM-killed mid-drawing. */
  targetUtilisation: 0.8,
  /** Average stream bandwidth for a child's workload -- drawing and Scratch,
   *  not video. Mbps. */
  streamMbps: 0.6,
  /** Sessions a child has per month. */
  sessionsPerMonth: 22,
} as const;

// ---------------------------------------------------------------------------
// Candidate hosts. Prices are INR/month, indicative only -- VERIFY before
// committing to anything. They are inputs, not findings.
// ---------------------------------------------------------------------------
interface Host {
  name: string;
  region: string;
  vcpu: number;
  ramGib: number;
  /** Indicative INR/month. */
  inr: number;
  /** Included egress in TB/month; Infinity where genuinely unmetered. */
  egressTb: number;
  /** Typical round-trip from an Indian metro, milliseconds. */
  rttMs: number;
}

const HOSTS: Host[] = [
  { name: 'Cloud VPS 8 vCPU / 16 GB', region: 'Mumbai', vcpu: 8, ramGib: 16, inr: 7000, egressTb: 5, rttMs: 25 },
  { name: 'Cloud VPS 16 vCPU / 32 GB', region: 'Mumbai', vcpu: 16, ramGib: 32, inr: 13500, egressTb: 8, rttMs: 25 },
  { name: 'Bare metal 32c / 128 GB', region: 'Mumbai/Delhi', vcpu: 32, ramGib: 128, inr: 32000, egressTb: 20, rttMs: 20 },
  { name: 'Bare metal 64c / 256 GB', region: 'Mumbai/Delhi', vcpu: 64, ramGib: 256, inr: 55000, egressTb: 30, rttMs: 20 },
  { name: 'EU budget bare metal (Hetzner-class)', region: 'Germany', vcpu: 32, ramGib: 128, inr: 9000, egressTb: 20, rttMs: 150 },
  { name: 'Hyperscaler 16 vCPU / 64 GB', region: 'ap-south-1', vcpu: 16, ramGib: 64, inr: 46000, egressTb: 0.1, rttMs: 20 },
];

/** Hyperscaler egress beyond the free tier, INR/GB. */
const OVERAGE_INR_PER_GB = 7.5;

// ---------------------------------------------------------------------------

function sessionFootprint(band: AgeBand) {
  const size = sizeForBand(band, memoryBudgetMib(appsForBand(band)));
  return { band, ...size, memoryGib: size.memoryMib / 1024 };
}

function weightedSessionGib(): number {
  return AGE_BANDS.reduce(
    (sum, band) => sum + ASSUMPTIONS.bandMix[band] * sessionFootprint(band).memoryGib,
    0,
  );
}

function peakConcurrency(subscribers: number): number {
  const activeDaily = subscribers * ASSUMPTIONS.dailyActiveRate;
  const evenlySpread = (activeDaily * ASSUMPTIONS.minutesPerActiveDay) / ASSUMPTIONS.peakWindowMinutes;
  return evenlySpread * ASSUMPTIONS.peakBunching;
}

function egressGibPerSubscriberMonth(): number {
  const minutesPerMonth = ASSUMPTIONS.minutesPerActiveDay * ASSUMPTIONS.sessionsPerMonth;
  const megabits = ASSUMPTIONS.streamMbps * 60 * minutesPerMonth;
  return megabits / 8 / 1024;
}

const inr = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;
const pad = (s: string | number, w: number) => String(s).padEnd(w);
const rpad = (s: string | number, w: number) => String(s).padStart(w);

const subscribers = Number(process.argv[2] ?? 5000);

console.log('\n=== Per-session footprint (from the code, not from a spreadsheet) ===\n');
console.log(`  ${pad('band', 10)}${rpad('vCPU cap', 10)}${rpad('RAM', 10)}   apps offered`);
for (const band of AGE_BANDS) {
  const f = sessionFootprint(band);
  console.log(
    `  ${pad(band, 10)}${rpad((f.cpuCentis / 100).toFixed(1), 10)}${rpad(`${f.memoryGib.toFixed(2)} GiB`, 10)}   ${appsForBand(band).length}`,
  );
}
console.log(`\n  Blended, at the assumed band mix: ${weightedSessionGib().toFixed(2)} GiB/session`);
console.log('  RAM is the binding constraint. The vCPU figure is a ceiling, not a');
console.log('  reservation -- children idle between clicks, so cores oversubscribe well');
console.log('  while memory does not.');

const concurrent = peakConcurrency(subscribers);
const ramNeeded = concurrent * weightedSessionGib();
const egressPerSub = egressGibPerSubscriberMonth();

console.log(`\n=== Demand at ${subscribers.toLocaleString('en-IN')} subscribers ===\n`);
console.log(`  Daily actives                ${Math.round(subscribers * ASSUMPTIONS.dailyActiveRate).toLocaleString('en-IN')}`);
console.log(`  Peak concurrent sessions     ${Math.round(concurrent).toLocaleString('en-IN')}  (${((concurrent / subscribers) * 100).toFixed(1)}% of subscribers)`);
console.log(`  Session RAM at peak          ${Math.round(ramNeeded).toLocaleString('en-IN')} GiB`);
console.log(`  Egress per subscriber        ${egressPerSub.toFixed(1)} GiB/month`);
console.log(`  Egress total                 ${Math.round((egressPerSub * subscribers) / 1024).toLocaleString('en-IN')} TiB/month`);

console.log('\n=== Cost per subscriber per month ===\n');
console.log(
  `  ${pad('host', 38)}${rpad('sess/host', 11)}${rpad('hosts', 7)}${rpad("compute", 14)}${rpad('egress', 12)}${rpad('total/sub', 11)}  RTT`,
);
console.log('  ' + '-'.repeat(100));

for (const host of HOSTS) {
  const usableGib = host.ramGib * ASSUMPTIONS.hostRamUsable * ASSUMPTIONS.targetUtilisation;
  const sessionsPerHost = Math.floor(usableGib / weightedSessionGib());
  const hosts = Math.max(1, Math.ceil(concurrent / sessionsPerHost));
  const compute = hosts * host.inr;

  const totalEgressTb = (egressPerSub * subscribers) / 1024;
  const includedTb = host.egressTb * hosts;
  const overageGb = Math.max(0, (totalEgressTb - includedTb) * 1024);
  const egressCost = overageGb * OVERAGE_INR_PER_GB;

  const perSub = (compute + egressCost) / subscribers;
  const viable = host.rttMs <= 80;

  console.log(
    `  ${pad(host.name, 38)}${rpad(sessionsPerHost, 11)}${rpad(hosts, 7)}${rpad(inr(compute), 14)}${rpad(egressCost > 0 ? inr(egressCost) : '-', 12)}${rpad(inr(perSub), 11)}  ${host.rttMs}ms${viable ? '' : '  <- unusable'}`,
  );
}

console.log('\n  Plan prices for reference: Starter Rs 149-199, Family Rs 349-399.');
console.log('  Infrastructure should sit under ~25% of revenue to leave room for');
console.log('  payments, support, content and acquisition.\n');

console.log('=== What breaks the model ===\n');
console.log('  Latency  A desktop is interactive. Above roughly 80ms round-trip, drawing');
console.log('           and typing feel broken, and the product is the responsiveness.');
console.log('           Cheap EU bare metal is ~150ms from India: the per-subscriber cost');
console.log('           looks excellent and the service is unusable. Not a trade-off.');
console.log('  Egress   Metered egress at hyperscaler rates costs more than the compute.');
console.log(`           At ${egressPerSub.toFixed(1)} GiB/subscriber/month, ${inr(egressPerSub * OVERAGE_INR_PER_GB)}/subscriber goes to bandwidth`);
console.log('           alone -- a large share of a Rs 199 plan, before a single core.');
console.log('  Idle     Every minute a desktop stays up after a child leaves is pure loss.');
console.log(`           The reaper's idle timeout is the single highest-leverage number`);
console.log('           in the system for gross margin.\n');
