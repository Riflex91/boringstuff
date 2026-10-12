import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { triageSupplySample, repeatedSupplyObservations } from
  './consumer-supply-triage.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const base={
  consumers:{critical:2},
  haulers:{live:3,readyByGuardRule:2},
  reservationCoverage:{
    criticalWithSticky:1,criticalWithReadySticky:1,
    criticalWithoutSticky:1,criticalWithoutReadySticky:1,
    criticalWithDuplicateSticky:0,stickyWithoutEnergy:0,
    readyHaulersWithoutSticky:1,acceptedDeliveryProof:false
  }
};
const old=JSON.stringify(base);
const current=triageSupplySample(base);
assert.equal(current.classification,'CRITICAL_COVERAGE_GAP_OBSERVED');
assert.deepEqual(current.reasonCodes,[
  'READY_HAULER_WITHOUT_CRITICAL_ASSIGNMENT',
  'CRITICAL_READY_COVERAGE_GAP'
]);
assert.equal(current.uncoveredCriticalCount,1);
assert.equal(current.causalProof,false);
assert.equal(current.settledDeliveryProof,false);
assert.equal(current.actionAuthority,'NONE');
assert.equal(JSON.stringify(base),old,'Offline classifier is immutable');

const noCritical=triageSupplySample({
  ...base,consumers:{critical:0}
});
assert.equal(noCritical.classification,'NO_CRITICAL_AT_SAMPLE');
const unknown=triageSupplySample({...base,reservationCoverage:null});
assert.equal(unknown.classification,'UNKNOWN');
assert.equal(unknown.evidenceReason,'RESERVATION_COVERAGE_NOT_OBSERVED');
const inconsistent=triageSupplySample({
  ...base,reservationCoverage:{...base.reservationCoverage,
    criticalWithReadySticky:2}
});
assert.equal(inconsistent.classification,'UNKNOWN');
const allReady=triageSupplySample({
  ...base,reservationCoverage:{...base.reservationCoverage,
    criticalWithSticky:2,criticalWithReadySticky:2,
    criticalWithoutSticky:0,criticalWithoutReadySticky:0,
    readyHaulersWithoutSticky:0}
});
assert.equal(allReady.classification,'READY_STICKY_COVERAGE_OBSERVED');
assert.deepEqual(allReady.reasonCodes,[]);
assert.equal(allReady.settledDeliveryProof,false,
  'Ready assignment is not actual energy settlement');
const stickyNotReady=triageSupplySample({
  ...base,haulers:{live:3,readyByGuardRule:0},
  reservationCoverage:{...base.reservationCoverage,
    criticalWithReadySticky:0,criticalWithoutReadySticky:2,
    stickyWithoutEnergy:1,criticalWithDuplicateSticky:1,
    readyHaulersWithoutSticky:0}
});
assert.deepEqual(stickyNotReady.reasonCodes,[
  'DUPLICATE_STICKY_TARGET',
  'EMPTY_ENERGY_STICKY',
  'STICKY_NOT_DELIVERY_READY',
  'NO_READY_HAULERS',
  'CRITICAL_READY_COVERAGE_GAP'
]);

function sample(tick, input=base) {
  return {tick, ...structuredClone(input),triage:triageSupplySample(input)};
}
const a=[
  sample(100),sample(125),sample(150),sample(175),
  sample(225),sample(250),sample(275),sample(325)
];
const before=JSON.stringify(a);
const patterns=repeatedSupplyObservations(a);
assert.deepEqual(patterns,[
  {reasonCode:'READY_HAULER_WITHOUT_CRITICAL_ASSIGNMENT',
    startTick:100,endTick:175,sampleCount:4,
    maximumUncoveredCritical:1,
    classification:'REPEATED_ASSOCIATION_NOT_CAUSAL',
    actionAuthority:'NONE',causalProof:false,settledDeliveryProof:false},
  {reasonCode:'READY_HAULER_WITHOUT_CRITICAL_ASSIGNMENT',
    startTick:225,endTick:275,sampleCount:3,
    maximumUncoveredCritical:1,
    classification:'REPEATED_ASSOCIATION_NOT_CAUSAL',
    actionAuthority:'NONE',causalProof:false,settledDeliveryProof:false}
]);
assert.deepEqual(repeatedSupplyObservations([...a].reverse()),patterns,
  'Journal order must not matter to repeated-association detection');
assert.equal(JSON.stringify(a),before,'No mutation of observed samples');
assert.deepEqual(repeatedSupplyObservations([sample(100),sample(125)]),[]);
assert.deepEqual(repeatedSupplyObservations([
  sample(100),sample(125),
  sample(150,{...base,reservationCoverage:null}),
  sample(175),sample(200),sample(225)
]),[{...patterns[1],startTick:175,endTick:225}],
'An UNKNOWN sample breaks continuity; no guessing across the gap');
assert.deepEqual(repeatedSupplyObservations([
  sample(100),sample(125),
  sample(150,{...base,consumers:{critical:0}}),
  sample(175)
]),[],'No-critical samples terminate a gap run');
assert.deepEqual(repeatedSupplyObservations([
  sample(100),sample(125),sample(151),sample(175)
]),[],'Noncontiguous ticks cannot produce repeated evidence');

const source=fs.readFileSync(path.join(dir,'consumer-supply-triage.mjs'),'utf8');
for(const pattern of [
  /Memory\s*\./,/\.spawnCreep\s*\(/,/\.moveTo\s*\(/,
  /\.transfer\s*\(/,/\.reserve\s*\(/,/\.attack\s*\(/
]) assert.equal(pattern.test(source),false,'Triage must be pure/offline');
const analyzer=fs.readFileSync(path.join(dir,'consumer-supply-analysis-core.mjs'),'utf8');
assert.ok(analyzer.includes('triageSupplySample(s)'));
assert.ok(analyzer.includes('repeatedSupplyObservations(samples)'));
console.log('E4 noncausal supply triage and consecutive evidence regressions PASS');
