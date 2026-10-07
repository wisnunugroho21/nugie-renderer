import { describe, expect, it } from 'vitest';
import { AnimationClip, AnimationChannel } from '../src/animation/AnimationClip';
import { Pose, PoseLayout } from '../src/animation/Pose';
import { AnimationParams, evaluateCondition } from '../src/animation/graph/AnimationParams';
import { BlendTree1D, ClipMotion, RootDelta, type MotionContext } from '../src/animation/graph/Motion';
import { StateMachine, type StateDef, type TransitionDef } from '../src/animation/graph/StateMachine';
import { AnimationController } from '../src/animation/graph/AnimationController';
import { applyRootMotionPolicy } from '../src/animation/RootMotion';
import { buildBoneMask, buildMorphMask } from '../src/animation/PoseOps';
import { Quat } from '../src/math/Quat';

const f32 = (...v: number[]) => Float32Array.from(v);
const close = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5) => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps); };
const yaw = (a: number) => Quat.fromAxisAngle(Quat.create(), 0, 1, 0, a);

/** 3-node rig: 0 root (hip), 1 spine (child of 0), 2 arm (child of 1). Node 2 owns 2 morph weights. */
const layout = () => new PoseLayout(3, [0, 0, 2], [-1, 0, 1]);

/** Clip moving node `node` along +X from `from` to `to` over `duration` (LINEAR). */
function moveClip(name: string, node: number, from: number, to: number, duration = 1): AnimationClip {
  return new AnimationClip(name, [new AnimationChannel(node, 'translation', 'LINEAR', f32(0, duration), f32(from, 0, 0, to, 0, 0), 3)]);
}

function setup(states: (l: PoseLayout) => StateDef[], transitions: TransitionDef[], paramsSetup?: (p: AnimationParams) => void) {
  const l = layout(), rest = new Pose(l), params = new AnimationParams();
  paramsSetup?.(params);
  const sm = new StateMachine(l, rest, states(l), transitions, 0);
  const ctx: MotionContext = { layout: l, rest, params, rootNode: 0 };
  const out = new Pose(l), root = new RootDelta();
  const step = (dt: number) => { sm.update(dt, ctx, out, root); return out.t[3]; }; // node 1 x
  return { l, rest, params, sm, ctx, out, root, step };
}

describe('AnimationParams', () => {
  it('typed parameters, name or id access', () => {
    const p = new AnimationParams();
    const speed = p.define('speed', 'float', 1.5), jump = p.define('jump', 'trigger'), grounded = p.define('grounded', 'bool', 1), n = p.define('count', 'int');
    expect(p.get('speed')).toBe(1.5);
    p.setInt('count', 3.9); expect(p.get(n)).toBe(3);
    p.setBool(grounded, false); expect(p.get('grounded')).toBe(0);
    p.trigger(jump); expect(p.get('jump')).toBe(1);
    p.setFloat(speed, 2); expect(p.get(speed)).toBe(2);
    expect(() => p.id('nope')).toThrow(); expect(() => p.define('speed', 'float')).toThrow();
  });
  it('condition operators', () => {
    const p = new AnimationParams(); const f = p.define('f', 'float', 2), b = p.define('b', 'bool', 1);
    expect([evaluateCondition({ param: f, op: 'gt', value: 1 }, p), evaluateCondition({ param: f, op: 'lt', value: 1 }, p), evaluateCondition({ param: f, op: 'ge', value: 2 }, p),
      evaluateCondition({ param: f, op: 'le', value: 1 }, p), evaluateCondition({ param: f, op: 'eq', value: 2 }, p), evaluateCondition({ param: f, op: 'ne', value: 2 }, p),
      evaluateCondition({ param: b, op: 'true' }, p), evaluateCondition({ param: b, op: 'false' }, p)]).toEqual([true, false, true, false, true, false, true, false]);
  });
});

describe('BlendTree1D', () => {
  it('blends the two bracketing clips by the parameter and clamps outside the range', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const sp = params.define('speed', 'float');
    const tree = new BlendTree1D(l, sp, [
      { threshold: 0, motion: new ClipMotion(moveClip('idle', 1, 0, 0)) },
      { threshold: 1, motion: new ClipMotion(moveClip('walk', 1, 10, 10)) },
      { threshold: 3, motion: new ClipMotion(moveClip('run', 1, 40, 40)) },
    ]);
    const ctx: MotionContext = { layout: l, rest, params, rootNode: 0 };
    const out = new Pose(l);
    const at = (v: number) => { params.setFloat(sp, v); tree.sample(ctx, 0.3, out); return out.t[3]; };
    expect(at(-5)).toBeCloseTo(0); expect(at(0.5)).toBeCloseTo(5); expect(at(1)).toBeCloseTo(10); expect(at(2)).toBeCloseTo(25); expect(at(9)).toBeCloseTo(40);
  });
  it('duration is the weighted average of the bracketing clips (keeps foot phase when blending)', () => {
    const l = layout(), params = new AnimationParams(); const sp = params.define('speed', 'float');
    const tree = new BlendTree1D(l, sp, [
      { threshold: 0, motion: new ClipMotion(moveClip('a', 1, 0, 1, 2)) }, { threshold: 1, motion: new ClipMotion(moveClip('b', 1, 0, 1, 1)) },
    ]);
    params.setFloat(sp, 0.5); expect(tree.duration(params)).toBeCloseTo(1.5);
    params.setFloat(sp, 0); expect(tree.duration(params)).toBeCloseTo(2);
  });
  it('trees can be nested', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const a = params.define('a', 'float'), b = params.define('b', 'float');
    const inner = new BlendTree1D(l, b, [{ threshold: 0, motion: new ClipMotion(moveClip('x', 1, 0, 0)) }, { threshold: 1, motion: new ClipMotion(moveClip('y', 1, 10, 10)) }]);
    const outer = new BlendTree1D(l, a, [{ threshold: 0, motion: inner }, { threshold: 1, motion: new ClipMotion(moveClip('z', 1, 100, 100)) }]);
    const out = new Pose(l), ctx: MotionContext = { layout: l, rest, params, rootNode: 0 };
    params.setFloat(b, 0.5); params.setFloat(a, 0.5); outer.sample(ctx, 0, out);
    expect(out.t[3]).toBeCloseTo((5 + 100) / 2);
  });
  it('requires at least one entry', () => { expect(() => new BlendTree1D(layout(), 0, [])).toThrow(); });
  it('collects every node any child can write', () => {
    const l = layout();
    const tree = new BlendTree1D(l, 0, [{ threshold: 0, motion: new ClipMotion(moveClip('a', 1, 0, 1)) }, { threshold: 1, motion: new ClipMotion(moveClip('b', 2, 0, 1)) }]);
    const s = new Set<number>(); tree.collectNodes(s);
    expect(Array.from(s).sort()).toEqual([1, 2]);
  });
});

describe('StateMachine', () => {
  const states = () => [
    { name: 'A', motion: new ClipMotion(moveClip('A', 1, 0, 0)) },
    { name: 'B', motion: new ClipMotion(moveClip('B', 1, 10, 10)) },
  ];

  it('stays in the entry state until a condition holds, then switches immediately (duration 0)', () => {
    const t = setup(states, [{ from: 0, to: 1, conditions: [{ param: 0, op: 'true' }] }], (p) => { p.define('go', 'bool'); });
    expect(t.step(0.1)).toBeCloseTo(0); expect(t.sm.currentName).toBe('A');
    t.params.setBool('go', true);
    expect(t.step(0.1)).toBeCloseTo(10); expect(t.sm.currentName).toBe('B');
    expect(t.sm.transitioning).toBe(false);
  });

  it('crossfade is continuous: starts at A, ends at B, strictly monotonic, no jump larger than the slope allows', () => {
    const t = setup(states, [{ from: 0, to: 1, duration: 0.5, conditions: [{ param: 0, op: 'true' }] }], (p) => { p.define('go', 'bool'); });
    t.step(0.1); t.params.setBool('go', true);
    const vals: number[] = [];
    for (let i = 0; i < 8; i++) vals.push(t.step(0.1));
    expect(vals[0]).toBeGreaterThanOrEqual(0); expect(vals[0]).toBeLessThan(2);   // first frame barely started
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1] - 1e-9);
    expect(vals[vals.length - 1]).toBeCloseTo(10);
    for (let i = 1; i < 6; i++) expect(Math.abs(vals[i] - vals[i - 1])).toBeLessThan(4.5); // smooth, no pop
    expect(t.sm.transitionsCompleted).toBe(1);
  });

  it('is deterministic: identical inputs give bit-identical outputs', () => {
    const run = () => {
      const t = setup(states, [{ from: 0, to: 1, duration: 0.3, conditions: [{ param: 0, op: 'true' }] }, { from: 1, to: 0, duration: 0.2, conditions: [{ param: 0, op: 'false' }] }],
        (p) => { p.define('go', 'bool'); });
      const out: number[] = [];
      for (let i = 0; i < 60; i++) { t.params.setBool('go', i % 17 < 8); out.push(t.step(1 / 60)); }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('triggers are latched, consumed by the firing transition, and fire only once', () => {
    const t = setup(states, [{ from: 0, to: 1, conditions: [{ param: 0, op: 'trigger' }] }, { from: 1, to: 0, conditions: [{ param: 0, op: 'trigger' }] }], (p) => { p.define('t', 'trigger'); });
    t.step(0.1); expect(t.sm.currentName).toBe('A');
    t.params.trigger('t');
    t.step(0.1); expect(t.sm.currentName).toBe('B');
    expect(t.params.get('t')).toBe(0);                 // consumed
    t.step(0.1); t.step(0.1); expect(t.sm.currentName).toBe('B');   // did NOT bounce back via the second transition
    t.params.trigger('t'); t.step(0.1); expect(t.sm.currentName).toBe('A');
  });

  it('exitTime waits until the state reached that normalized time', () => {
    const t = setup(states, [{ from: 0, to: 1, exitTime: 1, conditions: [] }]);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) { t.step(0.1); seen.push(t.sm.currentName); }
    expect(seen[7]).toBe('A');                          // 0.8 normalized (duration 1)
    expect(seen[11]).toBe('B');
  });

  it('"any state" transitions fire from every state but never into the current one', () => {
    const t = setup(() => [...states(), { name: 'C', motion: new ClipMotion(moveClip('C', 1, 77, 77)) }],
      [{ from: -1, to: 2, conditions: [{ param: 0, op: 'true' }] }], (p) => { p.define('panic', 'bool'); });
    t.step(0.1); t.params.setBool('panic', true); t.step(0.1);
    expect(t.sm.currentName).toBe('C'); expect(t.out.t[3]).toBeCloseTo(77);
    t.step(0.1); expect(t.sm.currentName).toBe('C');    // stays (no self transition loop)
  });

  it('interrupting a crossfade fades from what is on screen: no pop at the interrupt frame', () => {
    const l = layout();
    const t = setup(() => [...states(), { name: 'C', motion: new ClipMotion(moveClip('C', 1, 100, 100)) }],
      [{ from: 0, to: 1, duration: 1, conditions: [{ param: 0, op: 'true' }] }, { from: 1, to: 2, duration: 1, conditions: [{ param: 1, op: 'true' }] }],
      (p) => { p.define('toB', 'bool'); p.define('toC', 'bool'); });
    void l;
    t.params.setBool('toB', true);
    let prev = 0;
    for (let i = 0; i < 5; i++) prev = t.step(0.1);     // mid blend A->B (0..10)
    const before = prev;
    t.params.setBool('toC', true);
    const after = t.step(0.1);                          // interrupt: must continue from ~`before`
    expect(Math.abs(after - before)).toBeLessThan(5);   // a pop would jump toward 10 or 100 instantly
    let last = after;
    for (let i = 0; i < 12; i++) last = t.step(0.1);
    expect(last).toBeCloseTo(100);
    expect(t.sm.currentName).toBe('C');
  });

  it('non-interruptible transitions cannot be interrupted', () => {
    const t = setup(() => [...states(), { name: 'C', motion: new ClipMotion(moveClip('C', 1, 100, 100)) }],
      [{ from: 0, to: 1, duration: 1, interruptible: false, conditions: [{ param: 0, op: 'true' }] }, { from: 1, to: 2, conditions: [{ param: 1, op: 'true' }] }],
      (p) => { p.define('toB', 'bool'); p.define('toC', 'bool'); });
    t.params.setBool('toB', true); t.step(0.1); t.params.setBool('toC', true); t.step(0.1);
    expect(t.sm.to).toBe(1);                            // still heading to B
    for (let i = 0; i < 12; i++) t.step(0.1);
    expect(t.sm.currentName).toBe('C');                 // after B completed, the next transition fired
  });

  it('non-looping states clamp at the end; looping states wrap', () => {
    const t = setup(() => [{ name: 'once', motion: new ClipMotion(moveClip('m', 1, 0, 10)), loop: false }], []);
    for (let i = 0; i < 15; i++) t.step(0.1);
    expect(t.sm.time).toBe(1); expect(t.out.t[3]).toBeCloseTo(10);
    const l = setup(() => [{ name: 'loop', motion: new ClipMotion(moveClip('m', 1, 0, 10)) }], []);
    for (let i = 0; i < 15; i++) l.step(0.1);
    expect(l.sm.time).toBeCloseTo(0.5, 5);
  });

  it('speed scales playback; speedParam scales further; negative speed plays backwards', () => {
    const fast = setup(() => [{ name: 's', motion: new ClipMotion(moveClip('m', 1, 0, 10)), speed: 2 }], []);
    fast.step(0.25); expect(fast.sm.time).toBeCloseTo(0.5);
    const p = setup(() => [{ name: 's', motion: new ClipMotion(moveClip('m', 1, 0, 10)), speedParam: 0 }], [], (pp) => { pp.define('mult', 'float', 3); });
    p.step(0.1); expect(p.sm.time).toBeCloseTo(0.3);
    const rev = setup(() => [{ name: 's', motion: new ClipMotion(moveClip('m', 1, 0, 10)), speed: -1 }], []);
    rev.step(0.1); expect(rev.sm.time).toBeCloseTo(0.9);   // wrapped backwards from 0
  });

  it('transition offset starts the target mid-clip', () => {
    const t = setup(states, [{ from: 0, to: 1, offset: 0.4, conditions: [] }]);
    t.step(0);
    expect(t.sm.time).toBeCloseTo(0.4);
  });
});

describe('root motion', () => {
  /** root node 0 translates +10 in X over 1s and yaws 90deg over 1s (linear); clip is looping. */
  const walkClip = () => new AnimationClip('walk', [
    new AnimationChannel(0, 'translation', 'LINEAR', f32(0, 1), f32(0, 0.9, 0, 10, 0.9, 5), 3),
    new AnimationChannel(0, 'rotation', 'LINEAR', f32(0, 1), Float32Array.from([...yaw(0), ...yaw(Math.PI / 2)]), 4),
  ]);
  function controller(mode: 'disabled' | 'translation' | 'rotation' | 'both', extra: Partial<{ axes: { x: boolean; y: boolean; z: boolean }; rotation: 'yaw' | 'full' }> = {}) {
    const l = layout(), rest = new Pose(l); rest.t.set([0, 0.5, 0], 0);
    const params = new AnimationParams();
    const sm = new StateMachine(l, rest, [{ name: 'walk', motion: new ClipMotion(walkClip()) }], [], 0);
    const c = new AnimationController(l, rest, params, [{ name: 'base', stateMachine: sm }], 0);
    c.rootMotion = { mode, ...extra };
    return c;
  }

  it('disabled: the skeleton carries the motion and the entity receives nothing', () => {
    const c = controller('disabled');
    c.update(0.5);
    expect(Array.from(c.rootDelta.t)).toEqual([0, 0, 0]);
    expect(c.pose.t[0]).toBeCloseTo(5);
  });

  it('translation: delta goes to the entity and the root bone is neutralized on those axes (never applied twice)', () => {
    const c = controller('translation');
    c.update(0.5);
    close(c.rootDelta.t, [5, 0, 2.5]);                 // x and z extracted, y not (default axes)
    expect(c.pose.t[0]).toBeCloseTo(0);                // x reset to rest
    expect(c.pose.t[2]).toBeCloseTo(0);                // z reset to rest
    expect(c.pose.t[1]).toBeCloseTo(0.9);              // y stays animated in the pose (hip height)
  });

  it('axis filtering', () => {
    const c = controller('translation', { axes: { x: true, y: false, z: false } });
    c.update(0.5);
    close(c.rootDelta.t, [5, 0, 0]);
    expect(c.pose.t[2]).toBeCloseTo(2.5);              // z not extracted => skeleton keeps it
  });

  it('displacement accumulated over loops equals total clip travel per loop (no loss at the wrap)', () => {
    const c = controller('translation');
    let sum = 0;
    for (let i = 0; i < 25; i++) { c.update(0.2); sum += c.rootDelta.t[0]; }   // 5 s = 5 loops
    expect(sum).toBeCloseTo(50, 3);
  });

  it('rotation: yaw delta extracted, pose root yaw neutralized, tilt (swing) preserved', () => {
    const c = controller('rotation');
    c.update(0.5);
    // extracted yaw ~ 45deg
    const q = c.rootDelta.r;
    expect(2 * Math.atan2(q[1], q[3])).toBeCloseTo(Math.PI / 4, 3);
    // skeleton root rotation back to rest (identity) => no residual yaw
    close(c.pose.r.subarray(0, 4), [0, 0, 0, 1], 1e-4);
    // translation untouched in 'rotation' mode
    expect(c.pose.t[0]).toBeCloseTo(5);
  });

  it('both: extracts translation AND yaw', () => {
    const c = controller('both');
    c.update(0.5);
    close(c.rootDelta.t, [5, 0, 2.5]);
    expect(2 * Math.atan2(c.rootDelta.r[1], c.rootDelta.r[3])).toBeCloseTo(Math.PI / 4, 3);
  });

  it('works through blended transitions: root delta is the weighted blend of both states', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const go = params.define('go', 'bool');
    const slow = new AnimationClip('slow', [new AnimationChannel(0, 'translation', 'LINEAR', f32(0, 1), f32(0, 0, 0, 2, 0, 0), 3)]);
    const fast = new AnimationClip('fast', [new AnimationChannel(0, 'translation', 'LINEAR', f32(0, 1), f32(0, 0, 0, 10, 0, 0), 3)]);
    const sm = new StateMachine(l, rest, [{ name: 'slow', motion: new ClipMotion(slow) }, { name: 'fast', motion: new ClipMotion(fast) }],
      [{ from: 0, to: 1, duration: 1, conditions: [{ param: go, op: 'true' }] }], 0);
    const c = new AnimationController(l, rest, params, [{ name: 'base', stateMachine: sm }], 0);
    c.rootMotion = { mode: 'translation' };
    c.update(0.1);
    expect(c.rootDelta.t[0]).toBeCloseTo(0.2, 4);                        // only 'slow' so far
    params.setBool(go, true);
    c.update(0.5);                                                        // halfway through a 1s smooth blend (w = 0.5 at the end of this step)
    const mid = c.rootDelta.t[0];
    expect(mid).toBeGreaterThan(1.0); expect(mid).toBeLessThan(5.0);        // strictly between slow (2*0.5 = 1) and fast (10*0.5 = 5)
    expect(mid).toBeCloseTo(3, 3);                                          // smoothstep(0.5) = 0.5 => the exact midpoint
  });

  it('reverse playback produces the inverse displacement', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const sm = new StateMachine(l, rest, [{ name: 'back', motion: new ClipMotion(moveClip('m', 0, 0, 10)), speed: -1 }], [], 0);
    const c = new AnimationController(l, rest, params, [{ name: 'base', stateMachine: sm }], 0);
    c.rootMotion = { mode: 'translation' };
    c.update(0.1);                                                        // wraps from 0 to 0.9 going backwards
    expect(c.rootDelta.t[0]).toBeCloseTo(-1, 4);
  });

  it('policy function: disabled leaves pose untouched and output zero', () => {
    const l = layout(), rest = new Pose(l), pose = new Pose(l), d = new RootDelta(), out = new RootDelta();
    pose.t.set([3, 3, 3], 0); d.t.set([1, 2, 3]);
    applyRootMotionPolicy({ mode: 'disabled' }, rest, 0, pose, d, out);
    expect(Array.from(out.t)).toEqual([0, 0, 0]); expect(Array.from(pose.t.subarray(0, 3))).toEqual([3, 3, 3]);
  });
});

describe('layers and masks', () => {
  /** states hold a constant translation per node so layer results are easy to read. */
  function constClip(name: string, vals: Record<number, number>): AnimationClip {
    return new AnimationClip(name, Object.entries(vals).map(([n, x]) => new AnimationChannel(Number(n), 'translation', 'LINEAR', f32(0, 1), f32(x, 0, 0, x, 0, 0), 3)));
  }
  const mk = (clip: AnimationClip, l: PoseLayout, rest: Pose) => new StateMachine(l, rest, [{ name: clip.name, motion: new ClipMotion(clip) }], [], 0);

  it('override layer with a bone mask only affects the masked subtree (upper body)', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const base = mk(constClip('loco', { 0: 1, 1: 2, 2: 3 }), l, rest), aim = mk(constClip('aim', { 0: 100, 1: 200, 2: 300 }), l, rest);
    const c = new AnimationController(l, rest, params, [{ name: 'base', stateMachine: base }, { name: 'upper', stateMachine: aim, mask: buildBoneMask(l, [1]) }], -1);
    c.update(0.1);
    expect([c.pose.t[0], c.pose.t[3], c.pose.t[6]]).toEqual([1, 200, 300]);
  });

  it('layer weight scales the override; weight 0 disables the layer', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const base = mk(constClip('loco', { 1: 10 }), l, rest), over = mk(constClip('o', { 1: 20 }), l, rest);
    const c = new AnimationController(l, rest, params, [{ name: 'base', stateMachine: base }, { name: 'o', stateMachine: over, weight: 0.5 }], -1);
    c.update(0.1); expect(c.pose.t[3]).toBeCloseTo(15);
    c.setLayerWeight(1, 0); c.update(0.1); expect(c.pose.t[3]).toBeCloseTo(10);
    c.setLayerWeight(1, 1); c.update(0.1); expect(c.pose.t[3]).toBeCloseTo(20);
  });

  it('additive layer (hit reaction) adds its deviation from the reference, on a subset of bones', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const base = mk(constClip('loco', { 1: 10, 2: 5 }), l, rest);
    const hit = mk(constClip('hit', { 1: 3, 2: 4 }), l, rest);     // reference = rest (0) => adds +3 / +4
    const c = new AnimationController(l, rest, params, [
      { name: 'base', stateMachine: base },
      { name: 'hit', stateMachine: hit, mode: 'additive', mask: buildBoneMask(l, [2], { descendants: false }), weight: 1 },
    ], -1);
    c.update(0.1);
    expect(c.pose.t[3]).toBeCloseTo(10);      // spine unmasked
    expect(c.pose.t[6]).toBeCloseTo(9);       // arm: 5 + 4
  });

  it('facial layer: a morph mask changes only morph weights', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const base = mk(constClip('loco', { 1: 7 }), l, rest);
    const faceClip = new AnimationClip('smile', [new AnimationChannel(2, 'weights', 'LINEAR', f32(0, 1), f32(0.8, 0.2, 0.8, 0.2), 2), new AnimationChannel(1, 'translation', 'LINEAR', f32(0, 1), f32(99, 0, 0, 99, 0, 0), 3)]);
    const face = mk(faceClip, l, rest);
    const c = new AnimationController(l, rest, params, [{ name: 'base', stateMachine: base }, { name: 'face', stateMachine: face, mask: buildMorphMask(l, [2]) }], -1);
    c.update(0.1);
    close(c.pose.w, [0.8, 0.2]);
    expect(c.pose.t[3]).toBeCloseTo(7);       // bones ignored by the morph-only mask
  });

  it('morph weights participate in state crossfades', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams(); const go = params.define('go', 'bool');
    const w = (name: string, a: number, b: number) => new AnimationClip(name, [new AnimationChannel(2, 'weights', 'LINEAR', f32(0, 1), f32(a, b, a, b), 2)]);
    const sm = new StateMachine(l, rest, [{ name: 'a', motion: new ClipMotion(w('a', 0, 0)) }, { name: 'b', motion: new ClipMotion(w('b', 1, 1)) }],
      [{ from: 0, to: 1, duration: 1, conditions: [{ param: go, op: 'true' }] }], 0);
    const c = new AnimationController(l, rest, params, [{ name: 'base', stateMachine: sm }], -1);
    c.update(0.1); params.setBool(go, true);
    c.update(0.5);
    expect(c.pose.w[0]).toBeGreaterThan(0.05); expect(c.pose.w[0]).toBeLessThan(0.95);
    for (let i = 0; i < 10; i++) c.update(0.1);
    close(c.pose.w, [1, 1]);
  });

  it('animatedNodes is the union over layers, states, root and constraints', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const c = new AnimationController(l, rest, params, [{ name: 'b', stateMachine: mk(constClip('x', { 1: 1 }), l, rest) }, { name: 'o', stateMachine: mk(constClip('y', { 2: 1 }), l, rest) }], 0);
    expect(Array.from(c.animatedNodes).sort()).toEqual([0, 1, 2]);
  });

  it('update() is allocation-free in steady state (poses are reused)', () => {
    const l = layout(), rest = new Pose(l), params = new AnimationParams();
    const c = new AnimationController(l, rest, params, [{ name: 'b', stateMachine: mk(constClip('x', { 1: 1 }), l, rest) }], 0);
    const ref = c.pose;
    for (let i = 0; i < 100; i++) c.update(1 / 60);
    expect(c.pose).toBe(ref);
  });
});
